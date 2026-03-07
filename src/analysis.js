// Analysis, KPI computation, and chart/narrative rendering.
/* global Plotly */
import { els } from './dom.js';
import { state } from './state.js';
import { percentile, timeSpanHours, escapeHtml, flattenObject, shortenIdKey } from './utils.js';
import { cleanEventLabel, normalizeLabelLoose } from './edf.js';
import { CALM_LAYOUT, plotConfig } from './charts.js';
import { renderExplorePlot } from './signals.js';

/* ---------- Device headline (needs state + utils) ---------- */
function deviceHeadline() {
  const id = state.identification;
  if (!id) return 'Unknown device';
  const flat  = flattenObject(id, 5);
  const items = Object.entries(flat).map(([k, v]) => ({ k: shortenIdKey(k), v }));
  const get   = (needle) => {
    const n   = needle.toLowerCase();
    const hit = items.find(it => String(it.k).toLowerCase() === n) ||
                items.find(it => String(it.k).toLowerCase().includes(n));
    return hit ? String(hit.v ?? '') : '';
  };
  const make   = get('Manufacturer') || get('Brand') || get('FG P1.Manufacturer');
  const model  = get('Model') || get('MachineModel') || get('FG P1.Model');
  const mode   = get('Mode') || get('PAPMode') || get('FG P1.Mode');
  const serial = get('SerialNumber') || get('DeviceSerial') || get('FG P1.SerialNumber') || get('FG P1.DeviceSerial');
  return [
    [make, model].filter(Boolean).join(' ').trim() || 'Unknown',
    [mode ? `Mode: ${mode}` : '', serial ? `SN: ${serial}` : ''].filter(Boolean).join(' • ')
  ].filter(Boolean).join(' — ');
}

/* ---------- Analysis ---------- */
export function analyzeAndRender() {
  const s    = state.current.signals;
  const ev   = state.current.events;
  const sess = state.current.session;

  const stats  = {};
  const usage  = Math.max(
    timeSpanHours(s.leak)     ?? 0,
    timeSpanHours(s.pressure) ?? 0,
    timeSpanHours(s.flow)     ?? 0,
    sess ? (sess.end - sess.start) / 1000 / 3600 : 0
  );
  stats.usageHrs = usage || null;

  if (s.leak?.y?.length) {
    stats.leakP50            = percentile(s.leak.y, 0.50);
    stats.leakP95            = percentile(s.leak.y, 0.95);
    stats.largeLeakThreshold = 24;
    const thr = stats.largeLeakThreshold;
    stats.largeLeakPct = s.leak.y.filter(v => v >= thr).length / s.leak.y.length * 100;
  }
  if (s.pressure?.y?.length) {
    stats.p50 = percentile(s.pressure.y, 0.50);
    stats.p95 = percentile(s.pressure.y, 0.95);
  }
  if (ev?.t?.length && stats.usageHrs && stats.usageHrs > 0.1) {
    stats.ahiEst = ev.t.length / stats.usageHrs;
  }
  state.current.stats = stats;

  els.kpiUsage.textContent     = stats.usageHrs != null ? `${stats.usageHrs.toFixed(2)} h` : '—';
  els.kpiUsageNote.textContent = stats.usageHrs != null ? 'Based on detected signal time span.' : 'No usable time span.';
  els.kpiLeak95.textContent    = stats.leakP95  != null ? stats.leakP95.toFixed(1)  : '—';
  els.kpiLeak95Note.textContent = stats.leakP95 != null ? '95% of the night was at/below this leak.' : 'Leak not mapped.';
  els.kpiP50.textContent       = stats.p50      != null ? stats.p50.toFixed(1)      : '—';
  els.kpiP50Note.textContent   = stats.p50      != null ? 'Median pressure.' : 'Pressure not mapped.';
  els.kpiAHI.textContent       = stats.ahiEst   != null ? stats.ahiEst.toFixed(2)   : '—';
  els.kpiAHINote.textContent   = stats.ahiEst   != null ? 'Estimated from annotations.' : 'No annotations mapped/found.';

  renderPlotsAndText();
}

