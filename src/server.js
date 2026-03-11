require('dotenv').config();
const path = require('path');
const express = require('express');
const excelRoutes = require('./routes');
const { sync, startPeriodicCheck } = require('./syncService');
const { sync: syncPlanRec, startPeriodicCheck: startPlanRecCheck } = require('./scrapePlanRecuperacionService');
const bdnsService = require('./bdnsService');
const { confirm: confirmSubscriber } = require('./subscriptionService');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Static frontend ──────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ── API routes ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/excel', excelRoutes);

// ── Email confirmation ────────────────────────────────────────────────────────
app.get('/confirm', (req, res) => {
  const result = confirmSubscriber(req.query.token);
  const status = result.ok ? 'ok' : 'error';
  res.redirect(`/confirm.html?status=${status}`);
});


// ── Fallback → frontend ──────────────────────────────────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/excel') || req.path === '/health' || req.path === '/confirm') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Environment validation ──────────────────────────────────────────────────
function validateEnv() {
  const required = ['ADMIN_EMAIL', 'URL_HOME'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`\n  [CONFIG] ⚠ Faltan variables de entorno: ${missing.join(', ')}`);
    console.warn('  Esto puede causar errores en el envío de correos o enlaces de confirmación.\n');
  }
}
validateEnv();

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const status = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[ERROR] ${req.method} ${req.url} - ${err.message}`);
  if (!isProd && err.stack) console.error(err.stack);

  res.status(status).json({
    ok: false,
    error: err.message || 'Error interno del servidor',
    code: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n  Mapa de Ayudas — servidor arrancado`);
  console.log(`  Frontend:  http://localhost:${PORT}`);
  console.log(`  API:       http://localhost:${PORT}/excel\n`);

  // ── Sync COAM Excel on startup ────────────────────────────────────────────
  try {
    const result = await sync();
    if (result.downloaded) {
      console.log(`  [coam] ✔ Archivo actualizado (${result.reason})`);
    } else {
      console.log(`  [coam] ✔ Usando copia local (${result.reason})`);
    }
    console.log(`  [coam] URL vigente: ${result.urlFound}`);
  } catch (e) {
    console.warn(`  [coam] ⚠ No se pudo sincronizar al arrancar: ${e.message}`);
    console.warn(`  [coam]   El servidor continúa. Llama a POST /excel/sync?source=coam para reintentar.`);
  }

  // ── Sync Plan Recuperación on startup ─────────────────────────────────────
  try {
    const result = await syncPlanRec();
    console.log(`  [plan-rec] ✔ Scraping completado (${result.reason}): ${result.itemCount} convocatorias\n`);
  } catch (e) {
    console.warn(`  [plan-rec] ⚠ No se pudo sincronizar al arrancar: ${e.message}`);
    console.warn(`  [plan-rec]   El servidor continúa. Llama a POST /excel/sync?source=plan-recuperacion para reintentar.\n`);
  }

  // Schedule periodic checks for both sources
  startPeriodicCheck();
  startPlanRecCheck();
  // BDNS / PRTR (ATOM) periodic check
  try {
    if (bdnsService.FEED_URL) {
      console.log(`  [bdns] Iniciando sincronización BDNS (PRTR(ATOM)) -> ${bdnsService.FEED_URL}`);
      // Intentar primer fetch al arrancar
      try {
        const r = await bdnsService.fetchFeed();
        console.log(`  [bdns] ✔ Inicial: ${r.itemCount} items (${r.reason || 'ok'})`);
      } catch (e) {
        console.warn(`  [bdns] ⚠ Error inicial: ${e.message}`);
      }
      bdnsService.startPeriodicCheck();
    } else {
      console.log('  [bdns] BDNS_FEED_URL no configurado — salto sincronización BDNS');
    }
  } catch (e) {
    console.warn('[bdns] Error al arrancar servicio BDNS:', e.message);
  }
});
