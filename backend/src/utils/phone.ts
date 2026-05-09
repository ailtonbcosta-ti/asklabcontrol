export const onlyDigitsPhone = (v?: string | null): string => (v || '').replace(/\D/g, '');

export function isValidPhone(raw?: string | null): boolean {
  const d = onlyDigitsPhone(raw);
  return d.length === 10 || d.length === 11;
}

export function formatPhone(raw?: string | null): string | null {
  const d = onlyDigitsPhone(raw);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return d || null;
}
