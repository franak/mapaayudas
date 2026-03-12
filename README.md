# Excel REST Service — Mapa de Ayudas

Servicio REST en Node.js que descarga el Excel del **Mapa de Ayudas** desde una URL, lo parsea correctamente (cabeceras fusionadas, fechas, valores nulos) y devuelve el contenido como JSON con caché y filtrado por columna.

---

## Instalación y arranque

```bash
npm install
cp .env.example .env   # configura tus URLs
npm start              # o: npm run dev  (recarga automática)
```

---

## Configuración de URL (`.env`)

El servicio soporta **dos modos** de apuntar al Excel:

| Variable            | Descripción                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `BASE_EXCEL_URL`    | Parte fija de la URL (ej: `https://ejemplo.com/archivos/`)             |
| `DEFAULT_EXCEL_URL` | URL completa usada como fallback cuando no se pasa `?file=` ni `?url=` |
| `CACHE_TTL`         | Segundos de vida de la caché (defecto: `300`)                          |
| `MAX_FILE_SIZE_MB`  | Tamaño máximo descargable (defecto: `50`)                              |

### Cómo se resuelve la URL en cada petición

```
1. ?url=https://...     → se usa tal cual (máxima prioridad)
2. ?file=archivo.xlsx   → BASE_EXCEL_URL + archivo.xlsx
3. (ninguno)            → DEFAULT_EXCEL_URL
```

---

## Endpoints

### `GET /health`
```json
{ "status": "ok" }
```

---

### `GET /excel`

Devuelve el contenido del Excel como JSON.

#### Parámetros de query

| Parámetro              | Descripción                                          |
| ---------------------- | ---------------------------------------------------- |
| `file`                 | Nombre del archivo (se combina con `BASE_EXCEL_URL`) |
| `url`                  | URL completa alternativa                             |
| `sheet`                | Nombre de la hoja. Si se omite, devuelve todas       |
| `nocache=true`         | Fuerza descarga ignorando la caché                   |
| `<columna>=<valor>`    | Filtro exacto (case-insensitive)                     |
| `<columna>=~<parcial>` | Filtro por contenido (prefijo `~`)                   |

#### Ejemplos con el Mapa de Ayudas

```bash
# Todas las hojas (versión por defecto del .env)
GET /excel

# Archivo concreto con la base fija
GET /excel?file=Nuevo-Mapa-de-Ayudas_2026_02_27.xlsx

# Solo la hoja GENERAL
GET /excel?file=Nuevo-Mapa-de-Ayudas_2026.xlsx&sheet=GENERAL

# Filtrar ayudas abiertas
GET /excel?file=Nuevo-Mapa-de-Ayudas_2026.xlsx&sheet=GENERAL&ESTADO DE LA CONVOCATORIA=Abierta

# Filtrar por organismo
GET /excel?sheet=GENERAL&ORIGEN > ORGANISMO=2. COMUNIDAD DE MADRID

# Filtrar ayudas municipales (contiene "3_Ayto.")
GET /excel?sheet=GENERAL&DELIMITACIÓN GEOGRÁFICA=~3_Ayto.

# Filtrar ayuntamiento concreto
GET /excel?sheet=GENERAL&DELIMITACIÓN GEOGRÁFICA=3_Ayto. Madrid

# Combinar: ayudas abiertas + Comunidad de Madrid
GET /excel?sheet=GENERAL&ESTADO DE LA CONVOCATORIA=Abierta&ORIGEN > ORGANISMO=2. COMUNIDAD DE MADRID

# Forzar recarga sin caché
GET /excel?file=Nuevo-Mapa-de-Ayudas_2026.xlsx&nocache=true
```

#### Respuesta de ejemplo

