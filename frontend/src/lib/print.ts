/**
 * Imprime a página atual (o próprio React renderiza o relatório; o CSS @media print
 * esconde menu, filtros e botões). A orientação é aplicada só durante a impressão.
 */
export function imprimirPagina(orientacao: 'retrato' | 'paisagem' = 'retrato') {
  const style = document.createElement('style');
  style.id = 'asklab-print-page';
  style.textContent = `@page { size: A4 ${orientacao === 'paisagem' ? 'landscape' : 'portrait'}; margin: 12mm 10mm; }`;
  document.getElementById('asklab-print-page')?.remove();
  document.head.appendChild(style);
  const limpar = () => {
    style.remove();
    window.removeEventListener('afterprint', limpar);
  };
  window.addEventListener('afterprint', limpar);
  // dá um frame para o navegador aplicar o estilo antes de abrir a caixa de impressão
  requestAnimationFrame(() => window.print());
}
