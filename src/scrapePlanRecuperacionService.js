/**
 * scrapePlanRecuperacionService.js
 *
 * Extrae datos de subvenciones de Rehabilitación Energética desde
 * planderecuperacion.gob.es usando web scraping con cheerio.
 *
 * Responsabilidades:
 *  1. Scraping: obtiene HTML y parsea convocatorias
 *  2. Normalización: convierte datos HTML a formato tabular
 *  3. Persistencia: almacena resultados en cache JSON
 *  4. Changelog: mantiene hash para detectar cambios
 *  5. Sincronización: actualiza cuando hay nuevos datos
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// ─── Config ───────────────────────────────────────────────────────────

const PLAN_REC_URL = process.env.PLAN_RECUPERACION_URL ||
    'https://planderecuperacion.gob.es/como-acceder-a-los-fondos/convocatorias' +
    '?combine=Rehabilitaci%C3%B3n+Energ%C3%A9tica' +
    '&field_tipo_convocatoria_value%5BAyuda%2Fsubvencion%5D=Ayuda%2Fsubvencion' +
    '&field_estado_value%5B%5D=Proximamente' +
    '&field_estado_value%5B%5D=Abierta';

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const CACHE_FILE = path.join(DATA_DIR, 'plan-recuperacion-cache.json');
const STATE_FILE = path.join(DATA_DIR, 'plan-recuperacion-state.json');

const CHECK_HOURS = parseFloat(process.env.CHECK_INTERVAL_HOURS || '6');
const MAX_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10)) * 1024 * 1024;

// ─── State ────────────────────────────────────────────────────────────

let state = {
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastContentHash: null,
    itemCount: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────

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
        console.warn('[plan-rec] No se pudo leer plan-recuperacion-state.json — empezando desde cero.');
    }
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error('[plan-rec] Error guardando estado:', e.message);
    }
}

function hashContent(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// ─── Scraper & Parser ─────────────────────────────────────────────────

/**
 * Obtiene HTML de la página de Plan Recuperación y parsea convocatorias.
 * @returns {array} Array de objetos con: {id, tipo, titulo, enlace, organo, localizacion, estado, deadline}
 */
async function scrapeConvocatorias() {
    const response = await axios.get(PLAN_REC_URL, {
        timeout: 20000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MapaAyudasBot/2.0; +https://isamart.es)',
            'Accept-Language': 'es-ES,es;q=0.9',
        },
    });

    if (response.data.byteLength > MAX_BYTES) {
        throw new Error(`Respuesta HTML supera tamaño máximo (${process.env.MAX_FILE_SIZE_MB || 50} MB)`);
    }

    const $ = cheerio.load(response.data);
    const convocatorias = [];

    // Cada resultado está en div.c-convocatoriasResult
    $('.c-convocatoriasResult').each((_i, elem) => {
        try {
            const $elem = $(elem);

            // Tipo: Ayuda/subvención o similar
            const tipo = $elem.find('.c-convocatoriasResult__type').text().trim();

            // Título y enlace
            const $titleLink = $elem.find('.c-convocatoriasResult__title').parent('a');
            const titulo = $titleLink.find('.c-convocatoriasResult__title').text().trim();
            const enlaceRelativo = $titleLink.attr('href') || '';
            const enlace = enlaceRelativo.startsWith('http')
                ? enlaceRelativo
                : new URL(enlaceRelativo, 'https://planderecuperacion.gob.es').href;

            // Órgano convocante
            const organo = $elem
                .find('.c-convocatoriasResult__text--convocante')
                .text()
                .trim();

            // Localización
            const localizacion = $elem
                .find('.c-convocatoriasResult__text--ejecucion')
                .text()
                .trim();

            // Estado y deadline
            const $stateDiv = $elem.find('.o-funding__state');
            const estadoText = $stateDiv.text().trim();

            // Formato: "Estado > Abierta hasta el 29/06/2026" o "Próximamente"
            let estado = 'Desconocido';
            let deadline = null;

            if (estadoText.includes('Abierta')) {
                estado = 'Abierta';
                // Extraer fecha: buscar patrón dd/mm/yyyy
                const fechaMatch = estadoText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
                if (fechaMatch) {
                    deadline = fechaMatch[1];
                }
            } else if (estadoText.includes('Próximamente')) {
                estado = 'Próximamente';
            } else if (estadoText.includes('Cerrada')) {
                estado = 'Cerrada';
            }
            let hasta = deadline

            // ID único basado en hash del enlace + titulo
            const id = crypto
                .createHash('md5')
                .update(enlace + titulo)
                .digest('hex')
                .substring(0, 12);

            if (titulo && enlace) {
                convocatorias.push({
                    id,
                    fuente: 'plan-recuperacion',
                    tipo,
                    titulo,
                    enlace,
                    organo,
                    localizacion,
                    estado,
                    hasta,
                    scrapedAt: new Date().toISOString(),
                });
            }
        } catch (e) {
            console.warn('[plan-rec] Error parseando elemento:', e.message);
        }
    });

    return convocatorias;
}

