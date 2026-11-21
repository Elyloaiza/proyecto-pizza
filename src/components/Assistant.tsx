import { useEffect, useMemo, useRef, useState } from 'react';
import { contextKey, evidenceToMarkdown, type AiContext, type Evidence } from '../lib/context';
import { fmtDateTime } from '../lib/format';
import type { Filters } from '../lib/types';

export const SUGGESTED = [
  '¿Cuáles son los cinco hallazgos comerciales más importantes y qué evidencia los respalda?',
  '¿Qué sucursal presenta el mejor y el peor desempeño según los indicadores disponibles?',
  '¿Qué productos generan más utilidad y cuáles necesitan revisión?',
  '¿Qué segmento ofrece una oportunidad de crecimiento y por qué?',
  '¿Qué cinco decisiones comerciales propondrías y qué evidencia sustenta cada una?',
];

interface AiItem {
  tipo: 'hallazgo' | 'interpretacion' | 'recomendacion';
  titulo?: string;
  texto?: string;
  evidencias: string[];
  accion?: string;
  justificacion?: string;
  supuesto_limitacion?: string;
}
interface AiAnswer {
  resumen?: string;
  items: AiItem[];
  datos_faltantes?: string | null;
}

export function parseAnswer(raw: string): AiAnswer | null {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  s = s.slice(a, b + 1);
  try {
    const j = JSON.parse(s);
    if (!j || typeof j !== 'object') return null;
    const items: AiItem[] = Array.isArray(j.items)
      ? j.items.filter((i: unknown) => i && typeof i === 'object').map((i: any) => ({
          tipo: ['hallazgo', 'interpretacion', 'recomendacion'].includes(i.tipo) ? i.tipo : 'hallazgo',
          titulo: typeof i.titulo === 'string' ? i.titulo : undefined,
          texto: typeof i.texto === 'string' ? i.texto : undefined,
          evidencias: Array.isArray(i.evidencias) ? i.evidencias.map(String) : [],
          accion: typeof i.accion === 'string' ? i.accion : undefined,
          justificacion: typeof i.justificacion === 'string' ? i.justificacion : undefined,
          supuesto_limitacion: typeof i.supuesto_limitacion === 'string' ? i.supuesto_limitacion : undefined,
        }))
      : [];
    return { resumen: typeof j.resumen === 'string' ? j.resumen : undefined, items, datos_faltantes: typeof j.datos_faltantes === 'string' ? j.datos_faltantes : null };
  } catch {
    return null;
  }
}

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  ctxKey: string;
  version: string;
  period: string;
  filters: string[];
  model?: string;
  evidences?: Evidence[];
  at: string;
  error?: { code: string; message: string };
}

const ERR_TITLE: Record<string, string> = {
  not_configured: 'Asistente pendiente de configuración',
  disabled: 'Asistente desactivado',
  invalid_key: 'Clave de API inválida',
  forbidden: 'Acceso denegado por el proveedor',
  model_unavailable: 'Modelo no disponible',
  quota: 'Cuota o saldo agotado',
  timeout: 'Tiempo de espera agotado',
  too_large: 'Solicitud demasiado grande',
  provider_error: 'Error del proveedor',
  network: 'Sin conexión con el proveedor',
  empty: 'Respuesta vacía',
  bad_request: 'Solicitud inválida',
  client_network: 'No se pudo contactar /api/chat',
};

interface Props {
  version: string;
  filters: Filters;
  getContext: () => AiContext;
  filterLabels: string[];
  period: string;
}