/* ---------- All charts + narratives ---------- */
export function renderPlotsAndText() {
  const s    = state.current.signals;
  const ev   = state.current.events;
  const st   = state.current.stats;
  const sess = state.current.session;

  /* -- Overview -- */
  const traces  = [];
  let   needY2  = false;
  if (s.leak?.t?.length) {
    traces.push({
      x: s.leak.t, y: s.leak.y, type: 'scatter', mode: 'lines',
      name: `Leak${s.leak.unit ? ` (${s.leak.unit})` : ''}`,
      line: { color: 'rgba(255,107,122,.85)', width: 2.3 },
      hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br><b>%{y:.1f}</b><extra></extra>'
    });
  }
  if (s.pressure?.t?.length) {
    needY2 = traces.length > 0;
    traces.push({
      x: s.pressure.t, y: s.pressure.y, type: 'scatter', mode: 'lines',
      name: `Pressure${s.pressure.unit ? ` (${s.pressure.unit})` : ''}`,
      yaxis: needY2 ? 'y2' : 'y',
      line: { color: 'rgba(97,212,195,.92)', width: 2.3 },
      hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br><b>%{y:.1f}</b><extra></extra>'
    });
  }

  if (!traces.length) {
    Plotly.newPlot(els.plotOverview,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Overview (no mapped signals)') }, plotConfig);
  } else {
    const layout = CALM_LAYOUT(`Overview — ${sess?.label || ''}`);
    if (needY2) {
      layout.yaxis.title = { text: 'Leak', font: { color: 'rgba(255,107,122,.85)' } };
      layout.yaxis2 = {
        title: { text: 'Pressure', font: { color: 'rgba(97,212,195,.92)' } },
        overlaying: 'y', side: 'right',
        gridcolor: 'rgba(255,255,255,.02)', zerolinecolor: 'rgba(255,255,255,.06)',
        tickcolor: 'rgba(255,255,255,.25)',
      };
    }
    Plotly.newPlot(els.plotOverview, traces, layout, plotConfig);
  }

  els.overviewSummary.innerHTML = `
    <b>Status</b><br/>
    Loaded: <b>${escapeHtml(sess?.label || '—')}</b><br/>
    Device: <b>${escapeHtml(deviceHeadline())}</b>
  `;
  els.overviewNarrative.innerHTML = `
    <b>What you're looking at:</b><br/>
    Overview helps you spot whether leak spikes line up with pressure changes.<br/><br/>
    <b>Indexing rule:</b> Sessions are grouped by <b>DATALOG/YYYYMMDD</b> folders.
  `;

  /* -- Leak -- */
  if (s.leak?.t?.length) {
    const thr = st.largeLeakThreshold ?? 24;
    const lay = CALM_LAYOUT('Mask leak rate');
    lay.yaxis.title = { text: s.leak.unit ? `Leak (${s.leak.unit})` : 'Leak' };
    lay.shapes = [{
      type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: thr, y1: thr,
      line: { color: 'rgba(255,204,102,.75)', width: 2, dash: 'dot' }
    }];
    Plotly.newPlot(els.plotLeak,
      [{ x: s.leak.t, y: s.leak.y, type: 'scatter', mode: 'lines', name: 'Leak', line: { color: 'rgba(255,107,122,.85)', width: 2.5 } }],
      lay, plotConfig);

    const pct  = st.largeLeakPct;
    const p95  = st.leakP95;
    const tone =
      (pct != null && pct >= 20) || (p95 != null && p95 >= (thr + 6)) ? 'Likely problematic' :
      (pct != null && pct >= 5)  || (p95 != null && p95 >= thr)        ? 'Worth improving'    :
      'Mostly controlled';

    els.leakNarrative.innerHTML = `
      <b>Leak explained:</b> extra air escaping beyond expected venting. Sampled <b>every 2 seconds</b>.<br/>
      <b>Your reading:</b> <b>${tone}</b><br/>
      • Median: <b>${st.leakP50 != null ? st.leakP50.toFixed(1) : '—'}</b><br/>
      • P95: <b>${st.leakP95  != null ? st.leakP95.toFixed(1)  : '—'}</b><br/>
      • Time ≥ ${thr}: <b>${pct != null ? pct.toFixed(1) + '%' : '—'}</b>
    `;
  } else {
    Plotly.newPlot(els.plotLeak,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Leaks (not mapped)') }, plotConfig);
    els.leakNarrative.innerHTML = `<b>No leak signal mapped.</b> Use the mapping UI on the left.`;
  }

  /* -- Pressure -- */
  if (s.pressure?.t?.length) {
    Plotly.newPlot(els.plotPressure,
      [{ x: s.pressure.t, y: s.pressure.y, type: 'scatter', mode: 'lines', name: 'Pressure', line: { color: 'rgba(97,212,195,.92)', width: 2.5 } }],
      { ...CALM_LAYOUT('Therapy pressure'), yaxis: { ...CALM_LAYOUT('').yaxis, title: { text: s.pressure.unit ? `Pressure (${s.pressure.unit})` : 'Pressure' } } },
      plotConfig);
    els.pressureNarrative.innerHTML = `
      <b>Pressure explained:</b> the "air support" keeping your airway open.<br/>Sample rate: <b>every 1 second</b>.<br/><br/>
      • Median: <b>${st.p50 != null ? st.p50.toFixed(1) : '—'}</b><br/>
      • P95: <b>${st.p95 != null ? st.p95.toFixed(1) : '—'}</b>
    `;
  } else {
    Plotly.newPlot(els.plotPressure,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Pressure (not mapped)') }, plotConfig);
    els.pressureNarrative.innerHTML = `<b>No pressure signal mapped.</b> Use the mapping UI on the left.`;
  }

  /* -- Flow -- */
  if (s.flow?.t?.length) {
    Plotly.newPlot(els.plotFlow,
      [{ x: s.flow.t, y: s.flow.y, type: 'scatter', mode: 'lines', name: 'Flow', line: { color: 'rgba(122,167,255,.92)', width: 2.1 } }],
      { ...CALM_LAYOUT('Flow'), yaxis: { ...CALM_LAYOUT('').yaxis, title: { text: s.flow.unit ? `Flow (${s.flow.unit})` : 'Flow' } } },
      plotConfig);
    els.flowNarrative.innerHTML = `<b>Flow explained:</b> your breathing waveform (useful for pattern context).`;
  } else {
    Plotly.newPlot(els.plotFlow,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Flow (not mapped)') }, plotConfig);
    els.flowNarrative.innerHTML = `<b>No flow signal mapped.</b> Use the mapping UI on the left.`;
  }

  /* -- Snore -- */
  if (s.snore?.t?.length) {
    Plotly.newPlot(els.plotSnore,
      [{ x: s.snore.t, y: s.snore.y, type: 'scatter', mode: 'lines', name: 'Snore', line: { color: 'rgba(255,204,102,.95)', width: 2.1 } }],
      { ...CALM_LAYOUT('Snore'), yaxis: { ...CALM_LAYOUT('').yaxis, title: { text: s.snore.unit ? `Snore (${s.snore.unit})` : 'Snore' } } },
      plotConfig);
    els.snoreNarrative.innerHTML = `<b>Snore:</b> snore-related signal over time (sampled every 2 seconds). Higher values may indicate increased upper-airway vibration.`;
  } else {
    Plotly.newPlot(els.plotSnore,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Snore (not mapped)') }, plotConfig);
    els.snoreNarrative.innerHTML = `<b>No Snore signal mapped.</b> Set Snore in the mapping panel if available.`;
  }

  /* -- Respiratory Rate -- */
  if (s.respRate?.t?.length) {
    Plotly.newPlot(els.plotRespRate,
      [{ x: s.respRate.t, y: s.respRate.y, type: 'scatter', mode: 'lines', name: 'Respiratory Rate', line: { color: 'rgba(110,231,166,.95)', width: 2.1 } }],
      { ...CALM_LAYOUT('Respiratory Rate'), yaxis: { ...CALM_LAYOUT('').yaxis, title: { text: s.respRate.unit ? `Respiratory Rate (${s.respRate.unit})` : 'Respiratory Rate' } } },
      plotConfig);
    els.respRateNarrative.innerHTML = `<b>Respiratory Rate (BPM):</b> respiratory rate trend (sampled every 2 seconds). <b>BPM means Breaths Per Minute</b>. Watch for sustained rises/falls compared with your usual baseline.`;
  } else {
    Plotly.newPlot(els.plotRespRate,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Respiratory Rate (not mapped)') }, plotConfig);
    els.respRateNarrative.innerHTML = `<b>No Respiratory Rate signal mapped.</b> Set Respiratory Rate in the mapping panel if available.`;
  }

  /* -- Tidal Volume -- */
  if (s.tidalVolume?.t?.length) {
    const unitN      = normalizeLabelLoose(s.tidalVolume.unit || '');
    const asLiters   = unitN.includes('l') && !unitN.includes('ml');
    const maleBase   = asLiters ? 0.5 : 500;
    const femaleBase = asLiters ? 0.4 : 400;
    const layTv = {
      ...CALM_LAYOUT('Tidal Volume'),
      yaxis: { ...CALM_LAYOUT('').yaxis, title: { text: s.tidalVolume.unit ? `Tidal Volume (${s.tidalVolume.unit})` : 'Tidal Volume (mL)' } },
      shapes: [
        { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: maleBase,   y1: maleBase,   line: { color: 'rgba(122,167,255,.75)', width: 2, dash: 'dot' } },
        { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: femaleBase, y1: femaleBase, line: { color: 'rgba(255,204,102,.75)', width: 2, dash: 'dot' } }
      ]
    };
    Plotly.newPlot(els.plotTidalVolume,
      [{ x: s.tidalVolume.t, y: s.tidalVolume.y, type: 'scatter', mode: 'lines', name: 'Tidal Volume', line: { color: 'rgba(186,148,255,.95)', width: 2.1 } }],
      layTv, plotConfig);
    els.tidalNarrative.innerHTML = `<b>Tidal Volume:</b> the amount of air you breathe in one normal resting breath. Typical resting baseline is about <b>${asLiters ? '0.5 L' : '500 mL'} for men</b> and <b>${asLiters ? '0.4 L' : '400 mL'} for women</b> (shown as reference lines).`;
  } else {
    Plotly.newPlot(els.plotTidalVolume,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Tidal Volume (not mapped)') }, plotConfig);
    els.tidalNarrative.innerHTML = `<b>No Tidal Volume signal mapped.</b> Tidal Volume uses <b>TidVol.2s</b> when available.`;
  }

  /* -- Events -- */
  if (ev?.t?.length) {
    const counts = {};
    for (const t of ev.type) counts[t] = (counts[t] || 0) + 1;
    const ranked  = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topCats = ranked.slice(0, 10).map(x => x[0]);

    const colors = [
      'rgba(122,167,255,.92)', 'rgba(97,212,195,.92)',  'rgba(255,204,102,.90)',
      'rgba(255,107,122,.90)', 'rgba(110,231,166,.90)', 'rgba(231,246,246,.85)',
    ];

    const layout = CALM_LAYOUT('Events over time (annotations)');
    layout.margin = { ...layout.margin, l: 130 };
    layout.yaxis  = {
      ...layout.yaxis,
      automargin: true,
      title:    { text: 'Event Category', standoff: 14 },
      tickmode: 'array',
      tickvals: [...topCats.map((_, i) => i), topCats.length],
      ticktext: [...topCats.map(c => cleanEventLabel(c)), 'Other'],
    };

    const buckets = new Map(topCats.map((c, i) => [c, { idx: i, x: [], y: [], text: [] }]));
    const otherX = [], otherY = [], otherText = [];

    for (let j = 0; j < ev.t.length; j++) {
      const raw = ev.type[j];
      const b   = buckets.get(raw);
      if (b) {
        b.x.push(ev.t[j]); b.y.push(b.idx); b.text.push(cleanEventLabel(raw));
      } else {
        otherX.push(ev.t[j]); otherY.push(topCats.length); otherText.push(cleanEventLabel(raw));
      }
    }

    const evTraces = [];
    for (const rawCat of topCats) {
      const b = buckets.get(rawCat);
      if (!b || !b.x.length) continue;
      evTraces.push({
        x: b.x, y: b.y, type: 'scatter', mode: 'markers',
        marker: { size: 9, color: colors[b.idx % colors.length], line: { width: 1, color: 'rgba(0,0,0,.35)' } },
        name: cleanEventLabel(rawCat), text: b.text,
        hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br><b>%{text}</b><extra></extra>'
      });
    }
    if (otherX.length) {
      evTraces.push({
        x: otherX, y: otherY, type: 'scatter', mode: 'markers',
        marker: { size: 8, color: 'rgba(180,188,198,.88)', line: { width: 1, color: 'rgba(0,0,0,.35)' } },
        name: 'Other', text: otherText,
        hovertemplate: '%{x|%Y-%m-%d %H:%M:%S}<br><b>%{text}</b><extra></extra>'
      });
    }
    Plotly.newPlot(els.plotEvents, evTraces, layout, plotConfig);

    const legendItems = topCats.slice(0, 6).map((cat, i) =>
      `<span class="eventLegendItem" title="${escapeHtml(cleanEventLabel(cat))}: annotation category from EDF events">` +
      `<span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${colors[i % colors.length]};margin-right:6px;vertical-align:middle;"></span>` +
      `${escapeHtml(cleanEventLabel(cat))}</span>`
    ).join(' ');
    els.eventsLegend.innerHTML = `<b>Legend:</b> ${legendItems || 'No categories'}<div class="tiny" style="margin-top:6px">Dots are labeled by parsed event category. Hover a dot to see exact timestamp and label.</div>`;

    const top         = ranked.slice(0, 5).map(([k, v]) => `• ${escapeHtml(cleanEventLabel(k))}: <b>${v}</b>`).join('<br/>');
    const rangeLabel  = state.selectedRange?.startISO && state.selectedRange?.endISO
      ? `${state.selectedRange.startISO} → ${state.selectedRange.endISO}`
      : (state.current.session?.label || 'Selected session');
    const perHour = st.usageHrs && st.usageHrs > 0 ? (ev.t.length / st.usageHrs) : null;

    els.eventsNarrative.innerHTML = `
      <b>Events explained:</b> each dot is one parsed annotation event, grouped by category.<br/><br/>
      • Range: <b>${escapeHtml(rangeLabel)}</b><br/>
      • Total events: <b>${ev.t.length}</b><br/>
      • Events/hour (raw): <b>${perHour != null ? perHour.toFixed(2) : '—'}</b><br/>
      • AHI (est): <b>${st.ahiEst != null ? st.ahiEst.toFixed(2) : '—'}</b><br/><br/>
      <b>Top event types</b><br/>
      ${top || 'No event labels found.'}
    `;
  } else {
    Plotly.newPlot(els.plotEvents,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Events (not found/mapped)') }, plotConfig);
    els.eventsLegend.innerHTML   = '<b>Legend:</b> none (no parsed events).';
    els.eventsNarrative.innerHTML = `<b>No annotations parsed.</b> If EDF has "EDF Annotations", map it on the left.`;
  }
}