```json
{
  "fromCache": false,
  "url": "https://ejemplo.com/archivos/Nuevo-Mapa-de-Ayudas_2026.xlsx",
  "sheets": ["GENERAL"],
  "filters": { "ESTADO DE LA CONVOCATORIA": "Abierta" },
  "totalRows": 14,
  "cacheTtlSeconds": 300,
  "data": {
    "GENERAL": [
      {
        "ORIGEN > ORGANISMO": "2. COMUNIDAD DE MADRID",
        "ORIGEN > FONDO": "Next Generation EU",
        "DELIMITACIÓN GEOGRÁFICA": "2_REGIONAL",
        "TIPOLOGÍA DE LA EDIFICACIÓN": "USO RESIDENCIAL",
        "NORMATIVA MARCO": "RD 853/2021",
        "TÍTULO DE LA CONVOCATORIA": "Programa de ayudas para la rehabilitación...",
        "FECHA DE PUBLICACIÓN": "2022-03-10",
        "GESTOR DE LAS AYUDAS": "Consejería de Vivienda",
        "ESTADO DE LA CONVOCATORIA": "Abierta",
        "PLAZOS > DESDE": "2022-04-01",
        "PLAZOS > HASTA": "2026-12-31",
        "ACTUACIONES SUBVENCIONABLES > Eficiencia Energética": "✔",
        "COMPATIBILIDAD": "Sí",
        "ACCESO A LA CONVOCATORIA": "https://..."
      }
    ]
  }
}
```

---

### `GET /excel/sheets`

Lista las hojas disponibles en el archivo.

```bash
GET /excel/sheets
GET /excel/sheets?file=Nuevo-Mapa-de-Ayudas_2026.xlsx
```

```json
{
  "fromCache": true,
  "url": "https://ejemplo.com/archivos/Nuevo-Mapa-de-Ayudas_2026.xlsx",
  "sheets": ["GENERAL", "Parametrizables", "Hoja1"]
}
```

---

### `DELETE /excel/cache`

Vacía toda la caché del servidor.

```json
{ "message": "Cache cleared", "deletedKeys": 3 }
```

---

### `POST /excel/source`

Habilita o deshabilita en tiempo de ejecución una de las fuentes (`coam` o `plan-recuperacion`).

Body JSON: `{ "source": "coam"|"plan-recuperacion", "enabled": true|false }`

- Si `enabled: false` → borra la caché/copia local de la fuente para que el frontend no la muestre.
- Si `enabled: true` → fuerza una sincronización inmediata con la fuente y devuelve el resultado para mostrarlo en el frontend.

Ejemplos:

```bash
# Deshabilitar Plan Recuperación (borra cache)
curl -X POST http://localhost:3000/excel/source \
  -H "Content-Type: application/json" \
  -d '{"source":"plan-recuperacion","enabled":false}'

# Habilitar COAM (forzar sync)
curl -X POST http://localhost:3000/excel/source \
  -H "Content-Type: application/json" \
  -d '{"source":"coam","enabled":true}'
```

Respuesta de ejemplo (habilitar):

```json
{ "ok": true, "source": "coam", "enabled": true, "result": { "checked": true, "downloaded": true, "reason": "forzado" } }
```


---

## Estructura del proyecto

```
excel-rest-service/
├── src/
│   ├── server.js        # Entry point, middleware, arranque
│   ├── routes.js        # Endpoints REST
│   ├── excelService.js  # Descarga, parseo de cabeceras fusionadas y filtrado
│   └── cache.js         # Caché en memoria (node-cache)
├── .env.example
├── package.json
└── README.md
```

## Notas sobre el parseo del Excel

La hoja **GENERAL** tiene una estructura especial con **dos filas de cabecera fusionadas**:

- Fila 2: grupos (`ORIGEN`, `PLAZOS`, `ACTUACIONES SUBVENCIONABLES`…)
- Fila 3: subcolumnas (`ORGANISMO`, `FONDO`, `DESDE`, `HASTA`, `Accesibilidad`…)
- Fila 4 en adelante: datos

El servicio construye automáticamente claves compuestas como `ORIGEN > ORGANISMO` o `PLAZOS > DESDE`, preservando la semántica original del documento.
