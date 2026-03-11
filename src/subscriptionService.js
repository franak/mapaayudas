/**
 * subscriptionService.js
 * Suscripciones en data/subscriptions.json (JSON Lines).
 * Flujo: registro → pendiente → confirmación por email → confirmado=true
 * Solo suscriptores con confirmado=true reciben alertas.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// ─── Helpers ──────────────────────────────────────────────────────
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SUBS_FILE)) fs.writeFileSync(SUBS_FILE, '', 'utf8');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Read all ─────────────────────────────────────────────────────
function getAll() {
  ensureFile();
  return fs.readFileSync(SUBS_FILE, 'utf8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/** Only confirmed subscribers receive alerts */
function getConfirmedEmails() {
  return getAll()
    .filter(s => s.confirmado === true)
    .map(s => s.email)
    .filter(Boolean);
}

/**
 * Obtiene emails de suscriptores confirmados para una fuente específica.
 * @param {string} source - 'coam', 'plan-recuperacion', o undefined para todos
 * @returns {array} Array de emails
 */
function getConfirmedEmailsBySource(source) {
  return getAll()
    .filter(s => s.confirmado === true)
    .filter(s => {
      // Si no hay fuente especificada en la suscripción, aplica a todas
      if (!s.source || s.source === 'all') return true;
      // Si la suscripción es para una fuente específica, filtra
      return s.source === source;
    })
    .map(s => s.email)
    .filter(Boolean);
}

// ─── Rewrite all ──────────────────────────────────────────────────
function saveAll(records) {
  ensureFile();
  fs.writeFileSync(SUBS_FILE, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

// ─── Add ──────────────────────────────────────────────────────────
/**
 * Registers a new subscriber (unconfirmed).
 * Returns { ok, message, record } — record includes confirmToken.
 * If email already exists (any state) → rejects.
 */
function add(data) {
  ensureFile();

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return { ok: false, message: 'Email inválido.' };
  }

  const existing = getAll();
  const normalEmail = data.email.trim().toLowerCase();

  if (existing.some(s => s.email === normalEmail)) {
    const existingRecord = existing.find(s => s.email === normalEmail);
    return {
      ok: true,
      alreadyExists: true,
      message: existingRecord.confirmado
        ? 'Este correo ya está registrado y confirmado.'
        : 'Este correo ya está registrado (pendiente de confirmar).',
      record: existingRecord,
    };
  }

  const record = {
    id: Date.now(),
    nombre: (data.nombre || '').trim(),
    email: normalEmail,
    telefono: (data.telefono || '').trim(),
    observaciones: (data.observaciones || '').trim(),
    source: (data.source || 'all').toLowerCase(), // 'all', 'coam', 'plan-recuperacion'
    aceptaRGPD: true,
    confirmado: false,
    confirmToken: generateToken(),
    registradoEn: new Date().toISOString(),
    confirmadoEn: null,
  };

  fs.appendFileSync(SUBS_FILE, JSON.stringify(record) + '\n', 'utf8');
  return { ok: true, message: 'Registro recibido. Por favor confirme su email.', record };
}

// ─── Confirm ──────────────────────────────────────────────────────
/**
 * Validates a confirmation token and marks subscriber as confirmed.
 * @returns {{ ok: boolean, message: string, record?: object }}
 */
function confirm(token) {
  if (!token) return { ok: false, message: 'Token no proporcionado.' };

  const all = getAll();
  const idx = all.findIndex(s => s.confirmToken === token);

  if (idx === -1) return { ok: false, message: 'Enlace no válido o ya utilizado.' };

  const sub = all[idx];
  if (sub.confirmado) return { ok: true, message: 'Ya estaba confirmado.', record: sub };

  sub.confirmado = true;
  sub.confirmadoEn = new Date().toISOString();
  // Invalidate token after use
  sub.confirmToken = null;

  saveAll(all);
  return { ok: true, message: 'Suscripción confirmada.', record: sub };
}

module.exports = { getAll, getConfirmedEmails, getConfirmedEmailsBySource, add, confirm };
