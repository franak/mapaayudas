const express = require('express');
const {
  readLocalWorkbook,
  parseWorkbook,
  applyFilters,
  getSheetNames,
} = require('./excelService');
const { cache, buildKey, CACHE_TTL } = require('./cache');
const { sync, getLocalFilePath, getState } = require('./syncService');
const { add: addSubscriber, confirm: confirmSubscriber } = require('./subscriptionService');
const { sendWelcomeEmail, sendNewSubscriberAlert, sendInfoRequestToAdmin, sendInfoRequestAck } = require('./emailService');

const router = express.Router();

const RESERVED_PARAMS = new Set(['sheet', 'nocache', 'url', 'file']);

function extractFilters(query) {
  const filters = {};
  for (const [key, value] of Object.entries(query)) {
    if (!RESERVED_PARAMS.has(key)) filters[key] = value;
  }
  return filters;
}

// ─────────────────────────────────────────────────────────────────
// GET /excel/status  →  estado de la sincronización
// ─────────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  const s = getState();
  const localExists = !!getLocalFilePath();
  res.json({
    sourcePage:    process.env.SOURCE_PAGE_URL || 'https://oficinarehabilitacion.coam.org/oficina-rehabilitacion-ayudas-mapa-ayudas-vigente/',
    lastUrl:       s.lastUrl,
    lastCheckedAt: s.lastCheckedAt,
    lastSyncedAt:  s.lastSyncedAt,
    localFile:     localExists ? s.localFile : null,
    localExists,
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /excel/sync  →  forzar comprobación/descarga inmediata
// ─────────────────────────────────────────────────────────────────
router.post('/sync', async (req, res, next) => {
  try {
    const force  = req.query.force === 'true';
    const result = await sync(force);
    // Invalidate parsed-data cache so next request re-parses the new file
    cache.flushAll();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /excel/sheets  →  lista de hojas
// ─────────────────────────────────────────────────────────────────
router.get('/sheets', async (req, res, next) => {
  try {
    const localPath = getLocalFilePath();
    if (!localPath) {
      return res.status(503).json({
        error: 'No hay copia local del archivo. Llama a POST /excel/sync primero.',
      });
    }

    const cacheKey = buildKey(localPath, '__sheets__');
    const cached   = cache.get(cacheKey);
    if (cached && req.query.nocache !== 'true') {
      return res.json({ fromCache: true, sheets: cached, ...statusMeta() });
    }

    const workbook = readLocalWorkbook(localPath);
    const sheets   = getSheetNames(workbook);
    cache.set(cacheKey, sheets);

    res.json({ fromCache: false, sheets, ...statusMeta() });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /excel  →  datos con filtros opcionales
//   ?sheet=GENERAL
//   ?nocache=true
//   ?<columna>=<valor>          filtro exacto
//   ?<columna>=~<parcial>       filtro por contenido
// ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const localPath = getLocalFilePath();
    if (!localPath) {
      return res.status(503).json({
        error: 'No hay copia local del archivo. Llama a POST /excel/sync primero.',
      });
    }

    const sheetParam   = req.query.sheet || null;
    const filters      = extractFilters(req.query);
    const bypassCache  = req.query.nocache === 'true';
    const cacheKey     = buildKey(localPath, sheetParam);
    const cached       = cache.get(cacheKey);

    let parsed;
    if (cached && !bypassCache) {
      parsed = cached;
    } else {
      const workbook = readLocalWorkbook(localPath);
      parsed = parseWorkbook(workbook, sheetParam);
      cache.set(cacheKey, parsed);
    }

    // Apply filters per sheet
    const filteredData = {};
    let totalRows = 0;
    for (const [name, rows] of Object.entries(parsed.data)) {
      filteredData[name] = applyFilters(rows, filters);
      totalRows += filteredData[name].length;
    }

    res.json({
      fromCache: !!cached && !bypassCache,
      sheets: parsed.sheets,
      filters: Object.keys(filters).length > 0 ? filters : null,
      totalRows,
      cacheTtlSeconds: CACHE_TTL,
      data: filteredData,
      ...statusMeta(),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /excel/cache  →  vaciar caché en memoria
// ─────────────────────────────────────────────────────────────────
router.delete('/cache', (_req, res) => {
  const keys = cache.keys();
  cache.flushAll();
  res.json({ message: 'Cache cleared', deletedKeys: keys.length });
});

// ─── Helper ───────────────────────────────────────────────────────
function statusMeta() {
  const s = getState();
  return {
    sourceUrl:     s.lastUrl,
    lastSyncedAt:  s.lastSyncedAt,
    lastCheckedAt: s.lastCheckedAt,
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /excel/subscribe  →  registrar suscripción + enviar bienvenida
// Body: { nombre?, email, telefono?, observaciones? }
// ─────────────────────────────────────────────────────────────────
router.post('/subscribe', async (req, res, next) => {
  try {
    const result = addSubscriber(req.body);
    if (!result.ok) return res.status(400).json({ error: result.message });

    const baseUrl    = process.env.URL_HOME || `${req.protocol}://${req.get('host')}`;
    const confirmUrl = `${baseUrl}/confirm?token=${result.record.confirmToken || ''}`;

    if (result.alreadyExists) {
      // Email already registered — just send a polite thank-you, don't re-register
      sendWelcomeEmail(result.record, confirmUrl).catch(e =>
        console.error('[email] Error enviando bienvenida (duplicado):', e.message)
      );
      return res.json({ ok: true, message: '¡Gracias! Ya tienes una suscripción activa. Te hemos enviado un email de confirmación.' });
    }

    // New subscriber — send welcome + admin alert
    sendWelcomeEmail(result.record, confirmUrl).catch(e =>
      console.error('[email] Error enviando bienvenida:', e.message)
    );
    sendNewSubscriberAlert(result.record).catch(e =>
      console.error('[email] Error notificando admin:', e.message)
    );

    res.json({ ok: true, message: result.message });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /excel/confirm?token=xxx  →  confirmar suscripción
// Redirige a /confirm?token= que sirve la página estática
// ─────────────────────────────────────────────────────────────────
router.get('/confirm', (req, res, next) => {
  try {
    const { token } = req.query;
    const result = confirmSubscriber(token);
    const status = result.ok ? 'ok' : 'error';
    // Redirect to the static confirmation page with result
    res.redirect(`/confirm.html?status=${status}`);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /excel/info-request  →  solicitud de información (con o sin convocatoria)
// Body: { empresa?, nombre?, telefono, email, observaciones?,
//         convocatoria?: { titulo?, fechaHasta?, ambito?, normativa? } }
// ─────────────────────────────────────────────────────────────────
router.post('/info-request', async (req, res, next) => {
  try {
    const { empresa, nombre, telefono, email, observaciones, convocatoria } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'El campo email es obligatorio y debe ser válido.' });
    }
    if (!telefono) {
      return res.status(400).json({ error: 'El campo teléfono es obligatorio.' });
    }

    const contact = { empresa, nombre, telefono, email, observaciones };
    const conv = convocatoria && convocatoria.titulo ? convocatoria : null;

    // Send admin alert (awaited — we want to catch SMTP errors)
    await sendInfoRequestToAdmin(contact, conv);

    // Send user ack (fire-and-forget — don't block the response)
    sendInfoRequestAck(contact, conv?.titulo || null).catch(e =>
      console.error('[email] Error enviando ack solicitud:', e.message)
    );

    res.json({ ok: true, message: 'Solicitud recibida correctamente.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
