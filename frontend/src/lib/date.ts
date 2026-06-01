export function formatarDataUTC(dataStr?: string | Date | null): string {
  if (!dataStr) return '';
  const date = new Date(dataStr);
  if (isNaN(date.getTime())) return '';
  const dia = String(date.getUTCDate()).padStart(2, '0');
  const mes = String(date.getUTCMonth() + 1).padStart(2, '0');
  const ano = date.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}
