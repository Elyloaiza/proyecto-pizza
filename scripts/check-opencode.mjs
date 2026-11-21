// Verifica credenciales y modelo de OpenCode (usa .env.local o variables de entorno). No imprime la clave.
// Uso: node scripts/check-opencode.mjs
import { existsSync, readFileSync } from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const key = process.env.OPENCODE_API_KEY?.trim();
const model = process.env.OPENCODE_MODEL?.trim();
const base = (process.env.OPENCODE_BASE_URL?.trim() || 'https://opencode.ai/inference/openai/v1').replace(/\/+$/, '');
if (!key || !model) {
  console.error('Faltan OPENCODE_API_KEY y/o OPENCODE_MODEL. Defínalas en .env.local (ver .env.example).');
  process.exit(2);
}
const modelsUrl = base.replace(/\/openai\/v1$/, '') + '/v1/models';
const lr = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${key}` } });
console.log(`GET ${modelsUrl} → HTTP ${lr.status}`);
if (lr.ok) {
  const j = await lr.json();
  const ids = (j.data ?? []).map((m) => m.id);
  console.log(ids.includes(model) ? `✔ El modelo «${model}» aparece en la lista.` : `✘ El modelo «${model}» NO aparece. Disponibles (primeros 15): ${ids.slice(0, 15).join(', ')}`);
}
const r = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responde solo: OK' }], max_tokens: 20 }),
});
const t = await r.text();
console.log(`POST ${base}/chat/completions → HTTP ${r.status}`);
try {
  console.log('Respuesta:', JSON.parse(t).choices?.[0]?.message?.content ?? t.slice(0, 300));
} catch {
  console.log(t.slice(0, 300));
}
process.exit(r.ok ? 0 : 1);
