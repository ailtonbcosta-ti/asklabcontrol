import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const defaultFrom = fmtDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
const defaultTo = fmtDate(new Date());

const GROUP_LABEL: Record<string, string> = {
  day: 'Por dia', week: 'Por semana', month: 'Por mês',
  lab: 'Por laboratório', procedure: 'Por procedimento',
};

const TAB_LABEL: Record<string, string> = {
  issued: 'Emissões', balance: 'Saldos', pending: 'Pendências',
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function ReportsHome() {
  const [tab, setTab] = useState<'issued' | 'balance' | 'pending'>('issued');
  const [groupBy, setGroupBy] = useState('day');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data) });

  const issued = useQuery({
    queryKey: ['rep-issued', groupBy, from, to],
    queryFn: () => api.get('/reports/issued', { params: { groupBy, from, to } }).then((r) => r.data),
    enabled: tab === 'issued',
  });
  const balance = useQuery({
    queryKey: ['rep-balance'],
    queryFn: () => api.get('/reports/balance').then((r) => r.data),
    enabled: tab === 'balance',
  });
  const pending = useQuery({
    queryKey: ['rep-pending'],
    queryFn: () => api.get('/reports/pending').then((r) => r.data),
    enabled: tab === 'pending',
  });

  // ── Gerador de HTML para impressão ─────────────────────────────────────────
  function buildPrintHtml(): string {
    const cfg = config.data ?? {};
    const logoUrl = cfg.logoA4Url || cfg.logoUrl
      ? `${window.location.origin}${cfg.logoA4Url || cfg.logoUrl}`
      : '';
    const orgName = esc(cfg.razaoSocial || 'ASKLabControl');
    const metaLines = [
      cfg.cnpj && `CNPJ: ${cfg.cnpj}`,
      cfg.endereco && cfg.cidade ? `${cfg.endereco} — ${cfg.cidade}${cfg.uf ? `/${cfg.uf}` : ''}` : null,
      cfg.telefone && `Tel: ${cfg.telefone}`,
    ].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');

    const cabecalho = cfg.cabecalhoImpressao
      ? `<div class="cabecalho">${esc(cfg.cabecalhoImpressao)}</div>` : '';
    const rodape = esc(cfg.rodapeImpressao || '');

    let tableHtml = '';

    if (tab === 'issued' && groupBy === 'procedure') {
      const rows = (issued.data ?? []).map((r: any) => `
        <tr>
          <td class="mono">${esc(r.codigo)}</td>
          <td>${esc(new Date(r.emitida_em).toLocaleDateString('pt-BR'))}</td>
          <td>${esc(r.laboratorio)}</td>
          <td>${esc(r.paciente)}</td>
          <td class="mono">${esc(r.proc_codigo)}</td>
          <td>${esc(r.proc_descricao)}</td>
          <td class="right">${esc(r.qtd)}</td>
        </tr>`).join('');
      tableHtml = `<table>
        <thead><tr>
          <th>Autorização</th><th>Data</th><th>Laboratório</th><th>Paciente</th>
          <th>Cód.</th><th>Procedimento</th><th class="right">Qtd</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">Nenhuma emissão no período.</td></tr>'}</tbody>
      </table>`;

    } else if (tab === 'issued') {
      const hasBucket = groupBy !== 'lab';
      const rows = (issued.data ?? []).map((r: any) => `
        <tr>
          ${hasBucket ? `<td class="mono">${esc(r.bucket || '—')}</td>` : ''}
          <td>${esc(r.laboratorio)}</td>
          <td class="right">${esc(r.total)}</td>
        </tr>`).join('');
      tableHtml = `<table>
        <thead><tr>
          ${hasBucket ? '<th>Período</th>' : ''}
          <th>Laboratório</th><th class="right">Total emitido</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="${hasBucket ? 3 : 2}" class="empty">Nenhuma emissão no período.</td></tr>`}</tbody>
      </table>`;

    } else if (tab === 'balance') {
      const rows = (balance.data ?? []).map((b: any) => `
        <tr>
          <td>${esc(b.laboratorio)}</td>
          <td class="mono">${esc(b.procedureCodigo)}</td>
          <td>${esc(b.procedureDescricao)}</td>
          <td class="right">${esc(b.qtdMensal)}</td>
          <td class="right">${esc(b.qtdConsumida)}</td>
          <td class="right ${b.saldo <= 0 ? 'red' : 'green'}">${esc(b.saldo)}</td>
        </tr>`).join('');
      tableHtml = `<table>
        <thead><tr>
          <th>Laboratório</th><th>Código</th><th>Procedimento</th>
          <th class="right">Cota</th><th class="right">Consumido</th><th class="right">Saldo</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">Nenhum contrato ativo.</td></tr>'}</tbody>
      </table>`;

    } else if (tab === 'pending') {
      const rows = (pending.data ?? []).map((p: any) => `
        <tr>
          <td>${esc(p.patient.nome)}</td>
          <td>${esc(p.procedure.descricao)}</td>
          <td class="right">${esc(p.qtd)}</td>
          <td>${p.motivo === 'SEM_SALDO' ? 'Sem saldo' : 'Sem contrato'}</td>
          <td>${esc(new Date(p.createdAt).toLocaleString('pt-BR'))}</td>
        </tr>`).join('');
      tableHtml = `<table>
        <thead><tr>
          <th>Paciente</th><th>Procedimento</th><th class="right">Qtd</th>
          <th>Motivo</th><th>Registrado em</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">Nenhuma pendência.</td></tr>'}</tbody>
      </table>`;
    }

    const subtitle = tab === 'issued'
      ? `${TAB_LABEL[tab]} — ${GROUP_LABEL[groupBy] || groupBy}`
      : TAB_LABEL[tab];

    const periodMeta = tab === 'issued'
      ? `<span>Período: ${esc(from)} a ${esc(to)}</span>` : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Relatório — ${esc(subtitle)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #111; background: #fff; padding: 0; }

    /* ── Cabeçalho ─────────────────────────────────── */
    .header {
      display: flex; align-items: center; gap: 14px;
      padding-bottom: 10px; margin-bottom: 12px;
      border-bottom: 2px solid #1a1a1a;
    }
    .header img { max-height: 60px; max-width: 150px; object-fit: contain; flex-shrink: 0; }
    .header-text h1 { font-size: 13pt; font-weight: bold; line-height: 1.2; }
    .header-text p  { font-size: 8.5pt; color: #555; margin-top: 3px; }

    /* ── Cabeçalho livre (config) ───────────────────── */
    .cabecalho { font-size: 9pt; color: #555; margin-bottom: 10px; white-space: pre-line; }

    /* ── Título do relatório ────────────────────────── */
    .report-title { margin-bottom: 10px; }
    .report-title h2 { font-size: 12pt; font-weight: bold; }
    .report-meta { font-size: 8.5pt; color: #666; margin-top: 4px; display: flex; gap: 14px; }

    /* ── Tabela ─────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    thead tr { background: #1a1a1a; color: #fff; }
    th { padding: 6px 8px; text-align: left; font-size: 9pt; font-weight: 600; border: 1px solid #1a1a1a; white-space: nowrap; }
    td { padding: 5px 8px; font-size: 9.5pt; border: 1px solid #ddd; vertical-align: top; }
    tbody tr:nth-child(even) td { background: #f4f4f4; }
    tbody tr:hover td { background: #eaf0fb; }

    .right { text-align: right; }
    .mono  { font-family: 'Courier New', Courier, monospace; font-size: 8.5pt; }
    .red   { color: #b00020; font-weight: bold; }
    .green { color: #166534; font-weight: bold; }
    .empty { text-align: center; color: #888; padding: 12px; font-style: italic; }

    /* ── Rodapé ─────────────────────────────────────── */
    .footer {
      margin-top: 18px; padding-top: 8px; border-top: 1px solid #ccc;
      font-size: 8pt; color: #888;
      display: flex; justify-content: space-between;
    }

    /* ── Impressão ──────────────────────────────────── */
    @media print {
      @page { size: A4; margin: 14mm 12mm; }
      body  { font-size: 10pt; }
      thead { display: table-header-group; }
      tbody tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="Logo" onload="this.style.opacity=1" onerror="this.remove()" style="opacity:0;transition:opacity .2s" />` : ''}
    <div class="header-text">
      <h1>${orgName}</h1>
      ${metaLines ? `<p>${metaLines}</p>` : ''}
    </div>
  </div>

  ${cabecalho}

  <div class="report-title">
    <h2>Relatório de ${esc(subtitle)}</h2>
    <div class="report-meta">
      ${periodMeta}
      <span>Emitido em: ${esc(new Date().toLocaleString('pt-BR'))}</span>
    </div>
  </div>

  ${tableHtml}

  <div class="footer">
    <span>${rodape}</span>
    <span>ASKLabControl</span>
  </div>
