# San Francisco Crust Pizza · Inteligencia de negocios (proyecto académico)

Aplicación web de apoyo a decisiones comerciales: **Dashboard**, **Datos** (carga/actualización de CSV y XLSX) y **Asistente IA** (chat con un LLM de OpenCode). Integra Ventas, Clientes y Productos. Todo el procesamiento de archivos y los cálculos ocurren en el navegador; la única función de servidor es `POST /api/chat`.

## Estado de la entrega (leer primero)

| Elemento | Estado |
|---|---|
| Aplicación (dashboard, importador, asistente) | Implementada y verificada con los datos reales del enunciado |
| Pruebas | 22 pruebas unitarias/de integración + 43 comprobaciones funcionales en Chromium, todas correctas |
| **Despliegue en Vercel (URL `.vercel.app`)** | **PENDIENTE.** No se publicó ninguna URL. Ver «Despliegue» |
| **Consulta real a OpenCode** | **PENDIENTE.** No había API key. La función se probó solo contra un proveedor *simulado*; la conexión real no está validada |
| `package-lock.json` | **PENDIENTE.** El entorno de desarrollo no tenía acceso a npm; se genera con el primer `npm install` y debe versionarse |

### Desviaciones respecto al requerimiento (por falta de acceso a npm en el entorno de desarrollo)

1. **Build con esbuild en lugar de Vite.** La estructura (`index.html`, `src/main.tsx`, `public/`) es compatible con Vite; `npm run build` genera `dist/` con esbuild. Migrar a Vite es directo si se desea.
2. **Lector XLSX propio** (`src/lib/xlsx.ts`, sobre `jszip`) en lugar de una biblioteca dedicada. Soporta hojas, cadenas compartidas/en línea, números, booleanos y fechas según formato de celda, y se probó con los XLSX reales. No evalúa fórmulas (usa el valor en caché) ni lee `.xls` antiguos. Está aislado en un solo módulo para sustituirlo (p. ej. por `read-excel-file`).
3. **Gráficos en SVG propio** con `d3-scale` y `d3-shape` (mantenidos) en lugar de una biblioteca de gráficos completa. Incluyen etiquetas, unidades, tooltip y tabla equivalente.
4. CSV con `d3-dsv` (mantenido).

## Qué se construyó

- **Dashboard:** 6 KPIs (ventas, utilidad bruta, margen bruto, ticket, clientes, transacciones) con ayuda de definición; evolución diaria/mensual; productos más vendidos (unidades vs ingresos); rentabilidad por producto; ventas por ciudad; desempeño por sucursal (mejor/peor por utilidad bruta, ordenable por ventas o margen); segmentos. Filtros combinables (fechas, ciudad, sucursal, segmento, producto), «Limpiar filtros», tablas ordenables, descarga CSV por tabla y «Copiar resumen».
- **Datos:** selector o arrastrar y soltar, hoja XLSX, separador CSV, vista previa, mapeo es/en editable, formatos de número/fecha (se pide elegir si son ambiguos), errores con hoja y fila, varias sustituciones confirmadas juntas y de forma atómica, límites configurables (10 MB / 100.000 filas), plantillas, diccionario, restaurar datos iniciales y descargar datos vigentes (.zip).
- **Asistente IA:** 5 consultas sugeridas, contexto estructurado con evidencias (E1…E8), respuestas JSON con hallazgo / interpretación / recomendación, verificación de que cada evidencia citada exista, marca de «contexto anterior», contexto nuevo al reemplazar datos, copia de conversación con evidencias.

## Estructura

```
api/chat.ts            Única Vercel Function (POST /api/chat; GET devuelve solo si está configurada)
server/chat-core.ts    Validación, límites, prompt de sistema, errores (probado con fetch simulado)
src/lib/               Núcleo sin DOM: xlsx, csv, parseValues, mapping, importer, model, metrics, context, storage
src/components/        Dashboard, DataView, Importer, Assistant, Charts, DataTable, MultiSelect
public/datos-iniciales Los 3 XLSX reales del enunciado (conjunto inicial)
public/ejemplos        Archivos de ejemplo (actualización, inválido, ambiguo, caso pequeño A/B/T1/T2)
public/plantillas      Plantillas CSV y diccionario de campos
tests/                 core, chat, real-data (node:test) y e2e.mjs (Playwright)
scripts/               build.mjs, dev.ts, check-opencode.mjs, make-templates.ts
```

## Instalación y ejecución local

Requiere Node ≥ 20.

```bash
npm install
cp .env.example .env.local     # y complete OPENCODE_API_KEY y OPENCODE_MODEL
npm run dev                    # http://localhost:3000 (front + /api/chat con la misma función de Vercel)
npm run build                  # genera dist/
npm test                       # pruebas unitarias
npm run test:e2e               # flujo completo en Chromium (requiere Playwright instalado)
```

Alternativa con Vercel CLI: `npx vercel dev` (lee `.env.local`).

## Variables de entorno (solo servidor)

