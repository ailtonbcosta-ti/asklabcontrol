const nf = new Intl.NumberFormat('pt-BR');
const mf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const pf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : nf.format(n));
export const fmtMoeda = (n: number | null | undefined) => (n === null || n === undefined ? '—' : mf.format(n));
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${pf.format(n)}%`);

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** YYYY-MM-DD no fuso local. */
export const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "2026-11-22" → "22/11/2026" sem conversão de fuso. */
export const isoParaBr = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
