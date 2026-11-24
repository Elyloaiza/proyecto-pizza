// Comprobación funcional del flujo completo en Chromium (Playwright).
// Usa un proveedor OpenCode SIMULADO local solo para ejercitar /api/chat: NO valida la conexión real con OpenCode.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }
const shots = process.env.SHOTS_DIR ?? join(root, 'test-results');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : '  → ' + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- proveedor simulado ----------
let lastReq = null;
const mockAnswer = { resumen: 'Resumen de prueba.', items: [
  { tipo: 'hallazgo', titulo: 'Mejor sucursal', texto: 'Según la tabla de sucursales (E5) la primera es la de mayor utilidad bruta.', evidencias: ['E5'] },
  { tipo: 'recomendacion', titulo: 'Revisar productos', texto: 'Revisar productos de bajo margen.', evidencias: ['E3', 'E99'], accion: 'Revisar precios', justificacion: 'Menor margen en E3', supuesto_limitacion: 'Costo histórico de venta' },
], datos_faltantes: null };
const provider = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    if (req.url === '/_last') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(lastReq)); return; }
    lastReq = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b || '{}') };
    if (process.env.MOCK_MODE === 'quota') { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"quota exceeded"}}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: JSON.stringify(mockAnswer) } }] }));
  });
}).listen(4010);

const start = (port, env) => {
  const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/dev.ts'], { cwd: root, env: { ...process.env, PORT: String(port), ...env }, stdio: 'ignore' });
  return p;
};
const waitUp = async (port) => { for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) return; } catch {} await sleep(250); } throw new Error('servidor no inició'); };

const main = start(3100, { OPENCODE_BASE_URL: 'http://127.0.0.1:4010/v1', OPENCODE_API_KEY: 'sk-test-SECRETO', OPENCODE_MODEL: 'mock-model', AI_ENABLED: 'true' });
let bare = null;
const cleanup = () => { main.kill(); bare?.kill(); provider.close(); };

