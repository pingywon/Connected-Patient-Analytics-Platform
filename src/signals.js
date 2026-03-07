// Signal auto-mapping, extraction, mapping UI, and Explore plot.
/* global Plotly */
import { els } from './dom.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import {
  readSelectedSignalsFromEDF, mergeSeriesPickBest, clipSeriesToWindow,
  sanitizePressureSeries, normalizeLabel, normalizeLabelLoose
} from './edf.js';
import { CALM_LAYOUT, plotConfig } from './charts.js';
import { log, setStatus, progress } from './ui.js';

/* ---------- Auto-mapping ---------- */
const ALIAS = {
  leak: [
    'leak', 'mask leak', 'total leak', 'unintentional leak', 'leak rate',
    'maskleak', 'leakrate'
  ],
  pressure: [
    'pressure', 'mask pressure', 'therapy pressure', 'epap', 'ipap', 'press', 'mask pres',
    'therapy pres', 'delivered pressure'
  ],
  flow: [
    'flow', 'flow rate', 'airflow', 'resp flow', 'respiratory flow', 'flowrate'
  ],
  snore: [
    'snore2s', 'snore', 'snore index'
  ],
  respRate: [
    'respiratory rate', 'respiratory rate 2s', 'respiratory rate2s',
    'resprate2s', 'resprate.2s', 'resp rate 2s', 'resp rate2s', 'resprate 2s',
    'resp rate', 'breath rate', 'breaths min'
  ],
  tidalVolume: [
    'tidvol.2s', 'tidvol2s', 'tid vol 2s', 'tidal volume', 'tidal vol', 'tv', 'tid vol'
  ],
  annotations: [
    'edf annotations', 'annotations', 'annotation'
  ]
};

function scoreSignal(targetKey, sig) {
  const labelN = normalizeLabelLoose(sig.label);
  const unitN  = normalizeLabelLoose(sig.unit || '');
  const fileN  = normalizeLabelLoose(sig.file || '');

  let score = 0;
  for (const a of (ALIAS[targetKey] || [])) {
    const an = normalizeLabelLoose(a);
    if (!an) continue;
    if (labelN === an)         score += 60;
    if (labelN.includes(an))   score += 28;
    const toksA = an.split(' ').filter(Boolean);
    const toksL = new Set(labelN.split(' ').filter(Boolean));
    score += toksA.filter(t => toksL.has(t)).length * 6;
  }

  if (targetKey === 'leak') {
    if (unitN.includes('l') && unitN.includes('min')) score += 10;
    if (unitN.includes('l min'))                       score += 10;
  }
  if (targetKey === 'pressure') {
    if (unitN.includes('cm') && (unitN.includes('h2o') || unitN.includes('h2'))) score += 14;
    if (labelN.includes('therapy') && labelN.includes('pressure')) score += 18;
    if (labelN.includes('mask')    && labelN.includes('pressure')) score += 16;
    if (labelN.includes('pressure2s') || labelN.includes('press2s'))            score += 18;
    if (labelN.includes('epap') || labelN.includes('ipap'))                      score -= 4;
  }
  if (targetKey === 'snore'    && (labelN.includes('snore') || unitN.includes('snore')))          score += 16;
  if (targetKey === 'respRate' && (labelN.includes('resp')  || labelN.includes('rate') || unitN.includes('/min'))) score += 10;
  if (targetKey === 'tidalVolume') {
    if (labelN.includes('tidvol') || labelN.includes('tid vol'))        score += 42;
    if (labelN.includes('tidal')  && labelN.includes('volume'))         score += 26;
    if (unitN.includes('ml') || unitN.includes('l'))                     score += 10;
  }
  if (targetKey === 'annotations' && (labelN.includes('annot') || labelN.includes('event'))) score += 12;

  if (targetKey !== 'annotations') {
    if (fileN.includes('str edf') || fileN.endsWith('str edf')) score -= 6;
    if (sig.sr && sig.sr >= 1) score += Math.min(10, Math.log10(sig.sr + 1) * 6);
  }

  return score;
}

