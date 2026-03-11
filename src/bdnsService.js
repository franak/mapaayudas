const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { parseStringPromise } = require('xml2js');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const CACHE_FILE = path.join(DATA_DIR, 'bdns-cache.json');
const STATE_FILE = path.join(DATA_DIR, 'bdns-state.json');
const FEED_URL = process.env.BDNS_FEED_URL || null;
const CHECK_HOURS = parseFloat(process.env.BDNS_CHECK_INTERVAL_HOURS || '6');

let state = {
  lastCheckedAt: null,
  lastSyncedAt: null,
  etag: null,
  lastId: null,
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
    console.warn('[bdns] No se pudo leer bdns-state.json — empezando desde cero.');
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[bdns] Error guardando estado:', e.message);
  }
}

function hashContent(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function parseFeed(xml) {
  const json = await parseStringPromise(xml, { explicitArray: false });
  const items = [];

  // RSS channel.item
  if (json.rss && json.rss.channel) {
    const raw = json.rss.channel.item;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const it of arr) {
      items.push(normalizeItem({
        id: it.guid || it.link || it.title,
        title: it.title,
        link: it.link,
        author: it['dc:creator'] || it.author,
        published: it.pubDate,
        categories: it.category,
        raw: it,
      }));
    }
  }

  // Atom feed
  if (json.feed && json.feed.entry) {
    const raw = json.feed.entry;
    const arr = Array.isArray(raw) ? raw : [raw];
    for (const it of arr) {
      const link = (it.link && (it.link.href || it.link._)) || (Array.isArray(it.link) ? it.link.find(l => l.rel === 'alternate')?.href : null);
      items.push(normalizeItem({
        id: it.id || link || it.title,
        title: it.title && (typeof it.title === 'object' ? it.title._ : it.title),
        link,
        author: it.author && (it.author.name || it.author),
        published: it.published || it.updated,
        categories: it.category,
        raw: it,
      }));
    }
  }

  return items;
}

function normalizeItem(src) {
  const title = (src.title || '').toString().trim();
  const link = (src.link || '').toString();
  const idBase = src.id || (link + title) || '';
  const id = crypto.createHash('md5').update(idBase).digest('hex').substring(0, 12);
  const originName = process.env.BDNS_ORIGIN_NAME || 'PRTR(ATOM)';
  return {
    id,
    fuente: originName,
    titulo: title,
    enlace: link,
    organo: src.author || null,
    localizacion: null,
    estado: null,
    hasta: null,
    published: src.published || null,
    scrapedAt: new Date().toISOString(),
    _raw: src.raw || null,
  };
}

async function fetchFeed(url = FEED_URL, force = false) {
  ensureDataDir();
  loadState();

  if (!url) {
    throw new Error('No BDNS feed URL configured. Set BDNS_FEED_URL env var.');
  }

  const headers = { 'User-Agent': 'MapaAyudasBot/2.0' };
  if (state.etag && !force) headers['If-None-Match'] = state.etag;

  state.lastCheckedAt = new Date().toISOString();

  const res = await axios.get(url, { headers, responseType: 'text', validateStatus: s => (s >= 200 && s < 400) || s === 304 });

  if (res.status === 304) {
    return { checked: true, itemCount: 0, changed: false, reason: 'Not modified' };
  }

  if (res.headers.etag) state.etag = res.headers.etag;

  const items = await parseFeed(res.data);

  const newHash = hashContent(items);
  const cacheExists = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : null;
  const oldHash = cacheExists ? hashContent(cacheExists) : null;

  const changed = oldHash !== newHash;
  if (changed || force) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(items, null, 2), 'utf8');
    state.lastSyncedAt = new Date().toISOString();
    state.lastContentHash = newHash;
    state.itemCount = items.length;
    saveState();
  }

  return { checked: true, itemCount: items.length, changed, reason: changed ? 'Contenido cambiado' : 'Sin cambios', items };
}

function getCachedData() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (e) {
    console.warn('[bdns] Error leyendo cache:', e.message);
  }
  return [];
}

function getState() {
  loadState();
  return { ...state };
}

let intervalId = null;
function startPeriodicCheck(url = FEED_URL) {
  if (!url) return;
  const intervalMs = CHECK_HOURS * 60 * 60 * 1000;
  console.log(`[bdns] ⏱ Sincronización BDNS programada cada ${CHECK_HOURS} horas`);
  intervalId = setInterval(async () => {
    try {
      const r = await fetchFeed(url, false);
      console.log('[bdns] status', r.reason);
    } catch (e) {
      console.warn('[bdns] error check:', e.message);
    }
  }, intervalMs);
  intervalId.unref?.();
}

module.exports = {
  fetchFeed,
  getCachedData,
  getState,
  startPeriodicCheck,
  FEED_URL,
};
