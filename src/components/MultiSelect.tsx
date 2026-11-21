import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  options: { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}

export function MultiSelect({ label, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, []);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const vis = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const summary = value.length === 0 ? 'Todas' : value.length === 1 ? options.find((o) => o.id === value[0])?.label ?? value[0] : `${value.length} seleccionadas`;
  return (
    <div className="field ms" ref={ref}>
      <span className="lbl" id={`ms-${label}`}>{label}</span>
      <button type="button" className="select-btn" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`ms-${label}`} onClick={() => setOpen(!open)}>
        <span className="ellip">{summary}</span> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pop" role="group" aria-label={`Opciones de ${label}`}>
          {options.length > 8 && <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Buscar en ${label}`} />}
          <div className="poplist">
            {vis.map((o) => (
              <label key={o.id} className="check">
                <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} /> <span>{o.label}</span>
              </label>
            ))}
            {vis.length === 0 && <span className="muted">Sin coincidencias</span>}
          </div>
          {value.length > 0 && <button type="button" className="btn small ghost" onClick={() => onChange([])}>Quitar selección</button>}
        </div>
      )}
    </div>
  );
}
