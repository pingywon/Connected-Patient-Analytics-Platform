// ZIP enumeration, session indexing, and device JSON parsing.
/* global JSZip */
import { els } from './dom.js';
import { state } from './state.js';
import { escapeHtml, humanizeWords, shortValue, shortenIdKey, flattenObject, formatSettingsLabel } from './utils.js';
import { parseEDFHeader, estimateDurationSeconds } from './edf.js';

/* ---------- ZIP enumeration ---------- */
export function enumerateZipEntries(zip) {
  const rawPaths = [];
  zip.forEach((path, entry) => { if (!entry.dir) rawPaths.push(path); });

  let prefix = '';
  if (rawPaths.length) {
    const firstSegs = rawPaths.map(p => p.split('/')[0]).filter(Boolean);
    const uniq = Array.from(new Set(firstSegs));
    if (uniq.length === 1) prefix = uniq[0] + '/';
  }

  const markers = {};
  const entries = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const norm  = normalizeZipPath(path, prefix);
    const lower = norm.toLowerCase();
    if (lower.startsWith('datalog/'))         markers.DATALOG  = true;
    if (lower.startsWith('settings/'))        markers.SETTINGS = true;
    if (lower === 'identification.json')      markers.ID       = true;
    if (lower === 'str.edf')                  markers.STR      = true;
    entries.push({ path: norm, entry });
  });

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, prefix, markers };
}

export function normalizeZipPath(path, detectedPrefix) {
  let p = String(path || '').replace(/\\/g, '/').trim();
  if (detectedPrefix && p.startsWith(detectedPrefix)) p = p.slice(detectedPrefix.length);
  p = p.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  return p;
}

