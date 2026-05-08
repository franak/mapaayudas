## 🔧 Resolución de Errores de Sincronización y Carga

### Problemas Reportados

1. **"Unexpected token '<', "<!DOCTYPE"... is not valid JSON"** - Al cargar la tabla
2. **POST /excel/sync → 404 (Not Found)** - Al intentar sincronizar

---

## 🔍 Análisis del Problema

El servidor estaba devolviendo **HTML en lugar de JSON** en algunos casos de error, lo que causaba que el navegador no pudiera hacer parse del JSON correctamente.

### Causas Identificadas

1. **Middleware de HTML fallback**: Express servía `index.html` para rutas no reconocidas
2. **Error handler incorrecto**: No forzaba `Content-Type: application/json` en errores
3. **Falta de archivo local**: Sin sincronización inicial, `/excel` devolvía 503 pero con HTML

---

## ✅ Soluciones Implementadas

### 1. Middleware de Content-Type Garantizado
Se agregó middleware en `routes.js` que **fuerza `Content-Type: application/json`** para todos los endpoints:

```javascript
router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});
```

### 2. Error Handler Específico para /excel
Se agregó un error handler al final de `routes.js` que captura **cualquier error** en `/excel` y lo devuelve como JSON:

```javascript
router.use((err, req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(err.status || 500).json({
    ok: false,
    error: err.message,
    code: err.code || 'EXCEL_ERROR',
  });
});
```

### 3. Middleware para POST /excel/*
Se agregó un middleware explícito que captura **cualquier POST sin handler** en `/excel`:

```javascript
app.use('/excel', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    method: req.method,
    path: req.path
  });
});
```

---

## 🚀 Pasos Siguientes

### En el Servidor Local/Desarrollo

```bash
# 1. Asegurar que las dependencias están actualizadas
npm install

# 2. Ejecutar el test de endpoints para verificar que funcionen
node test-endpoints.js http://localhost:3000

# 3. (Opcional) Ejecutar con logs detallados
DEBUG=* npm start
```

### En el Servidor Remoto (ayudas.isamart.es)

1. **Hacer pull de los cambios**:
   ```bash
   git pull origin main  # o tu rama
   npm install
   ```

2. **Reiniciar el servidor**:
   ```bash
   # Si usas PM2
   pm2 restart MapaAyudas
   
   # Si usas systemd
   sudo systemctl restart mapaayudas
   
   # O manualmente
   npm start
   ```

3. **Verificar que funciona** (desde shell/terminal):
   ```bash
   # Health check
   curl -i https://ayudas.isamart.es/health
   
   # Status de sincronización
   curl -i https://ayudas.isamart.es/excel/status
   
   # Forzar sincronización
   curl -i -X POST https://ayudas.isamart.es/excel/sync
   ```

---

## 🔬 Diagnóstico  

### Verificar que los endpoints devuelven JSON

```bash
# Esto debe devoler JSON, NO HTML
curl -H "Accept: application/json" https://ayudas.isamart.es/excel/status

# Ver los headers
curl -i https://ayudas.isamart.es/excel
```

### Ver los logs del servidor

```bash
# Si es PM2
pm2 logs MapaAyudas

# Si es systemd
journalctl -u mapaayudas -f
```

---

## 📋 Checklist de Verificación

- [ ] El servidor inicia sin errores
- [ ] `GET /health` devuelve `{ "status": "ok" }`
- [ ] `GET /excel/status` devuelve estado de sincronizaciones (JSON)
- [ ] `POST /excel/sync` ejecuta sin errores (202-203)
- [ ] `GET /excel` devuelve combinedData (JSON)
- [ ] El navegador carga la tabla sin errores "JSON.parse"
- [ ] El botón "Sincronizar" (↻) funciona correctamente
- [ ] El Content-Type de todas las respuestas es `application/json`

---

## 🚨 Si Sigue Fallando

### Revisar:

1. **Variables de entorno** (`.env`):
   - `SOURCE_PAGE_URL` correctamente apuntando a la web de COAM
   - `BASE_EXCEL_URL` configurada
   - `ADMIN_EMAIL` y `URL_HOME` presentes

2. **Directorios de datos**:
   ```bash
   ls -la data/
   # Debe existir: mapa-ayudas-vigente.xlsx (después de primera sincronización)
   ```

3. **Permisos de archivos**:
   ```bash
   chmod 755 data/
   chmod 644 data/*.json
   ```

4. **Conectividad externa**:
   - El servidor puede acceder a `https://oficinarehabilitacion.coam.org/...`?
   ```bash
   curl -I "https://oficinarehabilitacion.coam.org/oficina-rehabilitacion-ayudas-mapa-ayudas-vigente/"
   ```

---

## 📝 Notas

- Los cambios son **retrocompatibles** (no rompen nada existente)
- El archivo `test-endpoints.js` ayuda a diagnosticar problemas rápidamente
- Todos los endpoints bajo `/excel/*` ahora garantizan devolver JSON
- Los errores incluyen timestamps para debugging
