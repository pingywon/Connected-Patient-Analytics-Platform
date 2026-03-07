// EDF (European Data Format) parsing — no DOM, no state dependencies.

function readAscii(view, offset, length) {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function trim(s) { return String(s).trim(); }
function parseIntSafe(s) { const n = parseInt(String(s).trim(), 10); return Number.isFinite(n) ? n : null; }
function parseFloatSafe(s) { const n = parseFloat(String(s).trim().replace(',', '.')); return Number.isFinite(n) ? n : null; }

function parseEDFStartDateTime(ddmmyy, hhmmss) {
  const d = trim(ddmmyy), t = trim(hhmmss);
  const dm = d.split('.'); const tm = t.split('.');
  if (dm.length < 3 || tm.length < 3) return null;
  const dd = parseIntSafe(dm[0]), mm = parseIntSafe(dm[1]), yy = parseIntSafe(dm[2]);
  const HH = parseIntSafe(tm[0]), MM = parseIntSafe(tm[1]), SS = parseIntSafe(tm[2]);
  if ([dd, mm, yy, HH, MM, SS].some(x => x == null)) return null;
  const fullY = (yy <= 84) ? (2000 + yy) : (1900 + yy);
  return new Date(fullY, mm - 1, dd, HH, MM, SS);
}

export function parseEDFHeader(buffer) {
  const view = new DataView(buffer);
  const version     = trim(readAscii(view, 0, 8));
  const patientId   = trim(readAscii(view, 8, 80));
  const recordingId = trim(readAscii(view, 88, 80));
  const startDate   = trim(readAscii(view, 168, 8));
  const startTime   = trim(readAscii(view, 176, 8));
  const headerBytes = parseIntSafe(readAscii(view, 184, 8)) || 0;
  const reserved    = trim(readAscii(view, 192, 44));
  const numRecords  = parseIntSafe(readAscii(view, 236, 8));
  const recordDuration = parseFloatSafe(readAscii(view, 244, 8)) || 1;
  const numSignals  = parseIntSafe(readAscii(view, 252, 4)) || 0;
  const start       = parseEDFStartDateTime(startDate, startTime);

  let off = 256;
  const readFieldArr = (len) => {
    const arr = [];
    for (let i = 0; i < numSignals; i++) {
      arr.push(trim(readAscii(view, off + i * len, len)));
    }
    off += numSignals * len;
    return arr;
  };

  const labels     = readFieldArr(16);
  const transducer = readFieldArr(80);
  const physDim    = readFieldArr(8);
  const physMinS   = readFieldArr(8);
  const physMaxS   = readFieldArr(8);
  const digMinS    = readFieldArr(8);
  const digMaxS    = readFieldArr(8);
  const prefilter  = readFieldArr(80);
  const sprS       = readFieldArr(8);
  const sigReserved = readFieldArr(32);

  const signals = [];
  for (let i = 0; i < numSignals; i++) {
    const physMin = parseFloatSafe(physMinS[i]);
    const physMax = parseFloatSafe(physMaxS[i]);
    const digMin  = parseFloatSafe(digMinS[i]);
    const digMax  = parseFloatSafe(digMaxS[i]);
    const spr     = parseIntSafe(sprS[i]) || 0;

    const scale = (digMax != null && digMin != null && physMax != null && physMin != null && (digMax - digMin) !== 0)
      ? ((physMax - physMin) / (digMax - digMin))
      : null;
    const offset = (scale != null && digMin != null && physMin != null) ? (physMin - scale * digMin) : null;
    const sampleRate = spr / recordDuration;

    signals.push({
      index: i,
      label: labels[i],
      physDim: physDim[i] || '',
      physMin, physMax, digMin, digMax,
      scale, offset,
      samplesPerRecord: spr,
      sampleRate,
      transducer: transducer[i] || '',
      prefilter: prefilter[i] || '',
      reserved: sigReserved[i] || ''
    });
  }

  return { version, patientId, recordingId, startDate, startTime, start, headerBytes, reserved, numRecords, recordDuration, numSignals, signals };
}

export function estimateDurationSeconds(buffer, header) {
  const nRec = (header.numRecords != null && header.numRecords >= 0) ? header.numRecords : null;
  const dataStart = header.headerBytes || 0;
  const recordBytes = header.signals.reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);
  if (recordBytes <= 0) return 0;
  if (nRec != null) return nRec * (header.recordDuration || 1);
  const approx = Math.floor((buffer.byteLength - dataStart) / recordBytes) * (header.recordDuration || 1);
  return Math.max(0, approx);
}