// ─── Main sync logic ──────────────────────────────────────────────────

/**
 * Sincroniza las convocatorias: descarga, parsea y detecta cambios.
 *
 * @param {boolean} force  Si true, sincroniza aunque no haya cambios.
 * @returns {object} {checked, itemCount, changed, reason}
 */
async function sync(force = false) {
    ensureDataDir();
    loadState();

    const now = new Date().toISOString();
    state.lastCheckedAt = now;

    let convocatorias = [];
    let newHash;
    let changed = false;
    let reason = '?';

    try {
        if (process.env.PLAN_RECUPERACION_ENABLED === 'false') {
            reason = 'Sincronización deshabilitada por configuración';
            console.log(`[plan-rec] ⚠ ${reason}`);
            saveState();
            return {
                checked: true,
                itemCount: 0,
                changed: false,
                reason,
                urlSource: PLAN_REC_URL.substring(0, 50) + '...',
            };
        }
        convocatorias = await scrapeConvocatorias();
        console.log(`[plan-rec] ✔ Scraping completado: ${convocatorias.length} convocatorias encontradas`);

        newHash = hashContent(convocatorias);

        if (!state.lastContentHash) {
            reason = 'Primera sincronización';
            changed = true;
        } else if (state.lastContentHash !== newHash) {
            reason = 'Contenido cambió';
            changed = true;
        } else if (force) {
            reason = 'Sincronización forzada';
            changed = true; // Permitir fuerza incluso sin cambios
        } else {
            reason = 'Sin cambios detectados';
            changed = false;
        }

        if (changed || force) {
            // Guardar cache
            fs.writeFileSync(CACHE_FILE, JSON.stringify(convocatorias, null, 2), 'utf8');
            state.lastSyncedAt = now;
            state.lastContentHash = newHash;
            state.itemCount = convocatorias.length;
            saveState();
            console.log(`[plan-rec] ✔ Cache actualizado: ${CACHE_FILE}`);
        }
    } catch (e) {
        saveState();
        throw new Error(`Error sincronizando Plan Recuperación: ${e.message}`);
    }

    return {
        checked: true,
        itemCount: convocatorias.length,
        changed,
        reason,
        urlSource: PLAN_REC_URL.substring(0, 50) + '...',
    };
}

/**
 * Lee los datos cacheados en memoria.
 * @returns {array} Array de convocatorias
 */
function getCachedData() {
    try {
        // If the service is disabled, always return empty array so frontend doesn't show it
        if (process.env.PLAN_RECUPERACION_ENABLED === 'false') {
            return [];
        }
        if (fs.existsSync(CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    } catch (e) {
        console.warn('[plan-rec] Error leyendo cache:', e.message);
    }
    return [];
}

/**
 * Obtiene el estado actual.
 */
function getState() {
    return { ...state };
}

/**
 * Retorna path del archivo de caché.
 */
function getCacheFilePath() {
    return fs.existsSync(CACHE_FILE) ? CACHE_FILE : null;
}

// ─── Periodic check ───────────────────────────────────────────────────

let checkIntervalId = null;

function startPeriodicCheck() {
    const intervalMs = CHECK_HOURS * 60 * 60 * 1000;
    console.log(`[plan-rec] ⏱ Sincronización programada cada ${CHECK_HOURS} horas`);

    checkIntervalId = setInterval(async () => {
        try {
            const result = await sync();
            const status = result.changed ? '🔄 actualizado' : '✓ sin cambios';
            console.log(`[plan-rec] ${status} (${result.reason})`);
        } catch (e) {
            console.warn(`[plan-rec] ⚠ Error en verificación periódica: ${e.message}`);
        }
    }, intervalMs);

    // Permanecer activo pero no bloquear salida
    checkIntervalId.unref?.();
}

// ─── Exports ───────────────────────────────────────────────────┐

module.exports = {
    sync,
    getCachedData,
    getState,
    getCacheFilePath,
    startPeriodicCheck,
    // Enable/disable helpers for runtime toggling
    async enableSync() {
        return await sync(true);
    },
    disableSync() {
        try {
            // Remove cache file so the frontend won't show stale data
            if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
            state = {
                lastCheckedAt: null,
                lastSyncedAt: null,
                lastContentHash: null,
                itemCount: 0,
            };
            saveState();
            return { ok: true, deleted: true };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },
    PLAN_REC_URL,
};