/* ---------- SD session indexing ---------- */
function isYYYYMMDD(seg) { return /^[0-9]{8}$/.test(seg); }
function yyyymmddToISO(s) {
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  return `${y}-${m}-${d}`;
}
function localDateISO_zip(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function indexSessionsFromSDStructure(entries, jobId, assertActive, tick, progress, log) {
  const sessionsByDate = new Map();
  const edfs           = entries.filter(e => e.path.toLowerCase().endsWith('.edf'));
  const dayFolders     = new Map();
  let   strEntry       = null;

  for (const e of edfs) {
    assertActive(jobId);
    const p     = e.path.replace(/\\/g, '/');
    const parts = p.split('/').filter(Boolean);

    if (parts.length === 1 && parts[0].toLowerCase() === 'str.edf') {
      strEntry = e;
      continue;
    }

    if (parts.length >= 3 && parts[0].toLowerCase() === 'datalog' && isYYYYMMDD(parts[1])) {
      const dateISO = yyyymmddToISO(parts[1]);
      if (!dayFolders.has(dateISO)) dayFolders.set(dateISO, []);
      dayFolders.get(dateISO).push({ path: e.path, entry: e.entry, _folderDateISO: dateISO });
    }
  }

  const dates            = Array.from(dayFolders.keys()).sort();
  let   fileCounter      = 0;
  const totalFolderEdfs  = Array.from(dayFolders.values()).reduce((a, b) => a + b.length, 0);

  for (let di = 0; di < dates.length; di++) {
    assertActive(jobId);
    const dateISO = dates[di];
    const files   = dayFolders.get(dateISO) || [];
    let minStart  = null;
    let maxEnd    = null;

    for (let fi = 0; fi < files.length; fi++) {
      assertActive(jobId);
      fileCounter++;
      const pct = 40 + (fileCounter / Math.max(1, totalFolderEdfs)) * 20;
      progress('Indexing days', pct, `Reading headers ${fileCounter}/${totalFolderEdfs}: ${files[fi].path.split('/').pop()}`);
      if ((fileCounter % 2) === 0) await tick();

      try {
        const buf    = await files[fi].entry.async('arraybuffer');
        assertActive(jobId);
        const header = parseEDFHeader(buf);
        const parsedStart = header?.start instanceof Date && Number.isFinite(header.start.getTime()) && header.start.getFullYear() >= 2000
          ? header.start
          : new Date(`${dateISO}T12:00:00`);
        if (parsedStart && Number.isFinite(parsedStart.getTime())) {
          const durSec = estimateDurationSeconds(buf, header);
          const end    = new Date(parsedStart.getTime() + durSec * 1000);
          if (!minStart || parsedStart < minStart) minStart = parsedStart;
          if (!maxEnd   || end > maxEnd)           maxEnd   = end;
        }
      } catch (err) {
        log(`Header read failed: ${files[fi].path} (${err?.message || err})`);
      }
    }

    const session = {
      key:   `${dateISO}__DAY`,
      label: `${dateISO} — Day`,
      start: minStart || new Date(dateISO + 'T00:00:00'),
      end:   maxEnd   || new Date(dateISO + 'T08:00:00'),
      files
    };
    sessionsByDate.set(dateISO, { dateISO, sessions: [session] });
  }

  if (strEntry) {
    progress('Indexing STR.edf', 61, 'Reading STR.edf header…');
    await tick();
    assertActive(jobId);

    let attachISO = null;
    try {
      const buf    = await strEntry.entry.async('arraybuffer');
      assertActive(jobId);
      const header = parseEDFHeader(buf);
      if (header?.start) attachISO = localDateISO_zip(header.start);

      if (attachISO) {
        if (!sessionsByDate.has(attachISO)) {
          sessionsByDate.set(attachISO, {
            dateISO: attachISO,
            sessions: [{
              key:   `${attachISO}__DAY`,
              label: `${attachISO} — Day`,
              start: header.start,
              end:   new Date(header.start.getTime() + estimateDurationSeconds(buf, header) * 1000),
              files: []
            }]
          });
        }
        sessionsByDate.get(attachISO).sessions[0].files.push(
          { path: strEntry.path, entry: strEntry.entry, _folderDateISO: attachISO, _isSTR: true }
        );
        log(`STR.edf attached to ${attachISO}`);
      } else {
        log('STR.edf found but could not parse start date; attaching as fallback.');
      }
    } catch (err) {
      log(`STR.edf header parse failed: ${err?.message || err}`);
    }

    if (!attachISO) {
      const fallbackISO = Array.from(sessionsByDate.keys()).filter(d => d !== 'unknown').sort().slice(-1)[0] || 'unknown';
      if (fallbackISO === 'unknown') {
        sessionsByDate.set('unknown', {
          dateISO: 'unknown',
          sessions: [{
            key: 'unknown__STR', label: 'unknown — STR.edf',
            start: new Date(0), end: new Date(0),
            files: [{ path: strEntry.path, entry: strEntry.entry, _folderDateISO: 'unknown', _isSTR: true }]
          }]
        });
      } else {
        sessionsByDate.get(fallbackISO).sessions[0].files.push(
          { path: strEntry.path, entry: strEntry.entry, _folderDateISO: fallbackISO, _isSTR: true }
        );
      }
    }
  }

  log(`Indexed dates: ${sessionsByDate.size} (folder-based)`);
  return { sessionsByDate };
}

/* ---------- Identification.json ---------- */
export async function readIdentification(entries, jobId, assertActive, tick, progress, log) {
  progress('Reading Identification', 36, 'Looking for Identification.json…');
  const idEntry = entries.find(e => e.path.toLowerCase().endsWith('identification.json'));
  if (!idEntry) {
    log('Identification.json not found.');
    state.identification = null;
    els.idArea.innerHTML = `<div class="row"><span>No Identification.json found</span><span class="badge">info</span></div>`;
    progress('Reading Identification', 38, 'No Identification.json found.');
    return;
  }
  try {
    progress('Reading Identification', 37, `Reading ${idEntry.path}…`);
    await tick();
    assertActive(jobId);
    const txt  = await idEntry.entry.async('text');
    assertActive(jobId);
    const json = JSON.parse(txt);
    state.identification = json;
    log(`Identification.json loaded: ${idEntry.path}`);
    renderIdentification(json);
    progress('Reading Identification', 39, 'Identification.json loaded.');
  } catch (e) {
    log('Identification.json present but failed to parse.');
    els.idArea.innerHTML = `<div class="row"><span>Identification.json parse failed</span><span class="badge">warn</span></div>`;
    progress('Reading Identification', 39, 'Identification.json parse failed.');
  }
}

export function renderIdentification(obj) {
  const flat  = flattenObject(obj, 5);
  const items = Object.entries(flat)
    .map(([k, v]) => ({ key: k, short: shortenIdKey(k), val: v }))
    .filter(it => it.val != null && String(it.val).trim() !== '');

  const priorityShort = [
    'Manufacturer', 'Brand', 'Model', 'MachineModel', 'Mode', 'PAPMode',
    'SerialNumber', 'DeviceSerial', 'DeviceSerialNumber', 'Patient', 'Profile', 'Name', 'User',
    'FG P1.Manufacturer', 'FG P1.Model', 'FG P1.SerialNumber', 'FG P1.DeviceSerial',
    'FG P1.Mode', 'FG P1.PAPMode'
  ].map(s => s.toLowerCase());

  items.sort((a, b) => {
    const ai = priorityShort.indexOf(a.short.toLowerCase());
    const bi = priorityShort.indexOf(b.short.toLowerCase());
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.short.localeCompare(b.short);
  });

  const getLike = (needle) => {
    const n   = needle.toLowerCase();
    const hit = items.find(it => it.short.toLowerCase() === n) ||
                items.find(it => it.short.toLowerCase().includes(n));
    return hit ? String(hit.val ?? '') : '';
  };

  const make        = getLike('Manufacturer') || getLike('Brand') || getLike('FG P1.Manufacturer') || '';
  const model       = getLike('Model') || getLike('MachineModel') || getLike('FG P1.Model') || '';
  const productCode = getLike('Product Product Name') || getLike('ProductName') || getLike('ProductCode') || '';
  const headline    = (make + ' ' + model).trim() || 'Unknown';

  const headerRow = `
    <div class="row">
      <span><b>Detected device</b></span>
      <span class="badge">${escapeHtml(headline)}</span>
    </div>
    ${productCode ? `
      <div class="row">
        <span style="opacity:.85">Product Code</span>
        <span><b>${escapeHtml(productCode)}</b></span>
      </div>` : ''}
  `;

  const rows = [];
  const used = new Set();
  for (const it of items) {
    if (rows.length >= 14) break;
    const sk = it.short;
    if (used.has(sk)) continue;
    if (typeof it.val === 'object') continue;
    rows.push(`
      <div class="row">
        <span>${escapeHtml(humanizeWords(sk))}</span>
        <span><b>${escapeHtml(shortValue(it.val))}</b></span>
      </div>`);
    used.add(sk);
  }

  els.idArea.innerHTML = headerRow + (rows.join('') || `<div class="row"><span>No readable fields</span><span class="badge">json</span></div>`);
}

/* ---------- CurrentSettings.json ---------- */
export async function readCurrentSettings(entries, jobId, assertActive) {
  const csEntry = entries.find(e => e.path.toLowerCase().endsWith('currentsettings.json'));
  if (!csEntry) {
    state.currentSettings = null;
    els.settingsArea.innerHTML = `<div class="row"><span>No CurrentSettings.json found</span><span class="badge">info</span></div>`;
    return;
  }
  try {
    assertActive(jobId);
    const txt  = await csEntry.entry.async('text');
    assertActive(jobId);
    const json = JSON.parse(txt);
    state.currentSettings = json;
    renderCurrentSettings(json);
  } catch (_e) {
    state.currentSettings = null;
    els.settingsArea.innerHTML = `<div class="row"><span>CurrentSettings.json parse failed</span><span class="badge">warn</span></div>`;
  }
}

function renderCurrentSettings(obj) {
  const sp             = obj?.FlowGenerator?.SettingProfiles;
  const activeName     = sp?.ActiveProfiles?.TherapyProfile || '';
  const therapyProfiles = sp?.TherapyProfiles || {};
  const featureProfiles = sp?.FeatureProfiles || {};
  const activeTherapy  = activeName && therapyProfiles[activeName] ? therapyProfiles[activeName] : null;

  const rows = [];
  if (activeName) rows.push(`<div class="row"><span>Active Therapy Profile</span><span><b>${escapeHtml(activeName)}</b></span></div>`);
  if (activeTherapy) {
    for (const [k, v] of Object.entries(activeTherapy)) {
      rows.push(`<div class="row"><span>${escapeHtml(formatSettingsLabel(k))}</span><span><b>${escapeHtml(shortValue(v))}</b></span></div>`);
    }
  }

  const featureNames = Array.isArray(sp?.ActiveProfiles?.FeatureProfiles) ? sp.ActiveProfiles.FeatureProfiles : [];
  for (const name of featureNames.slice(0, 10)) {
    const cfg = featureProfiles[name];
    if (!cfg || typeof cfg !== 'object') continue;
    const vals = Object.entries(cfg).slice(0, 2).map(([k, v]) => `${formatSettingsLabel(k)}: ${shortValue(v)}`).join(' • ');
    rows.push(`<div class="row" title="${escapeHtml(vals)}"><span>${escapeHtml(formatSettingsLabel(name))}</span><span><b>${escapeHtml(vals || 'Configured')}</b></span></div>`);
  }

  if (!rows.length) {
    els.settingsArea.innerHTML = `<div class="row"><span>No TherapyProfiles settings found</span><span class="badge">json</span></div>`;
    return;
  }
  els.settingsArea.innerHTML = rows.slice(0, 14).join('');
}