| Variable | Descripción |
|---|---|
| `OPENCODE_API_KEY` | Clave de OpenCode Console. **Nunca** con prefijo `VITE_`; no se envía al navegador ni se registra |
| `OPENCODE_BASE_URL` | `https://opencode.ai/inference/openai/v1` |
| `OPENCODE_MODEL` | ID real del modelo, **sin prefijo de proveedor** (la documentación usa p. ej. `claude-sonnet-5-5`). Consulte `GET https://opencode.ai/inference/v1/models` |
| `AI_ENABLED` | `true` para activar el asistente; cualquier otro valor lo desactiva |
| `OPENCODE_TOKEN_PARAM` (opc.) | `max_tokens` (por defecto) o `max_completion_tokens` si el modelo lo exige |
| `OPENCODE_MAX_OUTPUT_TOKENS` (opc.) | Salida máxima, 1500 por defecto |

La clave vive en `.env` o `.env.local` (ambos excluidos del control de versiones; `npm run dev` lee los dos y `.env.local` tiene prioridad) en local y en **Vercel → Project → Settings → Environment Variables** en producción; `api/chat.ts` la lee con `process.env`. Para comprobar credenciales y modelo: `node scripts/check-opencode.mjs`.

**Presupuesto:** los límites de la app (una consulta simultánea, pregunta ≤ 2.000 caracteres, cuerpo ≤ 256 KiB, salida ≈ 1.500 tokens) **no son un límite global de gasto**. Configure el tope de gasto/saldo en OpenCode Console (workspace → billing/limits). La opción prevista es Console de pago por uso; no se asume que una suscripción OpenCode Go cubra este uso (su documentación la orienta a agentes de programación): verifique con el proveedor. Los modelos gratuitos solo funcionan dentro de OpenCode y otros clientes reciben HTTP 403.

## Despliegue en Vercel (paso pendiente)

1. Suba este directorio a un repositorio de GitHub (sin `.env.local`) o use el CLI.
2. Con CLI: `npx vercel login` → `npx vercel` (vincular proyecto) → `npx vercel env add OPENCODE_API_KEY` (Production, Preview y Development; repita con `OPENCODE_MODEL`, `OPENCODE_BASE_URL`, `AI_ENABLED`) → `npx vercel --prod`.
3. `vercel.json` ya fija `buildCommand`, `outputDirectory: dist` y `maxDuration: 60` para la función. **No hay rewrites de SPA**: la navegación usa `#/dashboard`, `#/datos`, `#/asistente`, así que nada intercepta `/api/chat`.
4. En el proyecto, desactive «Vercel Authentication / Deployment Protection» para que la URL `.vercel.app` sea pública sin iniciar sesión.
5. Verifique en una ventana de incógnito: carga inicial, subir archivo, filtros y una consulta real al asistente (el chat debe dejar de mostrar «Asistente pendiente de configuración»).

## Esquema lógico y decisión de grano

Los XLSX reales traen: **Ventas** (`VentaID, Fecha, Año, Mes, Trimestre, Ciudad, Sucursal, ClienteID, ProductoID, Cantidad, PrecioUnitario, CostoUnitario, DescuentoPct, VentaNeta, CostoTotal, UtilidadBruta, Canal, FormaPago, TiempoEntregaMin, TiempoPreparacionMin`; 45.900 filas, 2024-01-01 a 2025-12-28), **Clientes** (1.000) y **Productos** (44).

- **Grano:** `VentaID` es único en las 45.900 filas, por lo que **cada fila es una línea de producto y, a la vez, una transacción**. Si en una carga un identificador se repite, la app trata esas filas como líneas de un mismo pedido (una transacción). Si el mismo identificador aparece en fechas o sucursales distintas, usa la clave compuesta id + fecha + sucursal.
- **Mapeo:** se mapea por nombres equivalentes (diccionario en la pestaña Datos). Columnas sin uso (Año, Mes, Canal, NPS, nombre del cliente, etc.) se ignoran; **no se almacenan nombres de clientes**.
- Los identificadores se conservan como texto (ceros iniciales). Vacíos nunca se convierten en cero.
- **Calidad detectada en los datos reales:** en el 100 % de las ventas el precio y el costo registrados difieren de los del catálogo de Productos (diferencia media absoluta ≈ 5,14 USD en precio y 2,05 USD en costo). La app usa el importe y costo **registrados en cada venta** y lo advierte; no mezcla con el catálogo.

## Fórmulas (`src/lib/metrics.ts`)

