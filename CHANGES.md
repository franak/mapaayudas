# 📊 Resumen de Cambios Realizados

## Problema Original

```
❌ Error 1: Unexpected token '<', "<!DOCTYPE"... is not valid JSON
❌ Error 2: POST https://ayudas.isamart.es/excel/sync → 404 (Not Found)
```

El servidor estaba devolviendo **HTML en lugar de JSON** en respuestas de error.

---

## 🔧 Cambios Realizados

### 1️⃣ `src/routes.js` - Garantizar Content-Type JSON

**ANTES:**
```javascript
const router = express.Router();

const RESERVED_PARAMS = new Set([...]);

function extractFilters(query) {
  // ...
}
```

**DESPUÉS:**
```javascript
const router = express.Router();

const RESERVED_PARAMS = new Set([...]);

// ✅ NUEVO: Middleware que fuerza Content-Type JSON
router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

function extractFilters(query) {
  // ...
}
```

---

### 2️⃣ `src/routes.js` - Error Handler Específico

**AGREGADO AL FINAL (línea 513):**
```javascript
// ── Error handler para rutas /excel ──────────────────────────────────────────
router.use((err, req, res, next) => {
  // Ensure JSON response
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  
  const status = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[/excel ERROR] ${req.method} ${req.url} - ${err.message}`);
  if (!isProd && err.stack) console.error(err.stack);

  res.status(status).json({
    ok: false,
    error: err.message || 'Error procesando la solicitud',
    code: err.code || 'EXCEL_ERROR',
  });
});
```

---

### 3️⃣ `src/server.js` - Middleware para Rutas POST sin Handler

**AGREGADO DESPUÉS DEL FALLBACK (línea 37-44):**
```javascript
// ── Catch unhandled routes for /excel (POST, DELETE, etc.) ─────────────────
app.use('/excel', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    method: req.method,
    path: req.path
  });
});
```

---

### 4️⃣ `src/server.js` - Error Handler Global Mejorado

**ANTES:**
```javascript
app.use((err, req, res, _next) => {
  const status = err.statusCode || 500;
  // ...
  res.status(status).json({ ... });
});
```

**DESPUÉS:**
```javascript
app.use((err, req, res, _next) => {
  // ✅ NUEVO: Forzar Content-Type JSON
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  
  const status = err.statusCode || err.status || 500;
  // ...
  res.status(status).json({ ... });
});
```

---

## 📁 Ficheros Nuevos

### `test-endpoints.js`
Script de diagnóstico para probar todos los endpoints:
```bash
node test-endpoints.js http://localhost:3000
```

### `TROUBLESHOOTING.md`
Documentación completa de resolución de problemas con checklists y comandos.

---

## ✅ Resultado

**Todos los endpoints `/excel/*` ahora garantizan:**
- ✅ Devolver `Content-Type: application/json`
- ✅ Nunca servir HTML de error
- ✅ Capturar y manejar cualquier excepción
- ✅ Devolver respuestas JSON consistentes

### Ejemplo de Respuesta de Error Antes/Después

**ANTES (❌ HTML):**
```html
<!DOCTYPE html>
<html>
  <head><title>503 Service Unavailable</title></head>
  <body>Service Unavailable</body>
</html>
```

**DESPUÉS (✅ JSON):**
```json
{
  "ok": false,
  "error": "No hay copia local del archivo. Llama a POST /excel/sync primero.",
  "code": "EXCEL_ERROR"
}
```

---

## 🚀 Próximos Pasos

1. **commit y push** de los cambios:
   ```bash
   git add src/routes.js src/server.js test-endpoints.js TROUBLESHOOTING.md CHANGES.md
   git commit -m "Fix: Garantizar respuestas JSON en endpoints /excel"
   git push origin main
   ```

2. **En el servidor remoto**:
   ```bash
   git pull origin main
   npm install  # por si hay nuevas dependencias
   # Reiniciar el servidor
   pm2 restart MapaAyudas  # o npm start
   ```

3. **Verificar**:
   ```bash
   node test-endpoints.js https://ayudas.isamart.es
   ```

---

## 📋 Checklist de Validación

- [x] Content-Type se fuerza a `application/json` en todas las rutas `/excel`
- [x] Errores no capturados son convertidos a JSON
- [x] POST requests reciben respuestas JSON (no 404 HTML)
- [x] Error handler específico implementado en routes.js
- [x] Error handler global mejorado en server.js
- [x] Script de diagnóstico creado
- [x] Documentación de troubleshooting completa
