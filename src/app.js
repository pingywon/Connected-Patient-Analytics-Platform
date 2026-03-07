// Entry point — wires event listeners and orchestrates the load pipeline.
// CSS is loaded via <link> in index.html so Vite inlines it on build.
import { els } from './dom.js';
import { state, newJob, assertActive } from './state.js';
import { tick, localDateISO } from './utils.js';
import { parseEDFHeader } from './edf.js';
import {
  toast, setStatus, log, progress,
  enablePicker, applyRangeMode, renderCalendar, updateRangeHint,
  resetAll, initUI
} from './ui.js';
import {
  enumerateZipEntries,
  indexSessionsFromSDStructure,
  readIdentification,
  readCurrentSettings,
  renderIdentification
} from './zip.js';
import {
  autoMapSignals, renderMappingUI, applyMappingFromUI,
  extractSignalsAndRender, renderExplorePlot
} from './signals.js';
import { analyzeAndRender } from './analysis.js';

/* ============================
   ZIP handling
   ============================ */

async function handleZip(file) {
  const jobId = newJob();
  resetAll();
  state.jobId = jobId;

  els.fileBadge.textContent = file.name;
  setStatus('Reading ZIP…', 'neutral');
  progress('Reading ZIP', 2, `${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} MB`);
  log(`ZIP: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

  try {
    const buf = await readFileAsArrayBufferWithProgress(file, (loaded, total) => {
      assertActive(jobId);
      const pct = total ? (loaded / total) * 20 : 5;
      progress('Reading ZIP', pct, `Reading file… ${(loaded / 1024 / 1024).toFixed(2)} / ${(total / 1024 / 1024).toFixed(2)} MB`);
    });
    assertActive(jobId);

    progress('Unzipping', 22, 'Unzipping archive…');
    setStatus('Unzipping…', 'neutral');
    await tick();
    assertActive(jobId);

    state.zip = await JSZip.loadAsync(buf);
    assertActive(jobId);

    progress('Scanning ZIP', 30, 'Scanning file list…');
    await tick();
    assertActive(jobId);

    const { entries, prefix, markers } = enumerateZipEntries(state.zip);
    state.entries          = entries;
    state.meta.prefix      = prefix;
    state.meta.rootMarkers = markers;

    const edfCount = entries.filter(e => e.path.toLowerCase().endsWith('.edf')).length;
    const idCount  = entries.filter(e => e.path.toLowerCase().endsWith('identification.json')).length;

    els.zipStats.textContent = `${entries.length} files • ${edfCount} edf • id:${idCount ? 'yes' : 'no'}`;
    log(`Files: ${entries.length} | EDF: ${edfCount} | Identification.json: ${idCount ? 'yes' : 'no'} | prefix: ${prefix || '(none)'}`);
    progress('Scanning ZIP', 35, `Found ${entries.length} files. EDF: ${edfCount}. Identification.json: ${idCount ? 'yes' : 'no'}.`);
    await tick();
    assertActive(jobId);

    await readIdentification(entries, jobId, assertActive, tick, progress, log);
    await readCurrentSettings(entries, jobId, assertActive);

    setStatus('Indexing days…', 'neutral');
    progress('Indexing days', 40, 'Finding DATALOG/YYYYMMDD/ EDF files…');
    await tick();
    assertActive(jobId);

    const index = await indexSessionsFromSDStructure(entries, jobId, assertActive, tick, progress, log);
    state.sessionsByDate = index.sessionsByDate;

    if (!state.sessionsByDate.size) {
      setStatus('No sessions', 'warn');
      progress('Indexing days', 100, 'No day folders found under DATALOG/YYYYMMDD, and no usable STR.edf date.');
      els.overviewSummary.innerHTML = `<b>Status</b><br/>Couldn't find sessions. Expected: <b>DATALOG/YYYYMMDD/*.edf</b>.`;
      els.rawSummary.innerHTML      = `<b>Raw:</b> Couldn't index sessions.`;
      els.rawDump.textContent       = entries.slice(0, 400).map(e => e.path).join('\n');
      return;
    }

    enablePicker(true);

    setStatus('Loading most recent day…', 'neutral');
    progress('Auto-loading', 96, 'Auto-loading most recent day…');
    await tick();
    assertActive(jobId);

    const maxDate = Array.from(state.sessionsByDate.keys()).filter(d => d !== 'unknown').sort().slice(-1)[0];
    const pack    = state.sessionsByDate.get(maxDate);
    const firstKey = pack?.sessions?.[0]?.key;
    if (maxDate && firstKey) {
      await loadSession(maxDate, firstKey, jobId);
    } else {
      setStatus('Ready', 'good');
      progress('Ready', 100, 'Choose a date + session, then click Load.');
    }

    toast('ZIP ready ✔');
  } catch (err) {
    if (err?.name === 'CancelledError') { log('⏹ Cancelled (new ZIP loaded).'); return; }
    console.error(err);
    setStatus('Error', 'bad');
    progress('Error', 100, err?.message || String(err));
    log('❌ ' + (err?.message || String(err)));
  }
}

function readFileAsArrayBufferWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader      = new FileReader();
    reader.onerror    = () => reject(reader.error);
    reader.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      else                    onProgress?.(e.loaded, file.size);
    };
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(file);
  });
}

/* ============================
   Session loading
   ============================ */

async function loadSession(dateISO, sessionKey, jobId = state.jobId) {
  assertActive(jobId);
  const pack = state.sessionsByDate.get(dateISO);
  const sess = pack?.sessions?.find(s => s.key === sessionKey);
  if (!sess) return;
  await loadSessionsAggregate([sess], sess.label || dateISO, jobId);
}

async function loadRange() {
  const { startISO, endISO } = state.selectedRange;
  if (!startISO || !endISO) return;
  progress('Preparing range', 52, `Processing range ${startISO} → ${endISO}. Please wait…`);
  setStatus('Processing range…', 'neutral');
  toast('Loading selected timeframe…');
  const dates    = Array.from(state.sessionsByDate.keys()).filter(d => d !== 'unknown' && d >= startISO && d <= endISO).sort();
  const sessions = dates.flatMap(d => state.sessionsByDate.get(d)?.sessions || []);
  if (!sessions.length) { toast('No sessions in selected range.'); return; }
  await loadSessionsAggregate(sessions, `${dates[0]} → ${dates[dates.length - 1]}`);
}

