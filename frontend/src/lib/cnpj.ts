export const onlyDigits = (v?: string | null) => (v || '').replace(/\D/g, '');

export function maskCnpj(raw?: string | null): string {
  const d = onlyDigits(raw).slice(0, 14);
  const p = (a: number, b: number) => d.slice(a, b);
  if (d.length <= 2) return p(0, 2);
  if (d.length <= 5) return `${p(0, 2)}.${p(2, 5)}`;
  if (d.length <= 8) return `${p(0, 2)}.${p(2, 5)}.${p(5, 8)}`;
  if (d.length <= 12) return `${p(0, 2)}.${p(2, 5)}.${p(5, 8)}/${p(8, 12)}`;
  return `${p(0, 2)}.${p(2, 5)}.${p(5, 8)}/${p(8, 12)}-${p(12, 14)}`;
}

export function isValidCnpj(raw?: string | null): boolean {
  const cnpj = onlyDigits(raw);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce((acc, n, i) => acc + Number(n) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, ...w1];
  return calc(cnpj.substring(0, 12), w1) === Number(cnpj[12]) && calc(cnpj.substring(0, 13), w2) === Number(cnpj[13]);
}
