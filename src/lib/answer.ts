// Interpreta la respuesta JSON del modelo. Tolera bloques de código y respuestas recortadas por límite de longitud.

export interface AiItem {
  tipo: 'hallazgo' | 'interpretacion' | 'recomendacion';
  titulo?: string;
  texto?: string;
  evidencias: string[];
  accion?: string;
  justificacion?: string;
  supuesto_limitacion?: string;
}
export interface AiAnswer {
  resumen?: string;
  items: AiItem[];
  datos_faltantes?: string | null;
  /** true si la respuesta llegó cortada y se conservaron solo los elementos completos */
  truncated?: boolean;
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function normalize(j: any, truncated: boolean): AiAnswer | null {
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
  if (!items.length && typeof j.resumen !== 'string') return null;
  return { resumen: typeof j.resumen === 'string' ? j.resumen : undefined, items, datos_faltantes: typeof j.datos_faltantes === 'string' ? j.datos_faltantes : null, truncated };
}

export function parseAnswer(raw: string): AiAnswer | null {
  const s0 = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s0.indexOf('{');
  if (a < 0) return null;
  const s = s0.slice(a);
  const b = s.lastIndexOf('}');
  if (b > 0) {
    const full = tryJson(s.slice(0, b + 1));
    if (full !== undefined) return normalize(full, false);
  }
  // Respuesta recortada: se cierra tras el último elemento completo
  let tries = 0;
  for (let i = s.lastIndexOf('}'); i > 0 && tries < 80; i = s.lastIndexOf('}', i - 1), tries++) {
    const head = s.slice(0, i + 1);
    for (const tail of [']}', '}', ']}}']) {
      const j = tryJson(head + tail);
      if (j !== undefined) return normalize(j, true);
    }
  }
  return null;
}
