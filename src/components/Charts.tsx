import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear, scalePoint } from 'd3-scale';
import { line as d3line } from 'd3-shape';

function useWidth(initial = 760) {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(280, Math.round(el.clientWidth)) || initial);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, w] as const;
}

export interface LineSeries {
  name: string;
  cls: string; // clase CSS de color (s1, s2)
  values: (number | null)[];
}

const niceTicks = (max: number, n = 5): number[] => {
  if (max <= 0) return [0];
  const raw = max / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Number(v.toFixed(10)));
  return out;
};

interface LineProps {
  title: string;
  xs: string[];
  series: LineSeries[];
  xLabel: (x: string) => string;
  yFormat: (v: number) => string;
  fmtTip: (v: number | null) => string;
  yTitle: string;
}

export function LineChart({ title, xs, series, xLabel, yFormat, fmtTip, yTitle }: LineProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = W < 520 ? 260 : 320;
  const m = { l: W < 520 ? 52 : 64, r: 12, t: 14, b: 44 };
  const { x, y, ticks, path } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const max = Math.max(0, ...all);
    const min = Math.min(0, ...all);
    const ticks = niceTicks(max - min === 0 ? 1 : max);
    const top = Math.max(max, ticks[ticks.length - 1] ?? 0);
    const y = scaleLinear().domain([min, top]).range([H - m.b, m.t]);
    const x = scalePoint<string>().domain(xs).range([m.l, W - m.r]).padding(0.02);
    const gen = d3line<{ k: string; v: number | null }>().defined((d) => d.v !== null).x((d) => x(d.k)!).y((d) => y(d.v as number));
    return { x, y, ticks, path: series.map((s) => gen(xs.map((k, i) => ({ k, v: s.values[i] }))) ?? '') };
  }, [xs, series, W, H]);
  const step = Math.max(1, Math.ceil(xs.length / (W < 520 ? 4 : 8)));
  return (
    <figure className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          let bd = Infinity;
          xs.forEach((k, i) => {
            const d = Math.abs((x(k) ?? 0) - px);
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          setHover(best);
        }}>
        <text className="axis-title" x={12} y={m.t + 4} transform={`rotate(-90 12 ${(H - m.b + m.t) / 2 + 40})`} textAnchor="middle">{yTitle}</text>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
            <text className="tick" x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">{yFormat(t)}</text>
          </g>
        ))}
        {xs.map((k, i) => (i % step === 0 ? <text key={k} className="tick" x={x(k)} y={H - m.b + 18} textAnchor="middle">{xLabel(k)}</text> : null))}
        {series.map((s, i) => <path key={s.name} d={path[i]} className={`line ${s.cls}`} fill="none" />)}
        {hover !== null && (
          <g>
            <line className="cursor" x1={x(xs[hover])} x2={x(xs[hover])} y1={m.t} y2={H - m.b} />
            {series.map((s) => s.values[hover] !== null && <circle key={s.name} className={`dot ${s.cls}`} cx={x(xs[hover])} cy={y(s.values[hover] as number)} r={4} />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tip" role="status">
          <strong>{xLabel(xs[hover])}</strong>
          {series.map((s) => <span key={s.name}><i className={`sw ${s.cls}`} />{s.name}: {fmtTip(s.values[hover])}</span>)}
        </div>
      )}
      <figcaption className="legend">{series.map((s) => <span key={s.name}><i className={`sw ${s.cls}`} />{s.name}</span>)}</figcaption>
    </figure>
  );
}

export interface BarItem {
  label: string;
  value: number | null;
  text: string;
  sub?: string;
}

export function BarChart({ title, items, cls = 's1', unit }: { title: string; items: BarItem[]; cls?: string; unit: string }) {
  const [ref, W] = useWidth();
  const small = W < 520;
  const rowH = 28;
  const labelW = small ? 104 : 190;
  const valueW = small ? 84 : 150;
  const H = items.length * rowH + 34;
  const max = Math.max(1e-9, ...items.map((i) => Math.max(0, i.value ?? 0)));
  const x = scaleLinear().domain([0, max]).range([0, Math.max(40, W - labelW - valueW)]);
  const maxChars = small ? 14 : 26;
  const trunc = (s: string) => (s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s);
  return (
    <figure className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Valores en ${unit}.`}>
        {items.map((it, i) => (
          <g key={it.label} transform={`translate(0 ${i * rowH + 4})`}>
            <title>{`${it.label}: ${it.text}${it.sub ? ' · ' + it.sub : ''}`}</title>
            <text className="tick" x={labelW - 8} y={rowH / 2} dy="0.32em" textAnchor="end">{trunc(it.label)}</text>
            <rect className={`bar ${cls}`} x={labelW} y={3} height={rowH - 8} width={Math.max(2, x(Math.max(0, it.value ?? 0)))} rx={3} />
            <text className="val" x={labelW + Math.max(2, x(Math.max(0, it.value ?? 0))) + 6} y={rowH / 2} dy="0.32em">{it.text}</text>
          </g>
        ))}
        <text className="axis-title" x={labelW} y={H - 6}>Valores en {unit}</text>
      </svg>
    </figure>
  );
}
