const express = require('express');
const {
  readLocalWorkbook,
  parseWorkbook,
  applyFilters,
  getSheetNames,
} = require('./excelService');
const { cache, buildKey, CACHE_TTL } = require('./cache');
const { sync, getLocalFilePath, getState } = require('./syncService');
const { sync: syncPlanRec, getCachedData: getPlanRecData, getState: getPlanRecState } = require('./scrapePlanRecuperacionService');
const { fetchFeed: fetchBdns, getCachedData: getBdnsData, getState: getBdnsState } = require('./bdnsService');
const { add: addSubscriber, confirm: confirmSubscriber } = require('./subscriptionService');
const { sendWelcomeEmail, sendNewSubscriberAlert, sendInfoRequestToAdmin, sendInfoRequestAck } = require('./emailService');

const router = express.Router();

const RESERVED_PARAMS = new Set(['sheet', 'nocache', 'url', 'file', 'source']);

function extractFilters(query) {
  const filters = {};
  for (const [key, value] of Object.entries(query)) {
    if (!RESERVED_PARAMS.has(key)) filters[key] = value;
  }
  return filters;
}

// ─────────────────────────────────────────────────────────────────
// GET /excel/status  →  estado de ambas sincronizaciones
// ─────────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  const stateCoam = getState();
  const statePlanRec = getPlanRecState();
  const localExists = !!getLocalFilePath();

  res.json({
    sources: {
      coam: {
        sourcePage: process.env.SOURCE_PAGE_URL || 'https://oficinarehabilitacion.coam.org/oficina-rehabilitacion-ayudas-mapa-ayudas-vigente/',
        lastUrl: stateCoam.lastUrl,
        lastCheckedAt: stateCoam.lastCheckedAt,
        lastSyncedAt: stateCoam.lastSyncedAt,
        localFile: localExists ? stateCoam.localFile : null,
        localExists,
      },
      planRecuperacion: {
        sourcePage: 'https://planderecuperacion.gob.es/como-acceder-a-los-fondos/convocatorias?...',
        lastCheckedAt: statePlanRec.lastCheckedAt,
        lastSyncedAt: statePlanRec.lastSyncedAt,
        itemCount: statePlanRec.itemCount,
        lastContentHash: statePlanRec.lastContentHash,
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /excel/sync  →  forzar comprobación/descarga inmediata
//   ?source=coam|plan-recuperacion|both
// ─────────────────────────────────────────────────────────────────
router.post('/sync', async (req, res, next) => {
  try {
    const force = req.query.force === 'true';
    const source = (req.query.source || 'both').toLowerCase();
    const results = {};

    // Sync COAM Excel
    if (source === 'coam' || source === 'both') {
      try {
        results.coam = await sync(force);
      } catch (e) {
        results.coam = { error: e.message };
      }
    }

    // Sync Plan Recuperación
    if (source === 'plan-recuperacion' || source === 'both') {
      try {
        results.planRecuperacion = await syncPlanRec(force);
      } catch (e) {
        results.planRecuperacion = { error: e.message };
      }
    }

    // Invalidate parsed-data cache so next request re-parses the new file
    cache.flushAll();
    res.json({ ok: true, ...results });
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
    const cached = cache.get(cacheKey);
    if (cached && req.query.nocache !== 'true') {
      return res.json({ fromCache: true, sheets: cached, ...statusMeta() });
    }

    const workbook = readLocalWorkbook(localPath);
    const sheets = getSheetNames(workbook);
    cache.set(cacheKey, sheets);

    res.json({ fromCache: false, sheets, ...statusMeta() });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /excel  →  datos de COAM Excel + Plan Recuperación
//   ?sheet=GENERAL          (compatible legacy - solo COAM)
//   ?source=coam|plan-recuperacion|both  (nuevo formato - combinedData)
//   ?nocache=true
//   ?<columna>=<valor>      filtro exacto
//   ?<columna>=~<parcial>   filtro por contenido
// ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const sheetParam = req.query.sheet || null;  // Para compatibilidad legacy
    const source = (req.query.source || 'both').toLowerCase();
    const bypassCache = req.query.nocache === 'true';

    // ── Modo Legacy (cuando se solicita con ?sheet=) ──────────────────
    // Devuelve estructura antigua compatible con el frontend existente
    if (sheetParam) {
      const localPath = getLocalFilePath();
      if (!localPath) {
        return res.status(503).json({
          error: 'No hay copia local del archivo. Llama a POST /excel/sync primero.',
        });
      }

      const filters = extractFilters(req.query);
      const cacheKey = buildKey(localPath, sheetParam);
      const cached = cache.get(cacheKey);

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
        filteredData[name] = applyFilters(rows, filters).map(row => ({ ...row, _source: 'coam', _sheet: name }));
        totalRows += filteredData[name].length;
      }

      return res.json({
        fromCache: !!cached && !bypassCache,
        sheets: parsed.sheets,
        filters: Object.keys(filters).length > 0 ? filters : null,
        totalRows,
        cacheTtlSeconds: CACHE_TTL,
        data: filteredData,
        ...statusMeta(),
      });
    }

    // ── Modo Nuevo (cuando se solicita sin sheet o con ?source=) ──────
    // Devuelve estructura combinada con ambas fuentes
    const result = {
      combinedData: [],
      sources: {},
      totalRows: 0,
      cacheTtlSeconds: CACHE_TTL,
    };

    // Get COAM data (Excel)
    if (source === 'coam' || source === 'both') {
      const localPath = getLocalFilePath();
      if (localPath) {
        try {
          const filters = extractFilters(req.query);
          const cacheKey = buildKey(localPath, null);
          const cached = cache.get(cacheKey);

          let parsed;
          if (cached && !bypassCache) {
            parsed = cached;
          } else {
            const workbook = readLocalWorkbook(localPath);
            parsed = parseWorkbook(workbook, null);
            cache.set(cacheKey, parsed);
          }

          const filteredData = {};
          let coamRows = 0;
          for (const [name, rows] of Object.entries(parsed.data)) {
            filteredData[name] = applyFilters(rows, filters);
            coamRows += filteredData[name].length;
            result.combinedData.push(
              ...filteredData[name].map(row => ({ ...row, _source: 'coam', _sheet: name }))
            );
          }

          result.sources.coam = {
            available: true,
            sheets: parsed.sheets,
            rows: coamRows,
          };
          result.totalRows += coamRows;
        } catch (e) {
          result.sources.coam = { available: false, error: e.message };
        }
      } else {
        result.sources.coam = { available: false, error: 'No hay copia local. Llama a POST /excel/sync?source=coam' };
      }
    }

    // Get Plan Recuperación data (Web scrape)
    if (source === 'plan-recuperacion' || source === 'both') {
      try {
        const planRecData = getPlanRecData();
        if (planRecData.length > 0) {
          // Normalizar campos para que coincidan con los nombres de columna del frontend
          const normalizeDate = (d) => {
            if (!d) return '';
            // dd/mm/yyyy -> yyyy-mm-dd
            const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (m) {
              const dd = m[1].padStart(2, '0');
              const mm = m[2].padStart(2, '0');
              const yyyy = m[3];
              return `${yyyy}-${mm}-${dd}`;
            }
            // already ISO-ish
            if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
            return d;
          };

          const mapped = planRecData.map(p => ({
            'TÍTULO DE LA CONVOCATORIA': p.titulo || '',
            'ORIGEN > ORGANISMO': p.organo || '',
            'ORIGEN > FONDO': '',
            'DELIMITACIÓN GEOGRÁFICA': p.localizacion || '',
            'TIPOLOGÍA DE LA EDIFICACIÓN': p.tipo || '',
            'NORMATIVA MARCO': '',
            'FECHA DE PUBLICACIÓN': p.scrapedAt ? (p.scrapedAt.substring(0, 10)) : '',
            'PLAZOS > DESDE': '',
            'PLAZOS > HASTA': normalizeDate(p.hasta || ''),
            'GESTOR DE LAS AYUDAS': p.organo || '',
            'ESTADO DE LA CONVOCATORIA': p.estado || '',
            'OBJETO / LÍNEA DE ACTUACIÓN': p.tipo || '',
            'DESTINATARIO ÚLTIMO': '',
            'ACCESO A LA CONVOCATORIA': p.enlace || '',
            // preserve original metadata
            id: p.id,
            fuente: p.fuente || 'plan-recuperacion',
            scrapedAt: p.scrapedAt,
            _source: 'plan-recuperacion',
            _sheet: 'plan-recuperacion'
          }));

          result.combinedData.push(...mapped);
          result.sources.planRecuperacion = {
            available: true,
            rows: planRecData.length,
          };
          result.totalRows += planRecData.length;
        } else {
          result.sources.planRecuperacion = { available: false, error: 'Sin datos cacheados. Llama a POST /excel/sync?source=plan-recuperacion' };
        }
      } catch (e) {
        result.sources.planRecuperacion = { available: false, error: e.message };
      }
    }

    // Add global status metadata (última descarga/comprobación, URL fuente)
    Object.assign(result, statusMeta());
    res.json(result);
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

// ─────────────────────────────────────────────────────────────────
// GET /excel/bdns  →  devolver items cacheados del feed BDNS (PRTR(ATOM))
// ─────────────────────────────────────────────────────────────────
router.get('/bdns', (_req, res, next) => {
  try {
    const data = getBdnsData();
    if (!data || data.length === 0) {
      return res.status(204).json({ message: 'No BDNS data cached. Call POST /excel/bdns/sync to fetch.' });
    }
    res.json({ available: true, rows: data.length, items: data });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /excel/bdns/sync  →  forzar fetch del feed BDNS
// Query: ?force=true
// ─────────────────────────────────────────────────────────────────
router.post('/bdns/sync', async (req, res, next) => {
  try {
    const force = req.query.force === 'true';
    const result = await fetchBdns(undefined, force);
    // Invalidate in-memory cache if needed
    cache.flushAll();
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

// ─── Helper ───────────────────────────────────────────────────────
function statusMeta() {
  const sCoam = getState();
  const sPr = (typeof getPlanRecState === 'function') ? getPlanRecState() : {};
  const sBdns = (typeof getBdnsState === 'function') ? getBdnsState() : {};
  // Choose the most recent non-null timestamps between sources
  const pickLatest = (a, b) => {
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  };
  // include BDNS state when choosing latest timestamps
  const tmpSynced = pickLatest(sCoam.lastSyncedAt, sPr.lastSyncedAt);
  const lastSyncedAt = pickLatest(tmpSynced, sBdns.lastSyncedAt);
  const tmpChecked = pickLatest(sCoam.lastCheckedAt, sPr.lastCheckedAt);
  const lastCheckedAt = pickLatest(tmpChecked, sBdns.lastCheckedAt);
  const sourceUrl = sCoam.lastUrl || sPr.sourcePage || sPr.urlSource || (sBdns && sBdns.feedUrl) || null;
  return { sourceUrl, lastSyncedAt, lastCheckedAt };
}

// ─────────────────────────────────────────────────────────────────
// POST /excel/subscribe  →  registrar suscripción + enviar bienvenida
// Body: { nombre?, email, telefono?, observaciones?, source? }
//   source: 'coam', 'plan-recuperacion', o 'all' (default)
// ─────────────────────────────────────────────────────────────────
router.post('/subscribe', async (req, res, next) => {
  try {
    const result = addSubscriber(req.body);
    if (!result.ok) return res.status(400).json({ error: result.message });

    const baseUrl = process.env.URL_HOME || `${req.protocol}://${req.get('host')}`;
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
