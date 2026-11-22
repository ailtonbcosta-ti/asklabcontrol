/** Gera e baixa um CSV compatível com Excel em pt-BR (separador ";" e BOM UTF-8). */
export function baixarCsv(nomeArquivo: string, cabecalho: string[], linhas: unknown[][]) {
  const cel = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'number' ? v.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 2 }) : String(v);
    // evita que o Excel interprete o conteúdo como fórmula
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const conteudo = [cabecalho, ...linhas].map((l) => l.map(cel).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo.endsWith('.csv') ? nomeArquivo : `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