async function loadSessionsAggregate(sessions, label, jobId = state.jobId) {
  assertActive(jobId);
  const safeSessions = (sessions || []).filter(Boolean);
  if (!safeSessions.length) return;

  state.current.session = {
    key:   safeSessions.map(s => s.key).join('|'),
    label,
    start: safeSessions.reduce((m, s) => !m || s.start < m ? s.start : m, null),
    end:   safeSessions.reduce((m, s) => !m || s.end   > m ? s.end   : m, null),
    files: safeSessions.flatMap(s => s.files || [])
  };
  state.current.edfFiles      = [];
  state.current.signalCatalog = [];
  state.current.mapping       = { leak: null, pressure: null, flow: null, snore: null, respRate: null, tidalVolume: null, annotations: null };
  state.current.signals       = {};
  state.current.events        = null;
  state.current.stats         = {};
  state.current.raw           = {};

  setStatus('Loading selection…', 'neutral');
  progress('Loading selection', 62, `Loading ${state.current.session.files.length} EDF file(s)… This can take a bit for large ranges.`);
  toast('Loading selection…');
  log(`Loading: ${label} (${state.current.session.files.length} EDF file(s))`);

  const n = state.current.session.files.length;
  for (let i = 0; i < n; i++) {
    assertActive(jobId);
    const seg = state.current.session.files[i];
    const pct = 60 + ((i) / Math.max(1, n)) * 20;
    progress('Loading selection', pct, `Reading EDF ${i + 1}/${n}: ${seg.path.split('/').pop()}`);
    await tick();
    if (!seg.entry) continue;
    const buffer = await seg.entry.async('arraybuffer');
    assertActive(jobId);
    const header = parseEDFHeader(buffer);
    state.current.edfFiles.push({ path: seg.path, entry: seg.entry, header, buffer: null, folderDateISO: seg._folderDateISO || null });
    state.current.raw[seg.path] = {
      start:       header.start?.toISOString?.() || null,
      patientId:   header.patientId,
      recordingId: header.recordingId,
      signals:     header.signals.map(s => ({ label: s.label, unit: s.physDim, sr: +(s.sampleRate || 0).toFixed(3), spr: s.samplesPerRecord }))
    };
  }

  progress('Cataloging signals', 82, 'Building signal catalog…');
  await tick();
  assertActive(jobId);

  const catalog = [];
  for (const f of state.current.edfFiles) {
    for (const s of f.header.signals) {
      catalog.push({
        key:          `${f.path}::${s.index}`,
        normKey:      normalizeLabelLoose_local(s.label),
        normKeyStrict: normalizeLabel_local(s.label),
        signalIndex:  s.index,
        label:        s.label,
        unit:         s.physDim,
        sr:           s.sampleRate,
        file:         f.path
      });
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const c of catalog) {
    const k = `${c.normKey}__${c.unit || ''}__${c.file}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  state.current.signalCatalog = uniq;

  progress('Auto-mapping', 85, `Found ${uniq.length} unique signals. Auto-detecting…`);
  await tick();
  assertActive(jobId);

  autoMapSignals();
  renderMappingUI();

  progress('Extracting signals', 88, 'Reading samples for mapped signals…');
  await tick();
  assertActive(jobId);

  await extractSignalsAndRender(analyzeAndRender);
  setStatus('Ready', 'good');
  toast('Selection ready ✔');
}

// Local label normalizers (avoid re-importing circular path; mirrors edf.js)
function normalizeLabel_local(s) {
  return String(s || '').toLowerCase().replace(/[\u00B2]/g, '2').replace(/[^a-z0-9]+/g, ' ').trim();
}
function normalizeLabelLoose_local(s) {
  return normalizeLabel_local(s).replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();
}

/* ============================
   Event listeners
   ============================ */

// Drop zone
els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
els.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files?.[0];
  if (f) handleZip(f);
});
els.dropZone.addEventListener('click', (e) => {
  if (e.target.closest('label,button,input,select,a')) return;
  els.zipInput.click();
});
els.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    if (document.activeElement?.closest?.('label,button,input,select,a')) return;
    e.preventDefault();
    els.zipInput.click();
  }
});
els.chooseZipBtn.addEventListener('click', (e) => e.stopPropagation());
els.demoBtn.addEventListener('click', (e) => e.stopPropagation());

// File input
els.zipInput.addEventListener('change', () => {
  const f = els.zipInput.files?.[0];
  if (f) handleZip(f);
});

// Clear
els.clearBtn.addEventListener('click', () => { resetAll(); toast('Cleared.'); });

// Range mode buttons
els.modeNight.addEventListener('click',  () => applyRangeMode('night'));
els.modeWeek.addEventListener('click',   () => applyRangeMode('week'));
els.modeMonth.addEventListener('click',  () => applyRangeMode('month'));
els.modeCustom.addEventListener('click', () => applyRangeMode('custom'));

// Load range
els.loadRangeBtn.addEventListener('click', async () => { await loadRange(); });

// Calendar navigation
els.calPrev.addEventListener('click', () => {
  const d = state.calendarView || new Date();
  d.setMonth(d.getMonth() - 1);
  state.calendarView = d;
  renderCalendar();
});
els.calNext.addEventListener('click', () => {
  const d = state.calendarView || new Date();
  d.setMonth(d.getMonth() + 1);
  state.calendarView = d;
  renderCalendar();
});
els.calToday.addEventListener('click', () => {
  state.calendarView = state.selectedDateISO
    ? new Date(`${state.selectedDateISO}T00:00:00`)
    : new Date();
  renderCalendar();
});
els.calMonthSelect.addEventListener('change', () => {
  const v = els.calMonthSelect.value;
  if (!v) return;
  const d = new Date(`${v}-01T00:00:00`);
  if (!Number.isFinite(d.getTime())) return;
  state.calendarView = d;
  const mDates = Array.from(state.sessionsByDate.keys()).filter(x => x !== 'unknown' && x.startsWith(v)).sort();
  if (mDates.length) {
    state.selectedDateISO = mDates[mDates.length - 1];
    applyRangeMode(state.selectedRange.mode || 'night');
  }
  renderCalendar();
});

// Mapping
els.applyMappingBtn.addEventListener('click', async () => {
  applyMappingFromUI();
  await extractSignalsAndRender(analyzeAndRender);
  await renderExplorePlot();
});
els.exploreSelect.addEventListener('change', async () => { await renderExplorePlot(); });

/* ============================
   Demo
   ============================ */
els.demoBtn.addEventListener('click', () => {
  resetAll();
  setStatus('Demo', 'good');
  els.fileBadge.textContent = 'demo.zip';
  els.zipStats.textContent  = 'demo';
  progress('Demo', 100, 'Loaded synthetic data for layout + charts.');

  state.identification = {
    Manufacturer: 'ResMed (demo)', Model: 'AirSense 11 (demo)',
    Mode: 'AutoSet (demo)',        SerialNumber: 'DEMO-12345'
  };
  renderIdentification(state.identification);

  const start = new Date(); start.setHours(23, 0, 0, 0);
  const dateISO = localDateISO(start);
  const end     = new Date(start.getTime() + 7 * 3600 * 1000);

  const sess = {
    key: `${dateISO}__DAY`, label: `${dateISO} — Day`,
    start, end,
    files: [{ path: 'demo/STR.edf', entry: null, _folderDateISO: dateISO }]
  };
  state.sessionsByDate.set(dateISO, { dateISO, sessions: [sess] });
  enablePicker(true);

  const t = [], leak = [], pressure = [], flow = [];
  const mins = 7 * 60;
  for (let i = 0; i <= mins; i++) {
    const d = new Date(start.getTime() + i * 60 * 1000);
    t.push(d);
    const baseLeak = 6 + 2 * Math.sin(i / 33);
    const spike    = (i > 180 && i < 210) ? 18 + 7 * Math.sin(i / 2) : 0;
    const spike2   = (i > 330 && i < 360) ? 26 + 7 * Math.sin(i / 3) : 0;
    leak.push(Math.max(0, baseLeak + spike + spike2 + (Math.random() - 0.5) * 1.0));
    const baseP  = 8 + 0.6 * Math.sin(i / 70);
    const bump   = (i > 120 && i < 260) ? 2.4 : 0;
    const bump2  = (i > 320 && i < 420) ? 1.6 : 0;
    pressure.push(baseP + bump + bump2 + (Math.random() - 0.5) * 0.25);
    flow.push(Math.sin(i / 2) * (0.5 + Math.random() * 0.2));
  }
  const evtT = [], evtType = [];
  for (let k = 0; k < 22; k++) {
    const m = Math.floor(Math.random() * mins);
    evtT.push(new Date(start.getTime() + m * 60 * 1000));
    const r = Math.random();
    evtType.push(r < 0.5 ? 'H' : r < 0.85 ? 'OA' : r < 0.95 ? 'RERA' : 'CA');
  }
  evtT.sort((a, b) => a - b);

  state.current.session = sess;
  state.current.signals = {
    leak:     { t: [...t], y: leak,     unit: 'L/min',  label: 'Leak',     _source: 'demo' },
    pressure: { t: [...t], y: pressure, unit: 'cmH₂O', label: 'Pressure', _source: 'demo' },
    flow:     { t: [...t], y: flow,     unit: 'a.u.',   label: 'Flow',     _source: 'demo' }
  };
  state.current.events = { t: evtT, type: evtType };

  analyzeAndRender();
  toast('Demo ready');
});

/* ============================
   Init
   ============================ */
initUI();
resetAll();