export function Assistant({ version, filters, getContext, filterLabels, period }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'unknown' | 'ready' | 'pending' | 'disabled'>('unknown');
  const [lastQ, setLastQ] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetNote, setResetNote] = useState(false);
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const curKey = contextKey(version, filters);
  const curKeyRef = useRef(curKey);
  curKeyRef.current = curKey;
  const verRef = useRef(version);

  // Tras reemplazar datos: contexto nuevo, sin reutilizar conclusiones anteriores
  useEffect(() => {
    if (verRef.current !== version) {
      verRef.current = version;
      setMsgs([]);
      setLastQ(null);
      setResetNote(true);
    }
  }, [version]);

  useEffect(() => {
    let off = false;
    fetch('/api/chat', { method: 'GET' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { enabled: boolean; configured: boolean }) => !off && setStatus(!j.enabled ? 'disabled' : j.configured ? 'ready' : 'pending'))
      .catch(() => !off && setStatus('unknown'));
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [msgs, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setLastQ(q);
    const ctx = getContext();
    const key = curKey;
    const base = { ctxKey: key, version, period, filters: filterLabels, at: new Date().toISOString() };
    const history = msgs.filter((m) => m.ctxKey === key && !m.error).slice(-6).map((m) => ({ role: m.role, content: m.text.slice(0, 3000) }));
    setMsgs((m) => [...m, { id: idRef.current++, role: 'user', text: q, ...base }]);
    setInput('');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 65_000);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history, context: ctx }), signal: ctl.signal });
      let j: any = null;
      try {
        j = await res.json();
      } catch {
        /* no JSON */
      }
      if (res.ok && j?.ok) {
        setMsgs((m) => [...m, { id: idRef.current++, role: 'assistant', text: j.answer, model: j.model, evidences: ctx.evidencias, ...base, ctxKey: key }]);
        setStatus('ready');
      } else {
        const code = j?.code ?? (res.status === 404 ? 'client_network' : 'provider_error');
        if (code === 'not_configured') setStatus('pending');
        if (code === 'disabled') setStatus('disabled');
        const message = j?.message ?? (res.status === 404 ? 'El endpoint /api/chat no existe en este servidor (¿se está ejecutando sin la función?).' : `Error HTTP ${res.status}.`);
        setMsgs((m) => [...m, { id: idRef.current++, role: 'assistant', text: '', error: { code, message: j?.missing ? `${message} Falta: ${j.missing.join(', ')}.` : message }, ...base }]);
      }
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      setMsgs((m) => [...m, { id: idRef.current++, role: 'assistant', text: '', error: { code: aborted ? 'timeout' : 'client_network', message: aborted ? 'La respuesta tardó más de 65 s.' : 'No se pudo contactar /api/chat. Revise su conexión.' }, ...base }]);
    } finally {
      clearTimeout(t);
      setBusy(false);
    }
  };

  const copyAll = async () => {
    const lines: string[] = ['# Conversación con el asistente — San Francisco Crust Pizza BI', `Copiado: ${new Date().toISOString()}`, ''];
    const used = new Map<string, Evidence>();
    for (const m of msgs) {
      lines.push(`## ${m.role === 'user' ? 'Pregunta' : 'Respuesta'} (${fmtDateTime(m.at)})`);
      lines.push(`_Versión de datos ${m.version} · Período ${m.period} · Filtros: ${m.filters.length ? m.filters.join(' | ') : 'ninguno'}${m.ctxKey !== curKey ? ' · CONTEXTO ANTERIOR' : ''}${m.model ? ` · Modelo ${m.model}` : ''}_`);
      lines.push(m.error ? `**Error:** ${m.error.message}` : m.text, '');
      if (m.evidences) {
        const ans = parseAnswer(m.text);
        const ids = new Set((ans?.items ?? []).flatMap((i) => i.evidencias));
        (m.text.match(/\bE\d+\b/g) ?? []).forEach((i) => ids.add(i));
        for (const e of m.evidences) if (ids.has(e.id)) used.set(`${m.ctxKey}:${e.id}`, e);
      }
    }
    if (used.size) {
      lines.push('## Evidencias citadas');
      for (const e of used.values()) lines.push(evidenceToMarkdown(e), '');
    }
    lines.push('_Las recomendaciones del asistente no son conclusiones académicas: requieren valoración crítica del equipo._');
    await navigator.clipboard?.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const blocked = status === 'pending' || status === 'disabled';

  return (
    <div className="assistant">
      <section className="panel">
        <h2>Asistente IA</h2>
        <p className="muted">Responde con los datos vigentes y los filtros activos del Dashboard. El código calcula las cifras; el modelo las interpreta y debe citar evidencias (E1, E2…). Sus respuestas son propuestas para valoración crítica, no conclusiones definitivas.</p>
        {status === 'pending' && <p className="banner warn flat" role="status"><strong>Asistente pendiente de configuración.</strong> Falta definir en el servidor OPENCODE_API_KEY y OPENCODE_MODEL (variables de entorno de Vercel, o <code>.env.local</code> en local). El resto de la aplicación funciona con normalidad.</p>}
        {status === 'disabled' && <p className="banner warn flat" role="status"><strong>Asistente desactivado</strong> (AI_ENABLED distinto de true en el servidor).</p>}
        <div className="meta">Contexto actual: versión <code>{version}</code> · período {period} · filtros: {filterLabels.length ? filterLabels.join(' | ') : 'ninguno'}</div>
        {resetNote && <p className="banner info flat" role="status"><span>Los datos cambiaron: se inició un contexto nuevo y no se reutilizan conclusiones anteriores como hechos.</span> <button className="btn small ghost" onClick={() => setResetNote(false)}>Entendido</button></p>}
        <h3 id="sug">Consultas sugeridas</h3>
        <div className="sugs suggested" role="group" aria-labelledby="sug">
          {SUGGESTED.map((s, i) => (
            <button key={i} className="btn" disabled={busy || blocked} onClick={() => ask(s)}>{i + 1}. {s}</button>
          ))}
        </div>
      </section>

      <section className="panel chat" aria-label="Conversación" aria-live="polite">
        {msgs.length === 0 && <p className="muted">Aún no hay mensajes. Elija una consulta sugerida o escriba la suya.</p>}
        {msgs.map((m) => (
          <MessageView key={m.id} m={m} stale={m.ctxKey !== curKey} />
        ))}
        {busy && <p className="muted" role="status">Consultando al modelo… (una consulta a la vez)</p>}
        <div ref={endRef} />
      </section>

      <section className="panel composer">
        <label htmlFor="q" className="lbl">Su pregunta</label>
        <textarea id="q" rows={3} maxLength={2000} value={input} disabled={busy || blocked} placeholder="Ej.: ¿Qué ciudad vende más y con qué margen?" onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask(input); }} />
        <div className="row">
          <button className="btn primary" disabled={busy || blocked || !input.trim()} onClick={() => ask(input)}>{busy ? 'Enviando…' : 'Preguntar'}</button>
          {lastQ && msgs[msgs.length - 1]?.error && !busy && <button className="btn" onClick={() => ask(lastQ)}>Reintentar la última pregunta</button>}
          <button className="btn ghost" disabled={msgs.length === 0} onClick={copyAll}>{copied ? 'Copiado ✓' : 'Copiar conversación y evidencias'}</button>
          <button className="btn ghost" disabled={msgs.length === 0 || busy} onClick={() => setMsgs([])}>Borrar conversación</button>
          <span className="muted counter">{input.length}/2000</span>
        </div>
        <p className="muted small">Ctrl+Enter para enviar. Los cambios de filtros no generan llamadas automáticas. No se envían archivos completos ni datos personales de clientes.</p>
      </section>
    </div>
  );
}

