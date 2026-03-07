// UI helpers: toast, status, log, progress, tabs, sidebar, calendar, resetAll.
import { els } from './dom.js';
import { state, newJob } from './state.js';
import { localDateISO, pad2, humanizeWords, isoToDate, addDaysISO, monthBoundsISO } from './utils.js';
import { purgePlots, placeholderPlots, resizePlots } from './charts.js';

/* ---------- Toast ---------- */
let _toastTimer = 0;
export function toast(msg) {
  els.toast.textContent = msg;
  els.toast.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => els.toast.style.display = 'none', 2400);
}

/* ---------- Status badge ---------- */
export function setStatus(text, tone = 'neutral') {
  els.statusBadge.textContent = text;
  const map = {
    neutral: 'rgba(255,255,255,.06)',
    good:    'rgba(110,231,166,.12)',
    warn:    'rgba(255,204,102,.14)',
    bad:     'rgba(255,107,122,.14)',
  };
  els.statusBadge.style.background = map[tone] || map.neutral;
  els.statusBadge.style.borderColor = 'rgba(255,255,255,.14)';
}

/* ---------- Debug log ---------- */
export function log(line) {
  state.notes.push(line);
  els.log.textContent = state.notes.join('\n');
}

/* ---------- Progress bar (RAF-throttled) ---------- */
const progressState = { step: 'Idle', pct: 0, detail: '', raf: 0 };
export function progress(step, pct, detail = '') {
  progressState.step = step;
  progressState.pct = Math.max(0, Math.min(100, pct));
  progressState.detail = detail || '';
  if (progressState.raf) return;
  progressState.raf = requestAnimationFrame(() => {
    progressState.raf = 0;
    els.progressStep.textContent = progressState.step;
    els.progressPct.textContent = `${Math.round(progressState.pct)}%`;
    els.progressBar.style.width = `${progressState.pct}%`;
    els.progressDetail.textContent = progressState.detail;
  });
}

