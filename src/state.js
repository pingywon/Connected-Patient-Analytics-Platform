export const state = {
  jobId: 0,

  zip: null,
  entries: [],
  meta: { prefix: '', rootMarkers: {} },
  identification: null,
  currentSettings: null,

  sessionsByDate: new Map(),
  selectedDateISO: null,
  selectedRange: { mode: 'night', startISO: null, endISO: null, pickingStart: true },
  calendarView: null,
  current: {
    session: null,
    edfFiles: [],
    signalCatalog: [],
    mapping: { leak: null, pressure: null, flow: null, snore: null, respRate: null, tidalVolume: null, annotations: null },
    signals: {},
    events: null,
    stats: {},
    raw: {}
  },
  notes: []
};

export function newJob() {
  state.jobId++;
  return state.jobId;
}

export function assertActive(jobId) {
  if (jobId !== state.jobId) {
    const err = new Error('Cancelled');
    err.name = 'CancelledError';
    throw err;
  }
}
