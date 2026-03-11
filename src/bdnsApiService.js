const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const CACHE_FILE = path.join(DATA_DIR, 'bdns-api-cache.json');
const STATE_FILE = path.join(DATA_DIR, 'bdns-api-state.json');

const SEARCH_URL = process.env.BDNS_API_SEARCH_URL || null; // full URL or base URL
const CHECK_HOURS = parseFloat(process.env.BDNS_API_CHECK_INTERVAL_HOURS || '6');

let state = {
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastQuery: null,
  itemCount: 0,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      state = { ...state, ...data };
    }
  } catch (e) {
    console.warn('[bdns-api] could not read state — starting fresh');
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[bdns-api] error saving state:', e.message);
  }
}

function mapRecord(rec) {
  // best-effort mapping from various possible response shapes
  const title = rec.title || rec.TITULO || rec.titulo || rec.descripcion || '';
  const link = rec.link || rec.url || rec.enlace || '';
  const idBase = rec.id || rec.ID || link + title || '';
  const id = crypto.createHash('md5').update(idBase).digest('hex').substring(0, 12);
  return {
    id,
    fuente: 'BDNS',
    titulo: title && (typeof title === 'object' ? (title._ || title) : title),
    enlace: link,
    organo: rec.organo || rec.organismo || rec.entidad || null,
    localizacion: rec.ambito || rec.comunidad || null,
    estado: rec.estado || rec.ESTADO || null,
    hasta: rec.fechaHasta || rec.FECHA_FIN || null,
    published: rec.fechaPublicacion || rec.published || null,
    scrapedAt: new Date().toISOString(),
    _raw: rec,
  };
}

async function parseResponse(data, contentType) {
  if (!data) return [];
  // Try JSON first
  if (typeof data === 'object') {
    const arr = data.items || data.results || data.registros || data.registro || data.records || data.records_list || null;
    if (Array.isArray(arr)) return arr.map(mapRecord);
    // fallback: if root is array
    if (Array.isArray(data)) return data.map(mapRecord);
    // try single record
    return [mapRecord(data)];
  }

  // If text, inspect content type
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('xml') || data.trim().startsWith('<')) {
    const json = await parseStringPromise(data, { explicitArray: false, mergeAttrs: true });
    // Try common nodes
    const registros = json.registros || json.result || json.feed || json.response || json.root || null;
    // Flatten
    const candidates = [];
    function collect(obj) {
      if (!obj) return;
      if (Array.isArray(obj)) obj.forEach(collect);
      else if (typeof obj === 'object') {
        // if object looks like a record
        if (obj.titulo || obj.TITULO || obj.descripcion || obj.id) candidates.push(obj);
        else Object.values(obj).forEach(collect);
      }
    }
    collect(registros || json);
    return candidates.map(mapRecord);
  }

  // last resort: no parseable content
  return [];
}

async function search(params = {}) {
  ensureDataDir();
  loadState();
  if (!SEARCH_URL) throw new Error('BDNS_API_SEARCH_URL not configured');
  state.lastCheckedAt = new Date().toISOString();
  state.lastQuery = params;
  const res = await axios.get(SEARCH_URL, { params, responseType: 'text' });
  const contentType = res.headers['content-type'] || '';
  const items = await parseResponse(res.data, contentType);
  return items;
}

async function fetchOpen(force = false) {
  ensureDataDir();
  loadState();
  state.lastCheckedAt = new Date().toISOString();
  const params = { estado: 'Abierta' };
  const items = await search(params);
  const prev = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : null;
  const newHash = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
  const oldHash = prev ? crypto.createHash('sha256').update(JSON.stringify(prev)).digest('hex') : null;
  const changed = force || (oldHash !== newHash);
  if (changed) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(items, null, 2), 'utf8');
    state.lastSyncedAt = new Date().toISOString();
    state.itemCount = items.length;
    saveState();
  }
  return { checked: true, itemCount: items.length, changed, items };
}

function getCachedData() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (e) { console.warn('[bdns-api] error reading cache', e.message); }
  return [];
}

function getState() { loadState(); return { ...state, searchUrl: SEARCH_URL }; }

let intervalId = null;
function startPeriodicCheck() {
  if (!SEARCH_URL) return;
  const intervalMs = CHECK_HOURS * 60 * 60 * 1000;
  intervalId = setInterval(async () => {
    try {
      const r = await fetchOpen(false);
      console.log('[bdns-api] periodic check:', r.changed ? 'updated' : 'no-change');
    } catch (e) {
      console.warn('[bdns-api] periodic error:', e.message);
    }
  }, intervalMs);
  intervalId.unref?.();
}

module.exports = { search, fetchOpen, getCachedData, getState, startPeriodicCheck };