function EvidenceChip({ id, evidences }: { id: string; evidences?: Evidence[] }) {
  const [open, setOpen] = useState(false);
  const ev = evidences?.find((e) => e.id === id);
  return (
    <span className="evwrap">
      <button type="button" className={`btnchip ${ev ? '' : 'unknown'}`} aria-expanded={open} onClick={() => setOpen(!open)} title={ev ? ev.titulo : 'Esta referencia no existe en el contexto enviado'}>
        {id}{ev ? '' : ' · no verificada'}
      </button>
      {open && ev && (
        <span className="evidence">
          <strong>{ev.id} · {ev.titulo}</strong>{ev.parcial && <em> — PARCIAL</em>}
          {ev.nota && <small>{ev.nota}</small>}
          <span className="scroll"><table className="preview"><thead><tr>{ev.columnas.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{ev.filas.slice(0, 40).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c === null ? '' : String(c)}</td>)}</tr>)}</tbody></table></span>
        </span>
      )}
    </span>
  );
}

function MessageView({ m, stale }: { m: Msg; stale: boolean }) {
  const ans = useMemo(() => (m.role === 'assistant' && !m.error ? parseAnswer(m.text) : null), [m]);
  const tipo = { hallazgo: 'Hallazgo observado', interpretacion: 'Interpretación', recomendacion: 'Recomendación' } as const;
  return (
    <article className={`msg ${m.role}`} aria-label={m.role === 'user' ? 'Pregunta' : 'Respuesta del asistente'}>
      <header>
        <strong>{m.role === 'user' ? 'Usted' : 'Asistente'}</strong>
        <span className="muted"> · versión <code>{m.version}</code> · {m.period} · {m.filters.length ? m.filters.join(' | ') : 'sin filtros'}{m.model ? ` · ${m.model}` : ''}</span>
        {stale && <span className="badge warn">Contexto anterior (datos o filtros cambiaron)</span>}
      </header>
      {m.role === 'user' && <p>{m.text}</p>}
      {m.error && (
        <div className="banner warn flat" role="alert">
          <strong>{ERR_TITLE[m.error.code] ?? 'Error'}.</strong> {m.error.message}
        </div>
      )}
      {m.role === 'assistant' && !m.error && ans && (
        <div className="answer">
          {ans.resumen && <p className="resumen">{ans.resumen}</p>}
          {ans.items.map((it, i) => (
            <div key={i} className={`item ${it.tipo}`}>
              <span className="tag">{tipo[it.tipo]}</span>
              {it.titulo && <h4>{it.titulo}</h4>}
              {it.texto && <p>{it.texto}</p>}
              {it.tipo === 'recomendacion' && (
                <dl>
                  {it.accion && <><dt>Acción</dt><dd>{it.accion}</dd></>}
                  <dt>Evidencia</dt><dd>{it.evidencias.length ? it.evidencias.map((id) => <EvidenceChip key={id} id={id} evidences={m.evidences} />) : <em>Sin evidencia citada</em>}</dd>
                  {it.justificacion && <><dt>Justificación</dt><dd>{it.justificacion}</dd></>}
                  {it.supuesto_limitacion && <><dt>Supuesto o limitación</dt><dd>{it.supuesto_limitacion}</dd></>}
                </dl>
              )}
              {it.tipo !== 'recomendacion' && (
                <div className="evs">Evidencias: {it.evidencias.length ? it.evidencias.map((id) => <EvidenceChip key={id} id={id} evidences={m.evidences} />) : <em>ninguna citada</em>}</div>
              )}
            </div>
          ))}
          {ans.datos_faltantes && <p className="banner info flat"><strong>Datos faltantes:</strong> {ans.datos_faltantes}</p>}
        </div>
      )}
      {m.role === 'assistant' && !m.error && !ans && (
        <div>
          <p className="banner info flat">La respuesta no llegó en el formato estructurado esperado; se muestra tal cual.</p>
          <p className="raw">{m.text}</p>
          <div className="evs">Evidencias mencionadas: {[...new Set(m.text.match(/\bE\d+\b/g) ?? [])].map((id) => <EvidenceChip key={id} id={id} evidences={m.evidences} />)}</div>
        </div>
      )}
    </article>
  );
}