export function normalizeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u00B2]/g, '2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeLabelLoose(s) {
  return normalizeLabel(s).replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();
}

export function cleanEventLabel(s) {
  const t = String(s || '').replace(/[\x00-\x1F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > 80 ? t.slice(0, 77) + '…' : t;
}

function resolveFileStartDate(file, header) {
  const parsed = header?.start instanceof Date && Number.isFinite(header.start.getTime()) ? header.start : null;
  if (parsed && parsed.getFullYear() >= 2000) return parsed;
  const fallbackISO = file?.folderDateISO || file?._folderDateISO || null;
  if (!fallbackISO) return parsed || new Date(0);
  const d = new Date(`${fallbackISO}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d : (parsed || new Date(0));
}

function readEDFAnnotations(buffer, header, annSig, sigByteOffset, recordBytes, nRec, file) {
  const view = new DataView(buffer);
  const dataStart = header.headerBytes || 0;
  const start = resolveFileStartDate(file, header);

  const bytes = [];
  const isUseful = (b) => b === 0x14 || b === 0x15 || (b >= 0x20 && b <= 0x7E);

  for (let r = 0; r < nRec; r++) {
    const recBase = dataStart + r * recordBytes;
    const sigBase = recBase + sigByteOffset[annSig.index];
    for (let i = 0; i < annSig.samplesPerRecord; i++) {
      const off = sigBase + i * 2;
      if (off + 2 > buffer.byteLength) break;
      const lo = view.getUint8(off);
      const hi = view.getUint8(off + 1);
      bytes.push(lo);
      if (isUseful(hi)) bytes.push(hi);
    }
  }

  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  raw = raw.replace(/\x00+/g, '\x14');

  const evtT = [];
  const evtType = [];
  let currentOnset = null;

  const tokens = raw.split('\x14').map(t => t.trim()).filter(Boolean);
  for (const tok of tokens) {
    const parts = tok.split('\x15');
    const first = (parts[0] || '').trim();
    const onsetMatch = first.match(/^[+-]?\d+(?:\.\d+)?$/);

    if (onsetMatch) {
      currentOnset = parseFloat(first);
      const maybeText = cleanEventLabel(parts.slice(1).join(' | '));
      if (maybeText) {
        evtT.push(new Date(start.getTime() + currentOnset * 1000));
        evtType.push(maybeText);
      }
      continue;
    }

    if (currentOnset == null) continue;
    const text = cleanEventLabel(tok.replace(/^\+/, ''));
    if (!text) continue;
    evtT.push(new Date(start.getTime() + currentOnset * 1000));
    evtType.push(text);
  }

  if (!evtT.length) return null;
  return { t: evtT, type: evtType, source: annSig.label };
}

export async function readSelectedSignalsFromEDF(file, mappingKeys, maxPoints = 90000) {
  const header = file.header;
  const buffer = file.buffer || await file.entry?.async('arraybuffer');
  if (!buffer) throw new Error(`Missing EDF buffer for ${file.path}`);
  const view = new DataView(buffer);
  const dataStart = header.headerBytes || 0;

  const ns = header.numSignals;
  const recordBytes = header.signals.reduce((sum, s) => sum + s.samplesPerRecord * 2, 0);
  if (recordBytes <= 0) throw new Error('EDF recordBytes computed as 0');

  const nRec = header.numRecords != null && header.numRecords >= 0
    ? header.numRecords
    : Math.floor((buffer.byteLength - dataStart) / recordBytes);

  const sigByteOffset = new Array(ns).fill(0);
  {
    let acc = 0;
    for (let i = 0; i < ns; i++) {
      sigByteOffset[i] = acc;
      acc += header.signals[i].samplesPerRecord * 2;
    }
  }

  const wanted = {};
  for (const [k, mappedKey] of Object.entries(mappingKeys)) {
    if (!mappedKey) continue;
    let sig = null;
    if (String(mappedKey).includes('::')) {
      const idx = Number(String(mappedKey).split('::').pop());
      if (Number.isInteger(idx)) sig = header.signals.find(s => s.index === idx) || null;
    }
    if (!sig) {
      sig = header.signals.find(s => normalizeLabelLoose(s.label) === mappedKey || normalizeLabel(s.label) === mappedKey) || null;
    }
    if (sig) wanted[k] = sig;
  }

  const out = {};
  for (const [k, sig] of Object.entries(wanted)) {
    if (k === 'annotations') continue;
    out[k] = { t: [], y: [], unit: sig.physDim || '', label: sig.label, sampleRate: sig.sampleRate, _source: file.path };
  }

  const start = resolveFileStartDate(file, header);

  const ds = {};
  for (const [k, sig] of Object.entries(wanted)) {
    if (k === 'annotations') continue;
    const totalSamples = nRec * sig.samplesPerRecord;
    ds[k] = Math.max(1, Math.floor(totalSamples / maxPoints));
  }

  for (let r = 0; r < nRec; r++) {
    const recBase = dataStart + r * recordBytes;
    for (const [k, sig] of Object.entries(wanted)) {
      if (k === 'annotations') continue;
      const sigBase = recBase + sigByteOffset[sig.index];
      for (let i = 0; i < sig.samplesPerRecord; i++) {
        const sampleIndex = r * sig.samplesPerRecord + i;
        if (sampleIndex % ds[k] !== 0) continue;

        const off = sigBase + i * 2;
        if (off + 2 > buffer.byteLength) break;

        const dig = view.getInt16(off, true);
        let phys = dig;
        if (sig.scale != null && sig.offset != null) phys = sig.scale * dig + sig.offset;

        const seconds = sampleIndex / (sig.sampleRate || 1);
        out[k].t.push(new Date(start.getTime() + seconds * 1000));
        out[k].y.push(phys);
      }
    }
  }

  let events = null;
  if (wanted.annotations) {
    try { events = readEDFAnnotations(buffer, header, wanted.annotations, sigByteOffset, recordBytes, nRec, file); } catch (e) { }
  }

  return { series: out, events };
}

export function mergeSeriesPickBest(existing, incoming) {
  if (!incoming?.t?.length) return existing;
  if (!existing?.t?.length) return incoming;
  const t = existing.t.concat(incoming.t);
  const y = existing.y.concat(incoming.y);
  const idx = t.map((d, i) => [d.getTime(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  return { ...existing, t: idx.map(i => t[i]), y: idx.map(i => y[i]) };
}

export function clipSeriesToWindow(series, start, end) {
  if (!series?.t?.length) return series;
  const startMs = start instanceof Date ? start.getTime() : -Infinity;
  const endMs = end instanceof Date ? end.getTime() : Infinity;
  const idx = series.t
    .map((d, i) => [d?.getTime?.() ?? NaN, i])
    .filter(([ms]) => Number.isFinite(ms) && ms >= startMs && ms <= endMs)
    .map(x => x[1]);
  return { ...series, t: idx.map(i => series.t[i]), y: idx.map(i => series.y[i]) };
}

export function sanitizePressureSeries(series) {
  if (!series?.t?.length) return series;
  const idx = series.y
    .map((v, i) => [v, i])
    .filter(([v]) => Number.isFinite(v) && v >= 0 && v <= 50)
    .map(([, i]) => i);
  if (!idx.length) return series;
  return { ...series, t: idx.map(i => series.t[i]), y: idx.map(i => series.y[i]) };
}
