import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChat, LIMITS, SYSTEM_PROMPT, type ChatEnv } from '../server/chat-core';

const ctx = { version_datos: 'v1', evidencias: [{ id: 'E1' }] };
const body = (o: object = {}) => JSON.stringify({ question: '¿Qué sucursal es mejor?', history: [], context: ctx, ...o });
const env: ChatEnv = { OPENCODE_API_KEY: 'sk-test-SECRET', OPENCODE_MODEL: 'modelo-x', AI_ENABLED: 'true' };
const resp = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

test('sin clave o modelo: asistente pendiente de configuración (sin llamar al proveedor)', async () => {
  let called = false;
  const f = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
  const r = await handleChat(body(), { AI_ENABLED: 'true' }, f);
  assert.equal(r.status, 503);
  assert.equal((r.body as any).code, 'not_configured');
  assert.deepEqual((r.body as any).missing, ['OPENCODE_API_KEY', 'OPENCODE_MODEL']);
  assert.equal(called, false);
});

test('AI_ENABLED desactiva el asistente', async () => {
  const r = await handleChat(body(), { ...env, AI_ENABLED: 'false' });
  assert.equal((r.body as any).code, 'disabled');
});

test('validación del cuerpo: pregunta larga, historial, contexto, tamaño', async () => {
  assert.equal((await handleChat(body({ question: 'x'.repeat(LIMITS.maxQuestionChars + 1) }), env)).status, 400);
  assert.equal((await handleChat(body({ question: '   ' }), env)).status, 400);
  assert.equal((await handleChat(body({ history: Array(7).fill({ role: 'user', content: 'a' }) }), env)).status, 400);
  assert.equal((await handleChat(body({ history: [{ role: 'system', content: 'a' }] }), env)).status, 400);
  assert.equal((await handleChat(body({ context: {} }), env)).status, 400);
  assert.equal((await handleChat('no es json', env)).status, 400);
  assert.equal((await handleChat(body({ context: { ...ctx, relleno: 'x'.repeat(LIMITS.maxBodyBytes) } }), env)).status, 413);
});

test('éxito: URL, cabecera, modelo y límite de salida controlados por el servidor; la clave no se devuelve', async () => {
  let seen: { url?: string; init?: RequestInit } = {};
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ model: 'modelo-x', choices: [{ message: { content: '{"resumen":"ok","items":[]}' } }] }), { status: 200 }); }) as unknown as typeof fetch;
  const r = await handleChat(body({ model: 'hack', max_tokens: 999999, url: 'https://evil' }), { ...env, OPENCODE_BASE_URL: 'https://opencode.ai/inference/openai/v1/' }, f);
  assert.equal(r.status, 200);
  assert.equal(seen.url, 'https://opencode.ai/inference/openai/v1/chat/completions');
  const h = seen.init!.headers as Record<string, string>;
  assert.equal(h.Authorization, 'Bearer sk-test-SECRET');
  const p = JSON.parse(seen.init!.body as string);
  assert.equal(p.model, 'modelo-x');
  assert.equal(p.max_tokens, LIMITS.defaultOutputTokens);
  assert.equal(p.messages[0].role, 'system');
  assert.equal(p.messages[0].content, SYSTEM_PROMPT);
  assert.ok(p.messages[1].content.includes('<contexto_datos>') && p.messages[1].content.includes('<pregunta>'));
  assert.ok(!JSON.stringify(r.body).includes('SECRET'));
});

test('errores diferenciados del proveedor', async () => {
  const code = async (status: number, json: unknown = {}) => ((await handleChat(body(), env, resp(status, json))).body as any).code;
  assert.equal(await code(401), 'invalid_key');
  assert.equal(await code(403), 'forbidden');
  assert.equal(await code(404), 'model_unavailable');
  assert.equal(await code(400, { error: { message: 'Model not found' } }), 'model_unavailable');
  assert.equal(await code(429), 'quota');
  assert.equal(await code(402), 'quota');
  assert.equal(await code(500), 'provider_error');
  assert.equal(await code(400, { error: { message: 'max_tokens exceeds the limit' } }), 'provider_error');
  assert.equal(await code(400, { error: { message: 'Insufficient balance' } }), 'quota');
  assert.equal(await code(200, { choices: [{ message: { content: '' } }] }), 'empty');
});

test('timeout', async () => {
  const f = (async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; }) as unknown as typeof fetch;
  assert.equal(((await handleChat(body(), env, f)).body as any).code, 'timeout');
  const g = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
  assert.equal(((await handleChat(body(), env, g)).body as any).code, 'network');
});

test('respuesta del modelo: JSON completo, con bloque de código y recortado', async () => {
  const { parseAnswer } = await import('../src/lib/answer');
  const full = parseAnswer('```json\n{"resumen":"ok","items":[{"tipo":"hallazgo","texto":"a","evidencias":["E5"]}],"datos_faltantes":null}\n```');
  assert.equal(full?.items.length, 1);
  assert.equal(full?.truncated, false);
  const cut = parseAnswer('{"resumen":"r","items":[{"tipo":"hallazgo","texto":"a","evidencias":["E5"]},{"tipo":"recomendacion","texto":"b","evidencias":["E1"]},{"tipo":"hallazgo","texto":"incomp');
  assert.equal(cut?.truncated, true);
  assert.equal(cut?.items.length, 2);
  assert.equal(cut?.items[1].tipo, 'recomendacion');
  assert.equal(parseAnswer('texto libre sin json'), null);
});