- **Ventas totales** = Σ importe neto de línea (`VentaNeta`, ya con descuento). Sin importe: cantidad × precio × (1 − descuento); como último recurso, precio del catálogo (se contabiliza y advierte). Importes negativos se conservan con su signo (devoluciones).
- **Costo vendido** = Σ cantidad × costo unitario registrado en la venta; si falta, costo total de línea; si falta, costo actual del catálogo (utilidad marcada como **estimada**). Costo desconocido **no** se toma como cero: la utilidad y el margen se calculan sobre las ventas con costo conocido y se muestra la cobertura («utilidad parcial»).
- **Utilidad bruta** = ventas − costo vendido (no es utilidad neta).
- **Margen bruto** = utilidad bruta total ÷ ventas totales × 100 (sobre totales, no promedio de porcentajes).
- **Transacciones** = claves de transacción distintas. **Ticket** = ventas de la selección ÷ transacciones distintas de la selección (con filtro de producto: importe de esos productos por transacción que los contiene).
- **Clientes** = clientes distintos con compras en la selección (distinto del total registrado). Ventas sin cliente identificable no cuentan como un cliente; clientes sin segmento o ausentes del maestro → «Sin clasificar».
- Sin ventas: «Sin resultados»; margen/ticket con denominador cero: «No aplica». Nunca NaN ni infinito.
- Maestros con identificadores duplicados: se conserva la primera aparición y se advierte (no multiplican ventas).

## Persistencia por navegador

Las cargas se guardan en **IndexedDB de este navegador** (último conjunto válido + configuración de importación). Otros visitantes ven el conjunto inicial del despliegue. Publicar un nuevo conjunto inicial para todos requiere reemplazar los archivos de `public/datos-iniciales/` y volver a desplegar. «Restaurar datos iniciales» descarta lo cargado; «Descargar datos vigentes» exporta un .zip con tres CSV re-importables. Si IndexedDB falla, se trabaja en memoria y se avisa que los cambios no se conservarán.

## Seguridad del asistente

Prompt de sistema solo en el servidor; URL, modelo y parámetros controlados por el servidor (el cliente no puede cambiarlos). Contexto, historial y archivos se tratan como material a analizar, nunca como instrucciones. No se envían archivos completos ni datos personales: solo KPIs y tablas agregadas. El cliente verifica que cada evidencia citada (E1…) exista en el contexto enviado y marca las que no.

## Pruebas realizadas

- `tests/core.test.ts`: caso A/B/T1/T2 (ventas 50, costo 28, utilidad 22, margen 44 %, ticket 25, 2 clientes, 2 transacciones; filtrado por A: 30 / 12 / 40 % / 15), cinco filtros, selección vacía, ceros iniciales, relaciones incompletas, costo faltante, costo del catálogo, descuento, archivo inválido con conservación del estado, errores con fila, reemplazo sin acumulación, formatos ambiguos, límite de filas, reajuste de filtros, coherencia contexto de IA ↔ KPIs.
- `tests/real-data.test.ts`: los XLSX reales coinciden con un cálculo independiente en pandas (ventas 1.357.881,66; costo 544.167,90; utilidad 813.713,76; margen 59,93 %).
- `tests/chat.test.ts`: validación de cuerpo, límites, URL/clave/modelo fijados por el servidor, errores diferenciados, timeout.
- `tests/e2e.mjs` (Chromium): KPIs reales, filtros, ordenación, CSV, archivo inválido, formatos ambiguos, reemplazo sin acumulación, recarga con persistencia, restauración, asistente (contra proveedor **simulado**), contexto anterior/nuevo, copia, móvil sin desbordamiento, sin clave y sin errores de consola.

Pendiente de verificar con credenciales reales: respuesta real del modelo (formato JSON, citas de evidencia, compatibilidad de `max_tokens`) y comportamiento en la URL desplegada.

## Datos reales vs. demostración

El conjunto inicial son los **datos reales aportados** con el enunciado. Los archivos de `public/ejemplos/` llevan «demo» en el nombre y se derivan de esos datos (p. ej. `Ventas_demo_actualizacion_2025.csv` = solo las ventas de 2025: 19.500 filas, ventas 574.105,40, utilidad 341.164,27, margen 59,4 %). Cuando los datos vigentes provienen de un archivo con «demo» en el nombre, la app muestra permanentemente «Datos de demostración». No presente resultados de demostración como hallazgos reales de la empresa.

## Entregables académicos (checklist)

- [ ] URL pública funcional (`.vercel.app`) — **pendiente de desplegar**
- [ ] Documento ejecutivo (≤ 5 págs. para cumplir ambos límites del enunciado; Times New Roman 12, interlineado 1,5): cinco hallazgos, respuestas justificadas, cinco decisiones, plataforma de desarrollo, proveedor y modelo del asistente, prompt principal y valoración crítica de la IA
- [ ] Presentación de máximo 7 diapositivas, hoja de control y número y nombres de integrantes
- [ ] Vídeo explicativo de máximo 10 minutos (ver `GUION_DEMO.md`)
- [ ] Bibliografía APA con correspondencia entre citas y referencias

El prompt principal está en `REQUERIMIENTO_PROMPT_PRINCIPAL.txt`. La app facilita extraer evidencias (copiar conversación y evidencias, CSV por tabla), pero no genera Word, PowerPoint ni vídeo. Los nombres del equipo, la bibliografía, los hallazgos y las conclusiones los debe aportar el equipo.
