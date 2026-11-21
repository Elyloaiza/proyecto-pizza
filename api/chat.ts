// Única Vercel Function del proyecto: POST /api/chat
import { handleChat, type ChatEnv } from '../server/chat-core';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > 256 * 1024) {
    return json(413, { ok: false, code: 'too_large', message: 'La solicitud supera el límite de 256 KiB.' });
  }
  const raw = await request.text();
  const env: ChatEnv = {
    OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
    OPENCODE_BASE_URL: process.env.OPENCODE_BASE_URL,
    OPENCODE_MODEL: process.env.OPENCODE_MODEL,
    AI_ENABLED: process.env.AI_ENABLED,
    OPENCODE_TOKEN_PARAM: process.env.OPENCODE_TOKEN_PARAM,
    OPENCODE_MAX_OUTPUT_TOKENS: process.env.OPENCODE_MAX_OUTPUT_TOKENS,
  };
  const result = await handleChat(raw, env);
  return json(result.status, result.body);
}

export async function GET(): Promise<Response> {
  // Estado público sin secretos: solo indica si el asistente está configurado.
  const on = ['true', '1'].includes((process.env.AI_ENABLED ?? '').trim().toLowerCase());
  const configured = on && !!process.env.OPENCODE_API_KEY?.trim() && !!process.env.OPENCODE_MODEL?.trim();
  return json(200, { enabled: on, configured });
}