</body>
</html>`;
  }

  function handlePrint() {
    const activeData = tab === 'issued' ? issued.data : tab === 'balance' ? balance.data : pending.data;
    if (!activeData) {
      toast.error('Aguarde os dados carregarem antes de imprimir.');
      return;
    }
    const win = window.open('', '_blank', 'width=860,height=700,scrollbars=yes');
    if (!win) {
      toast.error('Pop-up bloqueado. Permita pop-ups para este site e tente novamente.');
      return;
    }
    const html = buildPrintHtml();
    win.document.open();
    win.document.write(html);
    win.document.close();
    // aguarda imagens carregarem antes de abrir diálogo de impressão
    win.addEventListener('load', () => { win.focus(); win.print(); });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Relatórios</h1>
        <button
          className="btn-outline inline-flex items-center gap-1"
          onClick={handlePrint}
        >
          <Printer size={14} /> Imprimir
        </button>
      </div>

      <div className="flex gap-2">
        <button className={tab === 'issued'  ? 'btn-primary' : 'btn-outline'} onClick={() => setTab('issued')}>Emissões</button>
        <button className={tab === 'balance' ? 'btn-primary' : 'btn-outline'} onClick={() => setTab('balance')}>Saldos</button>
        <button className={tab === 'pending' ? 'btn-primary' : 'btn-outline'} onClick={() => setTab('pending')}>Pendências</button>
      </div>

      {/* ── Emissões ──────────────────────────────────────────────────────── */}
      {tab === 'issued' && (
        <div className="card">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="label">Agrupar por</label>
              <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="day">Por dia</option>
                <option value="week">Por semana</option>
                <option value="month">Por mês</option>
                <option value="lab">Por laboratório (totais)</option>
                <option value="procedure">Por procedimento</option>
              </select>
            </div>
            <div>
              <label className="label">De</label>
              <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">Até</label>
              <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          {issued.isLoading && <p className="text-sm text-slate-500">Carregando...</p>}
          {issued.isError  && <p className="text-sm text-red-500">Erro ao carregar dados.</p>}

          {!issued.isLoading && !issued.isError && groupBy === 'procedure' && (
            <table className="table">
              <thead><tr>
                <th>Autorização</th><th>Data</th><th>Laboratório</th><th>Paciente</th>
                <th>Cód. Proc.</th><th>Procedimento</th><th className="text-right">Qtd</th>
              </tr></thead>
              <tbody>
                {issued.data?.length === 0 && <tr><td colSpan={7} className="text-center text-slate-500 py-4">Nenhuma emissão no período.</td></tr>}
                {issued.data?.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">{r.codigo}</td>
                    <td className="text-xs whitespace-nowrap">{new Date(r.emitida_em).toLocaleDateString('pt-BR')}</td>
                    <td>{r.laboratorio}</td>
                    <td>{r.paciente}</td>
                    <td className="font-mono text-xs">{r.proc_codigo}</td>
                    <td>{r.proc_descricao}</td>
                    <td className="text-right">{r.qtd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!issued.isLoading && !issued.isError && groupBy !== 'procedure' && (
            <table className="table">
              <thead><tr>
                {groupBy !== 'lab' && <th>Período</th>}
                <th>Laboratório</th><th className="text-right">Total emitido</th>
              </tr></thead>
              <tbody>
                {issued.data?.length === 0 && <tr><td colSpan={3} className="text-center text-slate-500 py-4">Nenhuma emissão no período.</td></tr>}
                {issued.data?.map((r: any, i: number) => (
                  <tr key={i}>
                    {groupBy !== 'lab' && <td className="font-mono text-xs">{r.bucket || '—'}</td>}
                    <td>{r.laboratorio}</td>
                    <td className="text-right">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Saldos ────────────────────────────────────────────────────────── */}
      {tab === 'balance' && (
        <div className="card">
          {balance.isLoading && <p className="text-sm text-slate-500">Carregando...</p>}
          <table className="table">
            <thead><tr>
              <th>Laboratório</th><th>Código</th><th>Procedimento</th>
              <th className="text-right">Cota</th><th className="text-right">Consumido</th><th className="text-right">Saldo</th>
            </tr></thead>
            <tbody>
              {balance.data?.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500 py-4">Nenhum contrato ativo.</td></tr>}
              {balance.data?.map((b: any, i: number) => (
                <tr key={i}>
                  <td>{b.laboratorio}</td>
                  <td className="font-mono text-xs">{b.procedureCodigo}</td>
                  <td>{b.procedureDescricao}</td>
                  <td className="text-right">{b.qtdMensal}</td>
                  <td className="text-right">{b.qtdConsumida}</td>
                  <td className={`text-right font-semibold ${b.saldo <= 0 ? 'text-red-600' : 'text-green-700'}`}>{b.saldo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pendências ────────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <div className="card">
          {pending.isLoading && <p className="text-sm text-slate-500">Carregando...</p>}
          <table className="table">
            <thead><tr>
              <th>Paciente</th><th>Procedimento</th><th className="text-right">Qtd</th>
              <th>Motivo</th><th>Registrado em</th>
            </tr></thead>
            <tbody>
              {pending.data?.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-4">Nenhuma pendência.</td></tr>}
              {pending.data?.map((p: any) => (
                <tr key={p.id}>
                  <td>{p.patient.nome}</td>
                  <td>{p.procedure.descricao}</td>
                  <td className="text-right">{p.qtd}</td>
                  <td>{p.motivo === 'SEM_SALDO' ? 'Sem saldo' : 'Sem contrato'}</td>
                  <td className="text-xs">{new Date(p.createdAt).toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