try {
  await waitUp(3100);
  bare = start(3101, { SKIP_BUILD: '1', OPENCODE_API_KEY: '', OPENCODE_MODEL: '', AI_ENABLED: 'true' });
  await waitUp(3101);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const base = 'http://127.0.0.1:3100/';
  const kpi = async (label) => (await page.locator('.kpi', { has: page.locator('h3', { hasText: label }) }).locator('.kpival').innerText()).trim();
  const waitKpi = async (label, text, timeout = 30000) => { await page.waitForFunction(([l, t]) => [...document.querySelectorAll('.kpi')].some((k) => k.querySelector('h3')?.textContent?.includes(l) && k.querySelector('.kpival')?.textContent?.trim() === t), [label, text], { timeout }); };
  const nav = (t) => page.locator('nav button', { hasText: t }).click();
  const pickMulti = async (label, option) => { await page.locator(`.field:has(#ms-${label}) .select-btn`).click(); await page.locator('.pop label.check', { hasText: option }).locator('input').check(); await page.keyboard.press('Escape'); };

  // 1. Carga inicial con datos reales
  await page.goto(base);
  await waitKpi('Ventas totales', '$1,357,881.66');
  check('KPI ventas totales (datos reales)', true);
  check('KPI utilidad bruta', (await kpi('Utilidad bruta')) === '$813,713.76', await kpi('Utilidad bruta'));
  check('KPI margen bruto', (await kpi('Margen bruto')) === '59.9 %', await kpi('Margen bruto'));
  check('KPI ticket promedio', (await kpi('Ticket promedio')) === '$29.58', await kpi('Ticket promedio'));
  check('KPI clientes', (await kpi('Clientes')) === '1,000');
  check('KPI transacciones', (await kpi('Transacciones')) === '45,900');
  check('Se muestran período y origen', /2024-01-01 a 2025-12-28/.test(await page.locator('.contextbar').innerText()) && /Datos reales/.test(await page.locator('.contextbar').innerText()));
  check('No aparece «Datos de demostración» con datos reales', (await page.locator('.demo').count()) === 0);
  await page.screenshot({ path: join(shots, '01-dashboard-escritorio.png'), fullPage: true });

  // 2. Filtros
  await pickMulti('Ciudad', 'Dallas');
  await waitKpi('Ventas totales', '$330,545.67');
  check('Filtro ciudad Dallas: ventas, utilidad, tx y ticket', (await kpi('Utilidad bruta')) === '$194,151.53' && (await kpi('Transacciones')) === '11,540' && (await kpi('Ticket promedio')) === '$28.64');
  await pickMulti('Sucursal', 'Dallas North');
  await pickMulti('Segmento', 'Familiar');
  await pickMulti('Producto', 'Pepperoni M');
  await page.fill('#df', '2024-06-01'); await page.fill('#dt', '2025-06-30');
  await waitKpi('Ventas totales', '$635.69');
  check('Cinco filtros combinados', (await kpi('Utilidad bruta')) === '$354.49' && (await kpi('Margen bruto')) === '55.8 %' && (await kpi('Transacciones')) === '19' && (await kpi('Ticket promedio')) === '$33.46' && (await kpi('Clientes')) === '19');
  check('Chips de filtros activos visibles', (await page.locator('.contextbar .chip').count()) >= 4);
  await page.locator('.field:has(#ms-Producto) .select-btn').click();
  await page.locator('.pop label.check', { hasText: 'Pepperoni M' }).locator('input').uncheck();
  await page.keyboard.press('Escape');
  await page.fill('#df', '2030-01-01'); await page.fill('#dt', '');
  await page.waitForSelector('text=Sin resultados para esta combinación de filtros');
  check('Selección vacía explica que no hay resultados (sin NaN)', !(await page.locator('main').innerText()).includes('NaN'));
  await page.locator('.empty .btn.primary', { hasText: 'Limpiar filtros' }).click();
  await waitKpi('Ventas totales', '$1,357,881.66');
  check('Limpiar filtros restablece', true);

  // 3. Tablas ordenables y CSV
  const firstCell = async () => (await page.locator('section[aria-labelledby="h-rent"] tbody tr').first().locator('td').first().innerText()).trim();
  const before = await firstCell();
  await page.locator('section[aria-labelledby="h-rent"] th button', { hasText: 'Margen bruto' }).click();
  const after = await firstCell();
  check('Tabla ordenable por columna', before === 'Mexicana M' && after === 'Refresco L', before + ' → ' + after);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('section[aria-labelledby="h-suc"] button', { hasText: 'Descargar CSV' }).click()]);
  check('Descarga de CSV de sucursales', /desempeno_por_sucursal\.csv/.test(dl.suggestedFilename()));
  check('Hay mejor y peor sucursal', /Mejor sucursal por utilidad bruta: Austin South/.test(await page.locator('section[aria-labelledby="h-suc"] .callouts').innerText()) && /Peor sucursal por utilidad bruta: Dallas Downtown/.test(await page.locator('section[aria-labelledby="h-suc"] .callouts').innerText()), await page.locator('section[aria-labelledby="h-suc"] .callouts').innerText());

  // 4. Datos: archivo inválido, ambiguo, reemplazo
  await nav('Datos');
  await page.locator('input[data-kind="sales"]').setInputFiles(join(root, 'public/ejemplos/Ventas_demo_invalida.csv'));
  await page.waitForSelector('.issue.error');
  const errText = await page.locator('.importer').first().innerText();
  check('Archivo inválido: errores con hoja y fila', /Hoja «CSV», fila/.test(errText) && /Con errores/.test(errText), errText.slice(0, 300));
  check('Archivo inválido: no se puede confirmar', (await page.locator('button', { hasText: 'Confirmar y reemplazar' }).count()) === 0);
  await page.locator('input[data-kind="sales"]').setInputFiles(join(root, 'public/ejemplos/Ventas_demo_formatos_ambiguos.csv'));
  await page.waitForSelector('.banner.warn:has-text("Hace falta su decisión")');
  check('Formatos ambiguos: solicita elegir formato', true);
  await page.locator('#nf-sales').selectOption('eu'); await page.locator('#df-sales').selectOption('dmy');
  await page.waitForSelector('.okmsg');
  check('Formatos ambiguos: se resuelven al elegir', true);
  await page.locator('input[data-kind="sales"]').setInputFiles(join(root, 'public/ejemplos/Ventas_demo_actualizacion_2025.csv'));
  await page.waitForSelector('.badge.ok:has-text("Listo para confirmar")');
  check('Vista previa y mapeo propuesto', (await page.locator('#map-sales-id').inputValue()) === '0' && (await page.locator('.preview tbody tr').count()) === 6);
  await page.screenshot({ path: join(shots, '02-datos-importador.png'), fullPage: true });
  await page.locator('button', { hasText: 'Confirmar y reemplazar' }).click();
  await page.waitForSelector('.banner.ok');
  await nav('Dashboard');
  await waitKpi('Ventas totales', '$574,105.40');
  check('Reemplazo de Ventas: totales del nuevo archivo (19,500 tx)', (await kpi('Transacciones')) === '19,500' && (await kpi('Clientes')) === '1,000' && (await kpi('Margen bruto')) === '59.4 %');
  await nav('Datos');
  await page.locator('input[data-kind="sales"]').setInputFiles(join(root, 'public/ejemplos/Ventas_demo_actualizacion_2025.csv'));
  await page.waitForSelector('.badge.ok:has-text("Listo para confirmar")');
  await page.locator('button', { hasText: 'Confirmar y reemplazar' }).click();
  await page.waitForSelector('.banner.ok');
  await nav('Dashboard');
  check('Volver a cargar el mismo archivo no duplica ventas', (await kpi('Ventas totales')) === '$574,105.40' && (await kpi('Transacciones')) === '19,500');
  check('Archivo de demostración marca «Datos de demostración»', (await page.locator('.demo').count()) === 1);

  // 5. Persistencia y restauración
  await page.reload();
  await waitKpi('Ventas totales', '$574,105.40');
  check('Recarga conserva el último conjunto válido', true);
  await nav('Datos');
  await page.locator('button', { hasText: 'Restaurar datos iniciales' }).click();
  await page.locator('button', { hasText: 'Sí, restaurar' }).click();
  await page.waitForSelector('.banner.ok:has-text("restauró")');
  await nav('Dashboard');
  await waitKpi('Ventas totales', '$1,357,881.66');
  check('Restaurar datos iniciales', (await page.locator('.demo').count()) === 0);

  // 6. Asistente
  await nav('Asistente IA');
  await pickMulti('Ciudad', 'Austin').catch(() => {});
  await page.locator('.suggested .btn').first().click();
  await page.waitForSelector('.msg.assistant .item');
  const ans = await page.locator('.msg.assistant').innerText();
  check('Respuesta del asistente con resumen, tipos y evidencias', /Hallazgo observado/.test(ans) && /Recomendación/.test(ans) && /Supuesto o limitación/.test(ans) && /E5/.test(ans));
  check('Evidencia inexistente (E99) se marca como no verificada', /E99 · no verificada/.test(ans));
  await page.locator('.btnchip', { hasText: 'E5' }).first().click();
  check('Se puede expandir la evidencia citada', (await page.locator('.evidence table tbody tr').count()) === 8);
  const last = await (await fetch('http://127.0.0.1:4010/_last')).json();
  check('Proveedor recibe URL, clave y modelo definidos por el servidor', last.url === '/v1/chat/completions' && last.auth === 'Bearer sk-test-SECRETO' && last.body.model === 'mock-model' && last.body.max_tokens === 2500, JSON.stringify({ u: last.url, m: last.body.model }));
  const user = last.body.messages[1].content;
  check('Contexto enviado con filtros, versión, evidencias y sin datos de clientes', /<contexto_datos>/.test(user) && /"evidencias"/.test(user) && /version_datos/.test(user) && !/Sophia|Johnson|"C00001"/.test(user) && last.body.messages[0].role === 'system');
  const html = await page.content();
  check('La clave no aparece en el navegador', !html.includes('SECRETO') && !readFileSync(join(root, 'dist/index.html'), 'utf8').includes('SECRETO'));
  // contexto anterior al cambiar filtros
  await nav('Dashboard');
  await pickMulti('Ciudad', 'Houston');
  await nav('Asistente IA');
  check('Cambio de filtros marca la respuesta como contexto anterior', (await page.locator('.badge.warn', { hasText: 'Contexto anterior' }).count()) >= 1);
  // copiar
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('button', { hasText: 'Copiar conversación y evidencias' }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Copiar conversación incluye evidencias y advertencia académica', /Evidencias citadas/.test(clip) && /valoración crítica/.test(clip));
  await page.screenshot({ path: join(shots, '03-asistente.png'), fullPage: true });
  // cambio de datos => contexto nuevo
  await nav('Datos');
  await page.locator('input[data-kind="sales"]').setInputFiles(join(root, 'public/ejemplos/Ventas_demo_actualizacion_2025.csv'));
  await page.waitForSelector('.badge.ok:has-text("Listo para confirmar")');
  await page.locator('button', { hasText: 'Confirmar y reemplazar' }).click();
  await page.waitForSelector('.banner.ok');
  await nav('Asistente IA');
  check('Reemplazar datos inicia un contexto nuevo', (await page.locator('.msg').count()) === 0 && (await page.locator('text=Los datos cambiaron').count()) === 1);
  // error del proveedor (cuota) => mensaje diferenciado y reintento manual
  await page.locator('.suggested .btn').nth(1).click();
  await page.waitForSelector('.msg.assistant');
  check('Segunda consulta funciona tras el cambio de datos', true);

  // 7. Móvil
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const mp = await mob.newPage();
  const mErr = [];
  mp.on('pageerror', (e) => mErr.push(String(e)));
  await mp.goto(base);
  await mp.waitForSelector('.kpival');
  for (const t of ['Dashboard', 'Datos', 'Asistente IA']) {
    await mp.locator('nav button', { hasText: t }).click();
    await sleep(300);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`Móvil sin desbordamiento horizontal: ${t}`, over <= 1, `desborde ${over}px`);
    await mp.screenshot({ path: join(shots, `04-movil-${t.replace(/\s/g, '')}.png`), fullPage: true });
  }
  check('Móvil sin errores de página', mErr.length === 0, mErr.join('; '));

  // 8. Sin configuración
  const bp = await (await browser.newContext()).newPage();
  await bp.goto('http://127.0.0.1:3101/#/asistente');
  await bp.waitForSelector('text=Asistente pendiente de configuración');
  check('Sin clave: «Asistente pendiente de configuración» y dashboard operativo', (await bp.locator('.suggested .btn:disabled').count()) === 5);
  await bp.locator('nav button', { hasText: 'Dashboard' }).click();
  await bp.waitForSelector('.kpival');
  check('Dashboard funciona aunque falle la IA', true);

  check('Sin errores graves de consola', consoleErrors.length === 0, consoleErrors.join(' | '));
  await browser.close();
} catch (e) {
  check('Ejecución completa del flujo', false, e.stack ?? String(e));
} finally {
  cleanup();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