/* ---------- Tabs (ARIA + keyboard) ---------- */
export function setActiveTab(tabId) {
  const tabs   = Array.from(els.tablist.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
  for (const t of tabs) {
    const active = t.id === tabId;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
    t.tabIndex = active ? 0 : -1;
  }
  for (const p of panels) {
    p.classList.toggle('active', p.getAttribute('aria-labelledby') === tabId);
  }
}

/* ---------- Sidebar ---------- */
export function updateSidebarToggleUI(collapsed) {
  els.toggleLeftBtn.textContent = collapsed ? 'Open Sidebar' : 'Hide Sidebar';
  els.toggleLeftBtn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  if (els.floatingSidebarBtn) {
    els.floatingSidebarBtn.style.display = collapsed ? 'inline-flex' : 'none';
    els.floatingSidebarBtn.textContent = 'Open Sidebar';
  }
  setTimeout(() => resizePlots(), 40);
}

/* ---------- Calendar ---------- */
export function updateRangeHint() {
  const { startISO, endISO, mode } = state.selectedRange;
  if (!startISO || !endISO) { els.rangeHint.textContent = 'Select a date range.'; return; }
  const labelMode = humanizeWords(mode).replace(/^./, c => c.toUpperCase());
  els.rangeHint.textContent = `${labelMode}: ${startISO} → ${endISO}`;
}

export function applyRangeMode(mode) {
  state.selectedRange.mode = mode;
  const btns = [els.modeNight, els.modeWeek, els.modeMonth, els.modeCustom];
  for (const b of btns) b.classList.toggle('active', b.id === `mode${mode[0].toUpperCase() + mode.slice(1)}`);

  const anchor = state.selectedDateISO ||
    Array.from(state.sessionsByDate.keys()).filter(d => d !== 'unknown').sort().slice(-1)[0];
  if (!anchor) return;

  if (mode === 'night') {
    state.selectedRange.pickingStart = true;
    state.selectedRange.startISO = anchor;
    state.selectedRange.endISO = anchor;
  } else if (mode === 'week') {
    state.selectedRange.pickingStart = true;
    state.selectedRange.startISO = addDaysISO(anchor, -6);
    state.selectedRange.endISO = anchor;
  } else if (mode === 'month') {
    state.selectedRange.pickingStart = true;
    const b = monthBoundsISO(anchor);
    state.selectedRange.startISO = b.start;
    state.selectedRange.endISO = b.end;
  } else if (mode === 'custom') {
    state.selectedRange.pickingStart = true;
    state.selectedRange.startISO = state.selectedRange.startISO || anchor;
    state.selectedRange.endISO = state.selectedRange.endISO || anchor;
  }

  const dates = Array.from(state.sessionsByDate.keys()).filter(d => d !== 'unknown').sort();
  const min = dates[0] || '';
  const max = dates[dates.length - 1] || '';
  if (min && state.selectedRange.startISO < min) state.selectedRange.startISO = min;
  if (max && state.selectedRange.endISO > max)   state.selectedRange.endISO = max;
  if (state.selectedRange.startISO > state.selectedRange.endISO) {
    const t = state.selectedRange.startISO;
    state.selectedRange.startISO = state.selectedRange.endISO;
    state.selectedRange.endISO = t;
  }
  updateRangeHint();
  renderCalendar();
}

export function renderCalendar() {
  if (!els.calGrid) return;
  els.calGrid.innerHTML = '';

  const dates   = new Set(Array.from(state.sessionsByDate.keys()).filter(d => d !== 'unknown'));
  const base    = state.calendarView || isoToDate(state.selectedDateISO || localDateISO(new Date())) || new Date();
  const y = base.getFullYear(), m = base.getMonth();

  const allDates = Array.from(state.sessionsByDate.keys()).filter(d => d !== 'unknown').sort();
  const months   = Array.from(new Set(allDates.map(d => d.slice(0, 7))));
  const curMonth = `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`;

  els.calMonthSelect.innerHTML = months
    .map(mo => `<option value="${mo}">${new Date(`${mo}-01T00:00:00`).toLocaleString(undefined, { month: 'long', year: 'numeric' })}</option>`)
    .join('');
  els.calMonthSelect.value = months.includes(curMonth) ? curMonth : (months[months.length - 1] || '');

  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  for (let i = 0; i < 42; i++) {
    const d   = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = localDateISO(d);
    const b   = document.createElement('button');
    b.type      = 'button';
    b.className = 'day';
    if (d.getMonth() !== m) b.classList.add('muted');
    if (dates.has(iso))     b.classList.add('hasData');
    if (
      state.selectedRange.startISO && state.selectedRange.endISO &&
      iso >= state.selectedRange.startISO && iso <= state.selectedRange.endISO
    ) {
      b.classList.add('selected');
      if (iso === state.selectedRange.startISO || iso === state.selectedRange.endISO) b.classList.add('boundary');
    }
    b.textContent = String(d.getDate());
    b.disabled    = !dates.has(iso);
    b.addEventListener('click', () => {
      state.selectedDateISO = iso;
      if (state.selectedRange.mode === 'custom') {
        if (state.selectedRange.pickingStart) {
          state.selectedRange.startISO    = iso;
          state.selectedRange.endISO      = iso;
          state.selectedRange.pickingStart = false;
        } else {
          state.selectedRange.endISO = iso;
          if (state.selectedRange.startISO > state.selectedRange.endISO) {
            const t = state.selectedRange.startISO;
            state.selectedRange.startISO = state.selectedRange.endISO;
            state.selectedRange.endISO   = t;
          }
          state.selectedRange.pickingStart = true;
        }
      } else {
        applyRangeMode(state.selectedRange.mode);
      }
      updateRangeHint();
      renderCalendar();
    });
    els.calGrid.appendChild(b);
  }
}

export function enablePicker(autoSelectMostRecent) {
  const dates = Array.from(state.sessionsByDate.keys()).filter(d => d !== 'unknown').sort();
  const max   = dates[dates.length - 1] || '';

  els.loadRangeBtn.disabled = !max;

  if (!max) {
    state.selectedRange = { mode: 'night', startISO: null, endISO: null, pickingStart: true };
    state.selectedDateISO = null;
    els.rangeHint.textContent = 'Upload a ZIP to enable calendar range selection.';
    els.rangeControls.classList.add('disabled');
    els.rangeControls.classList.remove('ready');
    renderCalendar();
    return;
  }

  state.selectedDateISO = autoSelectMostRecent ? max : (state.selectedDateISO || max);
  state.selectedRange.startISO = state.selectedDateISO;
  state.selectedRange.endISO   = state.selectedDateISO;
  state.calendarView = state.calendarView || new Date(`${state.selectedDateISO}T00:00:00`);

  applyRangeMode(state.selectedRange.mode || 'night');
  els.rangeControls.classList.remove('disabled');
  els.rangeControls.classList.add('ready');
  renderCalendar();
}

/* ---------- Reset all ---------- */
export function resetAll() {
  newJob();

  state.zip = null;
  state.entries = [];
  state.meta = { prefix: '', rootMarkers: {} };
  state.identification = null;
  state.currentSettings = null;
  state.sessionsByDate.clear();
  state.selectedDateISO = null;
  state.selectedRange = { mode: 'night', startISO: null, endISO: null, pickingStart: true };
  state.calendarView = null;
  state.current = {
    session: null, edfFiles: [], signalCatalog: [],
    mapping: { leak: null, pressure: null, flow: null, snore: null, respRate: null, tidalVolume: null, annotations: null },
    signals: {}, events: null, stats: {}, raw: {}
  };
  state.notes = [];

  els.zipInput.value = '';
  els.fileBadge.textContent = 'No file';
  els.zipStats.textContent = '—';

  els.idArea.innerHTML      = `<div class="row"><span>Waiting for upload…</span><span class="badge">—</span></div>`;
  els.settingsArea.innerHTML = `<div class="row"><span>Waiting for upload…</span><span class="badge">—</span></div>`;

  els.loadRangeBtn.disabled = true;
  els.rangeHint.textContent = 'Upload a ZIP to enable calendar range selection.';
  els.rangeControls.classList.add('disabled');
  els.rangeControls.classList.remove('ready');

  els.mapGrid.innerHTML = '';
  els.applyMappingBtn.disabled = true;

  els.kpiUsage.textContent     = '—'; els.kpiUsageNote.textContent    = 'Select a day.';
  els.kpiLeak95.textContent    = '—'; els.kpiLeak95Note.textContent   = 'Needs leak signal.';
  els.kpiP50.textContent       = '—'; els.kpiP50Note.textContent      = 'Needs pressure signal.';
  els.kpiAHI.textContent       = '—'; els.kpiAHINote.textContent      = 'From annotations if found.';

  els.overviewSummary.innerHTML  = `<b>Status</b><br/>Upload a ZIP to begin.`;
  els.overviewNarrative.innerHTML = '';
  els.leakNarrative.innerHTML     = '';
  els.pressureNarrative.innerHTML = '';
  els.flowNarrative.innerHTML     = '';
  els.snoreNarrative.innerHTML    = '';
  els.respRateNarrative.innerHTML = '';
  els.tidalNarrative.innerHTML    = '';
  els.eventsLegend.innerHTML      = '';
  els.eventsNarrative.innerHTML   = '';
  els.exploreNarrative.innerHTML  = '<b>Explore:</b> choose a mapped signal from the large dropdown below to display it here.';
  els.exploreSelect.innerHTML     = '<option value="">Choose a mapped signal (large selector)…</option>';
  els.exploreSelect.disabled      = true;

  els.rawSummary.innerHTML = '';
  els.rawDump.textContent  = '';

  applyRangeMode('night');
  renderCalendar();

  progress('Idle', 0, 'Upload a ZIP to begin.');
  setStatus('Waiting', 'neutral');

  purgePlots();
  placeholderPlots();
  log('Ready.');
}

/* ---------- Wire up self-contained UI event listeners ---------- */
export function initUI() {
  // Tabs
  els.tablist.addEventListener('click', (e) => {
    const btn = e.target.closest('[role="tab"]');
    if (!btn) return;
    setActiveTab(btn.id);
  });
  els.tablist.addEventListener('keydown', (e) => {
    const tabs    = Array.from(els.tablist.querySelectorAll('[role="tab"]'));
    const current = document.activeElement;
    const idx     = tabs.indexOf(current);
    if (idx === -1) return;
    let next = idx;
    if      (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft')  next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home')       next = 0;
    else if (e.key === 'End')        next = tabs.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab(current.id); return; }
    else return;
    e.preventDefault();
    tabs[next].focus();
  });

  // Sidebar toggle
  els.toggleLeftBtn.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('left-collapsed');
    updateSidebarToggleUI(collapsed);
  });
  els.floatingSidebarBtn?.addEventListener('click', () => {
    document.body.classList.remove('left-collapsed');
    updateSidebarToggleUI(false);
  });
}
