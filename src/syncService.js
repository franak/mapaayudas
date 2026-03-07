/**
 * syncService.js
 *
 * Responsabilidades:
 *  1. Scraping: obtiene la URL vigente del Excel desde la página de la Oficina de Rehabilitación COAM.
 *  2. Persistencia: guarda el archivo descargado en disco y recuerda la última URL en un fichero JSON.
 *  3. Actualización inteligente: solo descarga si la URL ha cambiado respecto a la última conocida.
 *  4. Arranque automático: al iniciar el servidor comprueba y, si procede, descarga.
 *  5. Comprobación periódica: intervalo configurable vía CHECK_INTERVAL_HOURS en .env.
 */

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

// ─── Config ───────────────────────────────────────────────────────────────────

const SOURCE_PAGE  = process.env.SOURCE_PAGE_URL ||
  'https://oficinarehabilitacion.coam.org/oficina-rehabilitacion-ayudas-mapa-ayudas-vigente/';

const DATA_DIR     = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const STATE_FILE   = path.join(DATA_DIR, 'sync-state.json');
const LOCAL_FILE   = path.join(DATA_DIR, 'mapa-ayudas-vigente.xlsx');

const CHECK_HOURS  = parseFloat(process.env.CHECK_INTERVAL_HOURS || '6');
const MAX_BYTES    = (parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10)) * 1024 * 1024;

// ─── State ────────────────────────────────────────────────────────────────────

/** In-memory mirror of sync-state.json */
let state = {
  lastUrl:       null,   // URL from which the local file was downloaded
  lastCheckedAt: null,   // ISO timestamp of last scrape attempt
  lastSyncedAt:  null,   // ISO timestamp of last successful download
  localFile:     null,   // absolute path to local copy
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    }
  } catch {
    console.warn('[sync] No se pudo leer sync-state.json — empezando desde cero.');
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[sync] Error guardando estado:', e.message);
  }
}

// ─── Scraper ──────────────────────────────────────────────────────────────────

/**
 * Fetches the source page and extracts the href of the "DESCARGAR MAPA" link.
 * Uses a simple regex — no DOM parser dependency needed.
 */
async function scrapeExcelUrl() {
  const res = await axios.get(SOURCE_PAGE, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MapaAyudasBot/1.0)' },
  });

  const html = res.data;

  // Match <a ...>DESCARGAR MAPA</a> and capture its href
  const match = html.match(/<a\s+[^>]*href=["']([^"']+\.xlsx[^"']*)["'][^>]*>\s*DESCARGAR\s+MAPA\s*<\/a>/i)
    || html.match(/href=["']([^"']+\.xlsx[^"']*)["'][^>]*>\s*DESCARGAR\s+MAPA/i);

  if (!match) {
    throw new Error('No se encontró el enlace "DESCARGAR MAPA" en la página de la Oficina COAM.');
  }

  const href = match[1];
  // Resolve relative URLs just in case
  return href.startsWith('http') ? href : new URL(href, SOURCE_PAGE).href;
}

// ─── Downloader ───────────────────────────────────────────────────────────────

async function downloadExcel(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    maxContentLength: MAX_BYTES,
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MapaAyudasBot/1.0)' },
  });

  if (response.data.byteLength > MAX_BYTES) {
    throw new Error(`El archivo supera el tamaño máximo permitido (${process.env.MAX_FILE_SIZE_MB || 50} MB)`);
  }

  fs.writeFileSync(LOCAL_FILE, Buffer.from(response.data));
  console.log(`[sync] ✔ Archivo descargado → ${LOCAL_FILE} (${(response.data.byteLength / 1024).toFixed(1)} KB)`);
}

// ─── Main sync logic ──────────────────────────────────────────────────────────

/**
 * Core sync function.
 *  - Scrapes the source page to find the current Excel URL.
 *  - If the URL differs from the last known one (or there is no local copy), downloads it.
 *  - Updates state.json and in-memory state.
 *
 * @param {boolean} force  If true, download even if URL has not changed.
 * @returns {object} Result with fields: checked, urlFound, downloaded, reason
 */
async function sync(force = false) {
  ensureDataDir();
  loadState();

  const now = new Date().toISOString();
  state.lastCheckedAt = now;

  let urlFound, downloaded = false, reason;

  try {
    urlFound = await scrapeExcelUrl();
    console.log(`[sync] URL vigente: ${urlFound}`);
  } catch (e) {
    saveState();
    throw new Error(`Error al obtener la URL del mapa: ${e.message}`);
  }

  const localExists  = fs.existsSync(LOCAL_FILE);
  const urlChanged   = state.lastUrl !== urlFound;

  if (force || urlChanged || !localExists) {
    reason = force      ? 'forzado'
           : urlChanged ? `URL actualizada (antes: ${state.lastUrl || 'ninguna'})`
                        : 'no existía copia local';

    console.log(`[sync] Descargando archivo — motivo: ${reason}`);

    try {
      await downloadExcel(urlFound);
      state.lastUrl      = urlFound;
      state.lastSyncedAt = now;
      state.localFile    = LOCAL_FILE;
      downloaded         = true;
    } catch (e) {
      saveState();
      throw new Error(`Error al descargar el archivo: ${e.message}`);
    }
  } else {
    reason = 'URL sin cambios — usando copia local';
    console.log(`[sync] Sin cambios. Usando copia local: ${LOCAL_FILE}`);
  }

  saveState();

  // Send email alerts if the file was actually downloaded (URL changed or forced)
  if (downloaded && urlChanged) {
    try {
      const { sendUpdateAlert } = require('./emailService');
      const { getConfirmedEmails } = require('./subscriptionService');
      const emails = getConfirmedEmails();
      console.log(`[sync] Enviando alertas a ${emails.length} suscriptor(es)…`);
      await sendUpdateAlert(emails, { urlFound, reason });
    } catch (e) {
      console.error('[sync] Error enviando alertas por email:', e.message);
    }
  }

  return { checked: now, urlFound, downloaded, reason, localFile: LOCAL_FILE };
}

// ─── Periodic check ───────────────────────────────────────────────────────────

let _intervalHandle = null;

function startPeriodicCheck() {
  if (CHECK_HOURS <= 0) return;
  const ms = CHECK_HOURS * 60 * 60 * 1000;
  _intervalHandle = setInterval(async () => {
    console.log(`[sync] Comprobación periódica (cada ${CHECK_HOURS}h)…`);
    try { await sync(); } catch (e) { console.error('[sync] Error en comprobación periódica:', e.message); }
  }, ms);
  console.log(`[sync] Comprobación automática cada ${CHECK_HOURS}h`);
}

function stopPeriodicCheck() {
  if (_intervalHandle) clearInterval(_intervalHandle);
}

// ─── Accessors ────────────────────────────────────────────────────────────────

/** Returns the path to the local Excel copy, or null if it doesn't exist yet. */
function getLocalFilePath() {
  loadState();
  const p = state.localFile || LOCAL_FILE;
  return fs.existsSync(p) ? p : null;
}

/** Returns the current in-memory state (safe copy). */
function getState() {
  loadState();
  return { ...state, localFile: LOCAL_FILE, dataDir: DATA_DIR };
}

module.exports = { sync, getLocalFilePath, getState, startPeriodicCheck, stopPeriodicCheck };
