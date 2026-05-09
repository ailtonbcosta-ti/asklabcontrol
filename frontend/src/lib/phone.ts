export const onlyDigitsPhone = (v?: string | null) => (v || '').replace(/\D/g, '');

export function maskPhone(raw?: string | null): string {
  const d = onlyDigitsPhone(raw).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function isValidPhone(raw?: string | null): boolean {
  const d = onlyDigitsPhone(raw);
  return d.length === 10 || d.length === 11;
}
