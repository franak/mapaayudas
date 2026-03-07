const axios = require('axios');
const fs    = require('fs');
const XLSX  = require('xlsx');

const MAX_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10)) * 1024 * 1024;

// ─── URL construction ────────────────────────────────────────────────────────

/**
 * Builds the full Excel URL.
 *
 * Priority:
 *  1. ?url=<full url>         → used as-is
 *  2. ?file=<filename>        → joined with BASE_EXCEL_URL from .env
 *  3. DEFAULT_EXCEL_URL       → fallback
 *
 * Example .env:
 *   BASE_EXCEL_URL=https://example.com/archivos/
 *   DEFAULT_EXCEL_URL=https://example.com/archivos/datos.xlsx
 *
 * Example request:
 *   GET /excel?file=Nuevo-Mapa-de-Ayudas_2026.xlsx
 *   → https://example.com/archivos/Nuevo-Mapa-de-Ayudas_2026.xlsx
 */
function resolveExcelUrl({ explicitUrl, filePath }) {
  if (explicitUrl) {
    try { new URL(explicitUrl); } catch {
      const err = new Error(`Invalid URL: ${explicitUrl}`);
      err.statusCode = 400;
      throw err;
    }
    return explicitUrl;
  }

  const base = process.env.BASE_EXCEL_URL;
  if (base && filePath) {
    const separator = base.endsWith('/') ? '' : '/';
    const full = `${base}${separator}${filePath}`;
    try { new URL(full); } catch {
      const err = new Error(`Invalid composed URL: ${full}`);
      err.statusCode = 400;
      throw err;
    }
    return full;
  }

  const defaultUrl = process.env.DEFAULT_EXCEL_URL;
  if (defaultUrl) return defaultUrl;

  const err = new Error(
    'No Excel URL resolved. Options:\n' +
    '  ?url=https://...          full URL override\n' +
    '  ?file=archivo.xlsx        combined with BASE_EXCEL_URL in .env\n' +
    '  Set DEFAULT_EXCEL_URL in .env for a fixed default'
  );
  err.statusCode = 400;
  throw err;
}

// ─── Network ─────────────────────────────────────────────────────────────────

async function fetchWorkbook(url) {
  let response;
  try {
    response = await axios.get(url, {
      responseType: 'arraybuffer',
      maxContentLength: MAX_BYTES,
      timeout: 15000,
    });
  } catch (axiosErr) {
    const status = axiosErr.response?.status;
    const msg = status
      ? `Failed to fetch Excel (HTTP ${status}): ${url}`
      : `Network error fetching Excel: ${axiosErr.message}`;
    const err = new Error(msg);
    err.statusCode = status || 502;
    throw err;
  }

  if (response.data.byteLength > MAX_BYTES) {
    const err = new Error(`File exceeds maximum allowed size of ${process.env.MAX_FILE_SIZE_MB || 50} MB`);
    err.statusCode = 413;
    throw err;
  }

  return XLSX.read(response.data, { type: 'buffer', cellDates: true });
}

/**
 * Reads a workbook from a local file path on disk.
 */