export function autoMapSignals() {
  const cat = state.current.signalCatalog;

  const pickBest = (targetKey) => {
    let best = null, bestScore = -Infinity;
    for (const s of cat) {
      const sc = scoreSignal(targetKey, s);
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (!best || bestScore < 18) return null;
    return best.key;
  };

  state.current.mapping.leak         = pickBest('leak');
  state.current.mapping.pressure     = pickBest('pressure');
  state.current.mapping.flow         = pickBest('flow');
  state.current.mapping.snore        = pickBest('snore');
  state.current.mapping.respRate     = pickBest('respRate');
  state.current.mapping.tidalVolume  = pickBest('tidalVolume');
  state.current.mapping.annotations  = pickBest('annotations');

  log(`Auto-map: ${JSON.stringify(state.current.mapping)}`);
}

/* ---------- Mapping UI ---------- */
export function renderMappingUI() {
  const cat  = state.current.signalCatalog;
  const opts = [
    { value: '', text: '(not set)' },
    ...cat.map(c => ({
      value: c.key,
      text:  `${c.label}${c.unit ? ` [${c.unit}]` : ''} — ${c.file.split('/').pop()}`
    }))
  ];

  const mkSelect = (id, value) => {
    const sel = document.createElement('select');
    sel.id = id;
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      if (o.value === value) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  };

  els.mapGrid.innerHTML = '';
  const rows = [
    { label: 'Leak',             key: 'leak' },
    { label: 'Pressure',         key: 'pressure' },
    { label: 'Flow',             key: 'flow' },
    { label: 'Snore',            key: 'snore' },
    { label: 'Respiratory Rate', key: 'respRate' },
    { label: 'Tidal Volume',     key: 'tidalVolume' },
    { label: 'Events',           key: 'annotations' },
  ];

  for (const r of rows) {
    const wrap = document.createElement('div');
    wrap.className = 'mapRow';
    const lab = document.createElement('label');
    lab.textContent = r.label;
    const sel = mkSelect(`map_${r.key}`, state.current.mapping[r.key] || '');
    wrap.appendChild(lab);
    wrap.appendChild(sel);
    els.mapGrid.appendChild(wrap);
  }

  els.applyMappingBtn.disabled = false;
  populateExploreOptions(cat);

  els.rawSummary.innerHTML = `<b>Signal catalog:</b><br/>${cat.length} unique signal labels found.`;
  els.rawDump.textContent  = JSON.stringify({
    sdMarkers:     state.meta.rootMarkers,
    device:        state.identification,
    session:       { label: state.current.session?.label, files: state.current.edfFiles.map(f => f.path) },
    signalCatalog: cat,
    mapping:       state.current.mapping
  }, null, 2);
}

export function populateExploreOptions(cat) {
  if (!els.exploreSelect) return;
  els.exploreSelect.innerHTML = '<option value="">Choose a mapped signal (large selector)…</option>';
  for (const c of cat) {
    const opt = document.createElement('option');
    opt.value       = c.key;
    opt.textContent = `${c.label}${c.unit ? ` [${c.unit}]` : ''} — ${c.file.split('/').pop()}`;
    els.exploreSelect.appendChild(opt);
  }
  els.exploreSelect.disabled = cat.length === 0;
}

export function applyMappingFromUI() {
  const get = id => document.getElementById(id)?.value || '';
  state.current.mapping = {
    leak:        get('map_leak')        || null,
    pressure:    get('map_pressure')    || null,
    flow:        get('map_flow')        || null,
    snore:       get('map_snore')       || null,
    respRate:    get('map_respRate')    || null,
    tidalVolume: get('map_tidalVolume') || null,
    annotations: get('map_annotations') || null,
  };
  log(`Applied manual mapping: ${JSON.stringify(state.current.mapping)}`);
  els.rawDump.textContent = JSON.stringify({
    identification: state.identification,
    session:        { label: state.current.session?.label, files: state.current.edfFiles.map(f => f.path) },
    mapping:        state.current.mapping,
    edfHeaders:     state.current.raw
  }, null, 2);
}

/* ---------- Explore plot ---------- */
export async function renderExplorePlot() {
  const key = els.exploreSelect?.value;
  if (!key) {
    Plotly.newPlot(
      els.plotExplore,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Explore (select a signal)') },
      plotConfig
    );
    els.exploreNarrative.innerHTML = '<b>Explore:</b> choose a mapped signal from the large dropdown below to display it here.';
    return;
  }

  const merged = { t: [], y: [], unit: '', label: '' };
  for (const f of state.current.edfFiles) {
    const { series } = await readSelectedSignalsFromEDF(f, { custom: key }, 120000);
    const ser = series.custom;
    if (!ser?.t?.length) continue;
    merged.t     = merged.t.concat(ser.t);
    merged.y     = merged.y.concat(ser.y);
    merged.unit  = merged.unit  || ser.unit;
    merged.label = merged.label || ser.label;
  }

  if (!merged.t.length) {
    Plotly.newPlot(
      els.plotExplore,
      [{ x: [0, 1], y: [0, 0], type: 'scatter', mode: 'lines', hoverinfo: 'skip' }],
      { ...CALM_LAYOUT('Explore (no data for selected signal)') },
      plotConfig
    );
    els.exploreNarrative.innerHTML = '<b>No data for selected mapping in this timeframe.</b>';
    return;
  }

  const idx = merged.t.map((d, i) => [d.getTime(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const t   = idx.map(i => merged.t[i]);
  const y   = idx.map(i => merged.y[i]);

  Plotly.newPlot(
    els.plotExplore,
    [{ x: t, y, type: 'scatter', mode: 'lines', line: { color: 'rgba(97,212,195,.95)', width: 2 } }],
    {
      ...CALM_LAYOUT(`Explore — ${merged.label || 'Custom signal'}`),
      yaxis: {
        ...CALM_LAYOUT('').yaxis,
        title: { text: merged.unit ? `${merged.label} (${merged.unit})` : (merged.label || 'Value') }
      }
    },
    plotConfig
  );
  els.exploreNarrative.innerHTML = `<b>Explore:</b> showing <b>${escapeHtml(merged.label || 'selected signal')}</b> across the selected timeframe.`;
}

/* ---------- Extract signals + render ---------- */
export async function extractSignalsAndRender(analyzeAndRender) {
  setStatus('Processing…', 'neutral');

  const mapping = state.current.mapping;
  const merged  = { leak: null, pressure: null, flow: null, snore: null, respRate: null, tidalVolume: null };
  let mergedEvents = { t: [], type: [] };

  const files = state.current.edfFiles;
  const n     = files.length;

  for (let i = 0; i < n; i++) {
    const f   = files[i];
    const pct = 88 + ((i) / Math.max(1, n)) * 8;
    progress('Extracting signals', pct, `Parsing EDF ${i + 1}/${n}: ${f.path.split('/').pop()}`);

    const { series, events } = await readSelectedSignalsFromEDF(f, mapping, 90000);
    merged.leak        = mergeSeriesPickBest(merged.leak,        series.leak);
    merged.pressure    = mergeSeriesPickBest(merged.pressure,    series.pressure);
    merged.flow        = mergeSeriesPickBest(merged.flow,        series.flow);
    merged.snore       = mergeSeriesPickBest(merged.snore,       series.snore);
    merged.respRate    = mergeSeriesPickBest(merged.respRate,    series.respRate);
    merged.tidalVolume = mergeSeriesPickBest(merged.tidalVolume, series.tidalVolume);

    if (events?.t?.length) {
      mergedEvents.t.push(...events.t);
      mergedEvents.type.push(...events.type);
    }
  }

  let eventsOut = null;
  if (mergedEvents.t.length) {
    const startMs = state.current.session?.start instanceof Date ? state.current.session.start.getTime() : -Infinity;
    const endMs   = state.current.session?.end   instanceof Date ? state.current.session.end.getTime()   : Infinity;
    const idx = mergedEvents.t
      .map((d, i) => [d?.getTime?.() ?? NaN, i])
      .filter(([ms]) => Number.isFinite(ms) && ms >= startMs && ms <= endMs)
      .sort((a, b) => a[0] - b[0])
      .map(x => x[1]);
    eventsOut = { t: idx.map(i => mergedEvents.t[i]), type: idx.map(i => mergedEvents.type[i]) };
  }

  const sess = state.current.session;
  state.current.signals = {
    leak:        clipSeriesToWindow(merged.leak,        sess?.start, sess?.end),
    pressure:    sanitizePressureSeries(clipSeriesToWindow(merged.pressure, sess?.start, sess?.end)),
    flow:        clipSeriesToWindow(merged.flow,        sess?.start, sess?.end),
    snore:       clipSeriesToWindow(merged.snore,       sess?.start, sess?.end),
    respRate:    clipSeriesToWindow(merged.respRate,    sess?.start, sess?.end),
    tidalVolume: clipSeriesToWindow(merged.tidalVolume, sess?.start, sess?.end),
  };
  state.current.events = eventsOut;

  progress('Analyzing', 97, 'Computing stats + writing explanations…');
  try {
    analyzeAndRender();
    await renderExplorePlot();
    progress('Done', 100, 'Report ready.');
    setStatus('Ready', 'good');
  } catch (err) {
    console.error(err);
    setStatus('Error', 'bad');
    progress('Error', 100, `Analysis failed: ${err?.message || err}`);
    log('❌ Analysis failed: ' + (err?.message || err));
  }
}
