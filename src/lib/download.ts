import JSZip from 'jszip';
import type { Dataset } from './types';

const esc = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV con BOM UTF-8 (Excel lo abre con tildes) y punto decimal. */
export function toCsv(columns: string[], rows: unknown[][]): string {
  return '﻿' + [columns, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const downloadText = (name: string, text: string, mime = 'text/csv;charset=utf-8') => downloadBlob(name, new Blob([text], { type: mime }));

export function datasetCsvs(ds: Dataset): Record<string, string> {
  return {
    'Ventas.csv': toCsv(
      ['VentaID', 'Fecha', 'ClienteID', 'ProductoID', 'Cantidad', 'Ciudad', 'Sucursal', 'VentaNeta', 'PrecioUnitario', 'CostoUnitario', 'CostoTotal', 'DescuentoPct'],
      ds.sales.map((s) => [s.id, s.date, s.customerId, s.productId, s.qty, s.city, s.branch, s.lineAmount, s.unitPrice, s.unitCost, s.lineCost, s.discountPct]),
    ),
    'Clientes.csv': toCsv(['ClienteID', 'Segmento'], ds.customers.map((c) => [c.id, c.segment])),
    'Productos.csv': toCsv(['ProductoID', 'Producto', 'CostoUSD', 'PrecioVentaUSD', 'Categoria', 'Tamaño', 'Activo'], ds.products.map((p) => [p.id, p.name, p.cost, p.price, p.category, p.size, p.active])),
  };
}

export async function downloadDatasetZip(ds: Dataset): Promise<void> {
  const zip = new JSZip();
  const files = datasetCsvs(ds);
  for (const [n, t] of Object.entries(files)) zip.file(n, t);
  zip.file('LEEME.txt', `Datos vigentes exportados de San Francisco Crust Pizza BI\nVersión: ${ds.version}\nCarga: ${ds.createdAt}\nMoneda: ${ds.currency}\nVuelva a cargar estos tres CSV en la sección Datos para trasladarlos a otro equipo.\n`);
  downloadBlob(`datos_vigentes_${ds.version}.zip`, await zip.generateAsync({ type: 'blob' }));
}