function readLocalWorkbook(filePath) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Archivo local no encontrado: ${filePath}`);
    err.statusCode = 404;
    throw err;
  }
  return XLSX.readFile(filePath, { cellDates: true });
}

// ─── HTML/entity cleaning ─────────────────────────────────────────────────────

/**
 * Strips HTML tags and decodes common HTML entities from a string.
 * Also normalises whitespace and removes zero-width characters.
 */
function stripHtml(str) {
  if (!str) return str;
  return str
    // Remove Excel's carriage return placeholder
    .replace(/_x000D_/g, '\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/gi,  '&')
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi,  "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Normalise whitespace while preserving single newlines
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // zero-width chars
    .replace(/[ \t]+/g, ' ')               // preserve \n but collapse spaces
    .replace(/\n\s*\n/g, '\n')             // collapse multiple newlines
    .trim();
}

// ─── Header parsing ───────────────────────────────────────────────────────────

/**
 * Builds column header labels for sheets with 2 merged header rows.
 *
 * Row A (group):  ORIGEN | PLAZOS | ACTUACIONES SUBVENCIONABLES | ...
 * Row B (detail): ORGANISMO | FONDO | DESDE | HASTA | Accesibilidad | ...
 *
 * Result: "ORIGEN > ORGANISMO", "ORIGEN > FONDO", "PLAZOS > DESDE", ...
 * Single-label columns (no merge) keep their value unchanged.
 */
function buildMergedHeaders(ws, topRowNum, subRowNum) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const totalCols = range.e.c + 1;

  const readRow = (rowNum) => {
    const arr = [];
    for (let c = 0; c < totalCols; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: rowNum - 1, c })];
      arr.push(cell ? stripHtml(String(cell.v).trim()) : null);
    }
    return arr;
  };

  const topRow = readRow(topRowNum);
  const subRow = readRow(subRowNum);

  // Propagate merged cell values rightward
  let lastTop = null;
  return topRow.map((top, c) => {
    if (top) lastTop = top;
    const sub = subRow[c];
    if (lastTop && sub && lastTop !== sub) return `${lastTop} > ${sub}`;
    return lastTop || sub || `COL_${c + 1}`;
  });
}

function parseSheetSimple(ws) {
  return XLSX.utils.sheet_to_json(ws, {
    defval: null,
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
}

function parseSheetMergedHeaders(ws, topRowNum, subRowNum, dataStartRow) {
  const headers = buildMergedHeaders(ws, topRowNum, subRowNum);
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];

  for (let r = dataStartRow - 1; r <= range.e.r; r++) {
    const row = {};
    let hasValue = false;
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const key = headers[c];
      if (!key) continue;
      let value = null;
      if (cell) {
        value = cell.t === 'd'
          ? cell.v.toISOString().split('T')[0]
          : stripHtml(String(cell.v).trim()) || null;
      }
      row[key] = value;
      if (value !== null) hasValue = true;
    }
    if (hasValue) rows.push(row);
  }

  return rows;
}

// ─── Per-sheet config ─────────────────────────────────────────────────────────
//
//  GENERAL:         rows 2+3 are headers, data starts at row 4
//  Parametrizables: rows 1+2 are headers, data starts at row 3
//  Hoja1:           standard single-header sheet
//
const SHEET_CONFIG = {
  GENERAL:        { type: 'merged', topRow: 2, subRow: 3, dataStart: 4 },
  Parametrizables:{ type: 'merged', topRow: 1, subRow: 2, dataStart: 3 },
  Hoja1:          { type: 'simple' },
};

function parseSheet(ws, sheetName) {
  const cfg = SHEET_CONFIG[sheetName] || { type: 'simple' };
  return cfg.type === 'merged'
    ? parseSheetMergedHeaders(ws, cfg.topRow, cfg.subRow, cfg.dataStart)
    : parseSheetSimple(ws);
}

// ─── Workbook ─────────────────────────────────────────────────────────────────

function getSheetNames(workbook) {
  return workbook.SheetNames;
}

function parseWorkbook(workbook, sheetName = null) {
  const allSheets = workbook.SheetNames;

  if (sheetName) {
    if (!allSheets.includes(sheetName)) {
      const err = new Error(`Sheet "${sheetName}" not found. Available: ${allSheets.join(', ')}`);
      err.statusCode = 404;
      throw err;
    }
    return {
      sheets: [sheetName],
      data: { [sheetName]: parseSheet(workbook.Sheets[sheetName], sheetName) },
    };
  }

  const data = {};
  for (const name of allSheets) {
    data[name] = parseSheet(workbook.Sheets[name], name);
  }
  return { sheets: allSheets, data };
}

// ─── Filtering ────────────────────────────────────────────────────────────────

/**
 * Filters rows by column/value pairs.
 *
 * Key matching is case-insensitive (handles accents and spaces in header names).
 * Value matching modes:
 *   - Exact (default):   ?ORGANISMO=1.+HACIENDA     (+ is decoded as space)
 *   - Contains (~ prefix): ?titulo=~deducciones     → includes "deducciones"
 */
function applyFilters(rows, filters) {
  if (!filters || Object.keys(filters).length === 0) return rows;

  return rows.filter((row) =>
    Object.entries(filters).every(([col, val]) => {
      const rowKey = Object.keys(row).find(
        (k) => k.toLowerCase() === col.toLowerCase()
      );
      if (!rowKey) return false;

      const cellValue = row[rowKey];
      if (cellValue === null || cellValue === undefined) return false;

      const cell = String(cellValue).toLowerCase();
      const filter = String(val).toLowerCase();

      return filter.startsWith('~')
        ? cell.includes(filter.slice(1))
        : cell === filter;
    })
  );
}

module.exports = {
  resolveExcelUrl,
  fetchWorkbook,
  readLocalWorkbook,
  parseWorkbook,
  applyFilters,
  getSheetNames,
};
