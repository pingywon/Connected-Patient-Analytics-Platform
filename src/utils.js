// Pure utility functions — no DOM, no state dependencies.

export function tick() { return new Promise(r => setTimeout(r, 0)); }

export function pad2(n) { return String(n).padStart(2, '0'); }

export function localDateISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

export function humanizeWords(s) {
  return String(s || '')
    .replace(/[._\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/FG Identification Profiles/gi, '')
    .replace(/\bEpr\b/g, 'EPR')
    .replace(/\bAhi\b/g, 'AHI')
    .replace(/\bCpap\b/g, 'CPAP')
    .replace(/\bAutoSet\b/g, 'AutoSet')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatSettingsLabel(s) {
  let t = humanizeWords(s);
  t = t.replace(/\bFeature\b/g, 'Features');
  t = t.replace(/\bFeatures\s+Features\b/gi, 'Features');
  t = t.replace(/\b(\w+)\s+\1\b/gi, '$1');
  return t;
}

export function fmtTime(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '—';
  const y = d.getFullYear(), m = pad2(d.getMonth() + 1), da = pad2(d.getDate());
  const hh = pad2(d.getHours()), mm = pad2(d.getMinutes());
  return `${y}-${m}-${da} ${hh}:${mm}`;
}

export function fmtNum(x, digits = 1) {
  return (x == null || !Number.isFinite(x)) ? '—' : Number(x).toFixed(digits);
}

export function fmtHours(h) {
  return (h == null || !Number.isFinite(h)) ? '—' : `${h.toFixed(2)} h`;
}

export function flattenObject(obj, depth = 5) {
  const out = {};
  function rec(o, d, p) {
    if (o == null) return;
    if (typeof o !== 'object') { out[p] = o; return; }
    if (Array.isArray(o)) {
      out[p] = `[array x${o.length}]`;
      if (d > 0) {
        for (let i = 0; i < Math.min(o.length, 6); i++) {
          rec(o[i], d - 1, p ? `${p}[${i}]` : `[${i}]`);
        }
      }
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      const np = p ? `${p}.${k}` : k;
      if (typeof v === 'object' && v !== null && d > 0) rec(v, d - 1, np);
      else out[np] = v;
    }
  }
  rec(obj, depth, '');
  return out;
}

export function shortValue(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return '[object]';
  const s = String(v);
  return s.length > 52 ? s.slice(0, 49) + '…' : s;
}

export function shortenIdKey(path) {
  let k = String(path || '');
  k = k.replace(/^FlowGenerator\./, 'FG.');
  k = k.replace(/^FG\.IdentificationProfiles\[(\d+)\]\.Identification\./, (_, idx) => `FG P${(+idx) + 1}.`);
  k = k.replace(/^FG\.IdentificationProfiles\[(\d+)\]\./, (_, idx) => `FG P${(+idx) + 1}.`);
  k = k.replace(/^Identification\./, '');
  k = k.replace(/^Device\./, '');
  k = k.replace(/DeviceSerialNumber/i, 'DeviceSerial');
  k = k.replace(/DeviceSerial/i, 'DeviceSerial');
  k = k.replace(/SerialNumber/i, 'SerialNumber');
  k = k.replace(/MachineModel/i, 'MachineModel');
  k = k.replace(/PAPMode/i, 'PAPMode');
  k = k.replace(/\.?Meta\.?/g, '.Meta.');
  return k;
}

export function cleanNums(arr) { return (arr || []).filter(v => Number.isFinite(v)); }

export function percentile(arr, p) {
  const a = cleanNums(arr).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const w = idx - lo;
  return a[lo] * (1 - w) + a[hi] * w;
}

export function timeSpanHours(series) {
  if (!series?.t?.length) return null;
  return (series.t[series.t.length - 1] - series.t[0]) / 1000 / 3600;
}

export function formatHours(sec) { return `${(sec / 3600).toFixed(2)}h`; }

export function isoToDate(iso) { return iso ? new Date(`${iso}T00:00:00`) : null; }

export function addDaysISO(iso, days) {
  const d = isoToDate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return localDateISO(d);
}

export function monthBoundsISO(iso) {
  const d = isoToDate(iso);
  if (!d) return { start: null, end: null };
  const a = new Date(d.getFullYear(), d.getMonth(), 1);
  const b = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: localDateISO(a), end: localDateISO(b) };
}
