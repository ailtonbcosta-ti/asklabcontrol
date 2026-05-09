export const onlyDigitsCep = (v?: string | null) => (v || '').replace(/\D/g, '');

export function maskCep(raw?: string | null): string {
  const d = onlyDigitsCep(raw).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function isValidCep(raw?: string | null): boolean {
  return onlyDigitsCep(raw).length === 8;
}
