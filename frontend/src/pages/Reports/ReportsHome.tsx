import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const defaultFrom = fmtDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
const defaultTo = fmtDate(new Date());

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ── Autocomplete de procedimentos ─────────────────────────────────────────────
function ProcedureSearch({
  value, label, onChange,
}: {
  value: number | null;
  label: string;
  onChange: (id: number | null, label: string) => void;
}) {
  const [q, setQ] = useState(label);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [results, setResults] = useState<any[]>([]);

  function search(text: string) {
    setQ(text);
    if (!text.trim()) { setResults([]); onChange(null, ''); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await api.get('/procedures', { params: { q: text, ativo: 1 } });
      setResults(r.data);
      setOpen(true);
    }, 250);
  }

  return (
    <div className="relative">
      <input
        className="input w-72"
        placeholder="Código ou nome do procedimento..."
        value={q}
        onChange={(e) => search(e.target.value)}
        onFocus={() => { if (q && results.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {value && (
        <button
          className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 text-xs"
          onMouseDown={() => { setQ(''); setResults([]); onChange(null, ''); }}
        >✕</button>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-50 bg-white border border-slate-200 shadow-lg rounded-md w-full max-h-52 overflow-y-auto mt-0.5">
          {results.map((p: any) => (
            <button
              key={p.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
              onMouseDown={() => {
                const lbl = `${p.codigo} — ${p.descricao}`;
                setQ(lbl); onChange(p.id, lbl); setOpen(false);
              }}
            >
              <span className="font-mono text-xs text-slate-400 mr-2">{p.codigo}</span>
              {p.descricao}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Barra CSS simples ─────────────────────────────────────────────────────────
function HBar({ value, max, color = 'bg-brand' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
        <div className={`h-4 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium w-8 text-right">{value}</span>
    </div>
  );
}

// Barra de saldo colorida (consumido vs cota)
function BalanceBar({ consumed, quota }: { consumed: number; quota: number }) {
  const pct = quota > 0 ? (consumed / quota) * 100 : 0;
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-green-500';
  return (
    <div className="w-full bg-slate-100 rounded h-1.5 mt-0.5">
      <div className={`h-1.5 rounded transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardTab({ labs }: { labs: any[] }) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [labId, setLabId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['rep-dashboard', from, to, labId],
    queryFn: () => api.get('/reports/dashboard', { params: { from, to, laboratoryId: labId || undefined } }).then((r) => r.data),
  });

  const maxLab = Math.max(1, ...(data?.authsByLab ?? []).map((r: any) => r.total));
  const maxProc = Math.max(1, ...(data?.topProcedures ?? []).map((r: any) => r.total_qtd));

  const dayData: { dia: string; total: number }[] = data?.authsByDay ?? [];
  const maxDay = Math.max(1, ...dayData.map((d) => d.total));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">De</label>
          <input type="date" className="input w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Até</label>
          <input type="date" className="input w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label">Laboratório</label>
          <select className="input w-52" value={labId} onChange={(e) => setLabId(e.target.value)}>
            <option value="">Todos</option>
            {labs.map((l: any) => <option key={l.id} value={l.id}>{l.razaoSocial}</option>)}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Carregando...</p>}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card text-center">
              <div className="text-3xl font-bold text-brand">{data.totalAuths}</div>
              <div className="text-xs text-slate-500 mt-1">Autorizações emitidas</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-slate-700">{data.authsByLab?.length ?? 0}</div>
              <div className="text-xs text-slate-500 mt-1">Laboratórios ativos</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-slate-700">{data.topProcedures?.length ?? 0}</div>
              <div className="text-xs text-slate-500 mt-1">Procedimentos distintos</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-slate-700">
                {data.topProcedures?.reduce((s: number, p: any) => s + (p.total_qtd ?? 0), 0) ?? 0}
              </div>
              <div className="text-xs text-slate-500 mt-1">Total de exames</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Balanceamento por laboratório */}
            <div className="card">
              <h2 className="font-semibold text-sm mb-3">Balanceamento entre laboratórios</h2>
              {data.authsByLab?.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhuma emissão no período.</p>
              ) : (
                <div className="space-y-2">
                  {data.authsByLab?.map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-36 text-xs text-slate-600 truncate" title={r.laboratorio}>{r.laboratorio}</div>
                      <div className="flex-1">
                        <HBar value={r.total} max={maxLab} color="bg-brand" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ranking de procedimentos */}
            <div className="card">
              <h2 className="font-semibold text-sm mb-3">Ranking de procedimentos</h2>
              {data.topProcedures?.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum procedimento no período.</p>
              ) : (
                <div className="space-y-2">
                  {data.topProcedures?.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-4 text-xs text-slate-400 text-right">{i + 1}</div>
                      <div className="w-28 text-xs text-slate-600 truncate" title={p.descricao}>{p.descricao}</div>
                      <div className="flex-1">
                        <HBar value={p.total_qtd} max={maxProc} color="bg-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Autorizações por dia */}
          <div className="card">
            <h2 className="font-semibold text-sm mb-3">Autorizações por dia</h2>
            {dayData.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma emissão no período.</p>
            ) : (
              <div className="flex items-end gap-px overflow-x-auto pb-2" style={{ minHeight: 80 }}>
                {dayData.map((d, i) => {
                  const h = Math.max(4, (d.total / maxDay) * 72);
                  return (
                    <div key={i} className="flex flex-col items-center group flex-1 min-w-[14px]">
                      <div className="relative w-full">
                        <div
                          className="bg-brand/70 hover:bg-brand rounded-t transition-all cursor-default"
                          style={{ height: h }}
                          title={`${d.dia}: ${d.total}`}
                        />
                      </div>
                      {dayData.length <= 14 && (
                        <div className="text-[9px] text-slate-400 mt-0.5 rotate-0 truncate w-full text-center">
                          {d.dia.slice(8)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Saldos — Matriz procedimentos × laboratórios ───────────────────────────────
function BalanceTab({ labs }: { labs: any[] }) {
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [labId, setLabId] = useState('');
  const [procLabel, setProcLabel] = useState('');
  const [procId, setProcId] = useState<number | null>(null);

  const { data: raw, isLoading } = useQuery({
    queryKey: ['rep-balance', ano, mes, labId, procId],
    queryFn: () =>
      api.get('/reports/balance', {
        params: { ano, mes, laboratoryId: labId || undefined, procedureId: procId || undefined },
      }).then((r) => r.data),
  });

  // Pivot: { [procedureKey]: { descricao, codigo, labs: { [labId]: row } } }
  type LabCell = { qtdMensal: number; qtdConsumida: number; saldo: number };
  type ProcRow = { codigo: string; descricao: string; labs: Record<number, LabCell> };

  const labSet: Map<number, string> = new Map();
  const procMap: Map<string, ProcRow> = new Map();

  for (const row of (raw ?? [])) {
    labSet.set(row.laboratoryId, row.laboratorio);
    const key = `${row.procedureId}`;
    if (!procMap.has(key)) {
      procMap.set(key, { codigo: row.procedureCodigo, descricao: row.procedureDescricao, labs: {} });
    }
    procMap.get(key)!.labs[row.laboratoryId] = {
      qtdMensal: row.qtdMensal,
      qtdConsumida: row.qtdConsumida,
      saldo: row.saldo,
    };
  }

  const labCols = Array.from(labSet.entries()); // [[id, nome]]
  const procRows = Array.from(procMap.values());

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Mês</label>
          <select className="input w-36" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Ano</label>
          <select className="input w-28" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Laboratório</label>
          <select className="input w-52" value={labId} onChange={(e) => setLabId(e.target.value)}>
            <option value="">Todos</option>
            {labs.map((l: any) => <option key={l.id} value={l.id}>{l.razaoSocial}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Procedimento</label>
          <ProcedureSearch value={procId} label={procLabel} onChange={(id, lbl) => { setProcId(id); setProcLabel(lbl); }} />
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Carregando...</p>}

      {!isLoading && raw?.length === 0 && (
        <div className="card text-sm text-slate-400 text-center py-6">Nenhum contrato ativo para o período.</div>
      )}

      {!isLoading && procRows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="text-xs bg-slate-50 sticky left-0 z-10 min-w-[200px]">Procedimento</th>
                {labCols.map(([id, nome]) => (
                  <th key={id} className="text-xs text-center min-w-[130px]">{nome}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {procRows.map((proc, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-slate-50/60'}>
                  <td className="text-xs sticky left-0 bg-white border-r border-slate-100">
                    <div className="font-medium truncate max-w-[190px]" title={proc.descricao}>{proc.descricao}</div>
                    <div className="font-mono text-[10px] text-slate-400">{proc.codigo}</div>
                  </td>
                  {labCols.map(([labId]) => {
                    const cell = proc.labs[labId];
                    if (!cell) return (
                      <td key={labId} className="text-center">
                        <span className="text-[10px] text-slate-300">—</span>
                      </td>
                    );
                    const pct = cell.qtdMensal > 0 ? (cell.qtdConsumida / cell.qtdMensal) * 100 : 0;
                    const saldoColor = cell.saldo <= 0
                      ? 'text-red-600 font-semibold'
                      : pct >= 70 ? 'text-amber-600 font-semibold' : 'text-green-700 font-semibold';
                    return (
                      <td key={labId} className="py-1.5 px-2">
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span title="Cota">{cell.qtdMensal}</span>
                          <span title="Consumido">{cell.qtdConsumida}</span>
                          <span className={saldoColor} title="Saldo">{cell.saldo}</span>
                        </div>
                        <BalanceBar consumed={cell.qtdConsumida} quota={cell.qtdMensal} />
                        <div className="text-[9px] text-slate-300 flex justify-between mt-0.5">
                          <span>cota</span><span>cons.</span><span>saldo</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-green-500" /> {'<'} 70% consumido</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-amber-400" /> 70–90% consumido</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded bg-red-500" /> ≥ 90% consumido</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Principal ─────────────────────────────────────────────────────────────────
const GROUP_LABEL: Record<string, string> = {
  day: 'Por dia', week: 'Por semana', month: 'Por mês',
  lab: 'Por laboratório', procedure: 'Por procedimento',
};

export function ReportsHome() {
  const [tab, setTab] = useState<'dashboard' | 'issued' | 'balance' | 'pending'>('dashboard');
  const [groupBy, setGroupBy] = useState('day');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [issuedLabId, setIssuedLabId] = useState('');
  const [issuedProcId, setIssuedProcId] = useState<number | null>(null);
  const [issuedProcLabel, setIssuedProcLabel] = useState('');

  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data) });

  const labs = useQuery({
    queryKey: ['labs-active'],
    queryFn: () => api.get('/laboratories').then((r) => r.data.filter((l: any) => l.ativo !== false)),
  });

  const issued = useQuery({
    queryKey: ['rep-issued', groupBy, from, to, issuedLabId, issuedProcId],
    queryFn: () =>
      api.get('/reports/issued', {
        params: { groupBy, from, to, laboratoryId: issuedLabId || undefined, procedureId: issuedProcId || undefined },
      }).then((r) => r.data),
    enabled: tab === 'issued',
  });

  const pending = useQuery({
    queryKey: ['rep-pending'],
    queryFn: () => api.get('/reports/pending').then((r) => r.data),
    enabled: tab === 'pending',
  });

  // ── Print ──────────────────────────────────────────────────────────────────
  function buildPrintHtml(): string {
    const cfg = config.data ?? {};
    const logoUrl = cfg.logoA4Url || cfg.logoUrl
      ? `${window.location.origin}${cfg.logoA4Url || cfg.logoUrl}` : '';
    const orgName = esc(cfg.razaoSocial || 'ASKLabControl');
    const metaLines = [
      cfg.cnpj && `CNPJ: ${cfg.cnpj}`,
      cfg.endereco && cfg.cidade ? `${cfg.endereco} — ${cfg.cidade}${cfg.uf ? `/${cfg.uf}` : ''}` : null,
      cfg.telefone && `Tel: ${cfg.telefone}`,
    ].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');

    let tableHtml = '';
    let subtitle = '';

    if (tab === 'issued' && groupBy === 'procedure') {
      subtitle = `Emissões — ${GROUP_LABEL[groupBy]}`;
      const rows = (issued.data ?? []).map((r: any) => `
        <tr><td class="mono">${esc(r.codigo)}</td>
          <td>${esc(new Date(r.emitida_em).toLocaleDateString('pt-BR'))}</td>
          <td>${esc(r.laboratorio)}</td><td>${esc(r.paciente)}</td>
          <td class="mono">${esc(r.proc_codigo)}</td><td>${esc(r.proc_descricao)}</td>
          <td class="right">${esc(r.qtd)}</td></tr>`).join('');
      tableHtml = `<table><thead><tr>
        <th>Autorização</th><th>Data</th><th>Laboratório</th><th>Paciente</th>
        <th>Cód.</th><th>Procedimento</th><th class="right">Qtd</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">Nenhuma emissão.</td></tr>'}</tbody></table>`;
    } else if (tab === 'issued') {
      subtitle = `Emissões — ${GROUP_LABEL[groupBy]}`;
      const hasBucket = groupBy !== 'lab';
      const rows = (issued.data ?? []).map((r: any) => `
        <tr>${hasBucket ? `<td class="mono">${esc(r.bucket || '—')}</td>` : ''}
          <td>${esc(r.laboratorio)}</td><td class="right">${esc(r.total)}</td></tr>`).join('');
      tableHtml = `<table><thead><tr>
        ${hasBucket ? '<th>Período</th>' : ''}<th>Laboratório</th><th class="right">Total</th>
        </tr></thead><tbody>${rows || `<tr><td colspan="${hasBucket ? 3 : 2}" class="empty">Nenhuma emissão.</td></tr>`}</tbody></table>`;
    } else if (tab === 'pending') {
      subtitle = 'Pendências';
      const rows = (pending.data ?? []).map((p: any) => `
        <tr><td>${esc(p.patient.nome)}</td><td>${esc(p.procedure.descricao)}</td>
          <td class="right">${esc(p.qtd)}</td>
          <td>${p.motivo === 'SEM_SALDO' ? 'Sem saldo' : 'Sem contrato'}</td>
          <td>${esc(new Date(p.createdAt).toLocaleString('pt-BR'))}</td></tr>`).join('');
      tableHtml = `<table><thead><tr>
        <th>Paciente</th><th>Procedimento</th><th class="right">Qtd</th>
        <th>Motivo</th><th>Registrado em</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">Nenhuma pendência.</td></tr>'}</tbody></table>`;
    } else {
      subtitle = 'Dashboard';
      tableHtml = '<p style="color:#888;font-style:italic">Use a visualização em tela para o Dashboard. Para imprimir saldos, acesse a aba Saldos.</p>';
    }

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório — ${esc(subtitle)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #111; background: #fff; padding: 0; }
.header { display:flex; align-items:center; gap:14px; padding-bottom:10px; margin-bottom:12px; border-bottom:2px solid #1a1a1a; }
.header img { max-height:60px; max-width:150px; object-fit:contain; flex-shrink:0; }
.header-text h1 { font-size:13pt; font-weight:bold; line-height:1.2; }
.header-text p { font-size:8.5pt; color:#555; margin-top:3px; }
.report-title { margin-bottom:10px; }
.report-title h2 { font-size:12pt; font-weight:bold; }
.report-meta { font-size:8.5pt; color:#666; margin-top:4px; display:flex; gap:14px; }
table { width:100%; border-collapse:collapse; margin-top:4px; }
thead tr { background:#1a1a1a; color:#fff; }
th { padding:6px 8px; text-align:left; font-size:9pt; font-weight:600; border:1px solid #1a1a1a; white-space:nowrap; }
td { padding:5px 8px; font-size:9.5pt; border:1px solid #ddd; vertical-align:top; }
tbody tr:nth-child(even) td { background:#f4f4f4; }
.right { text-align:right; } .mono { font-family:'Courier New',monospace; font-size:8.5pt; }
.red { color:#b00020; font-weight:bold; } .green { color:#166534; font-weight:bold; }
.empty { text-align:center; color:#888; padding:12px; font-style:italic; }
.footer { margin-top:18px; padding-top:8px; border-top:1px solid #ccc; font-size:8pt; color:#888; display:flex; justify-content:space-between; }
@media print { @page { size:A4; margin:14mm 12mm; } body { font-size:10pt; } thead { display:table-header-group; } tbody tr { page-break-inside:avoid; } }
</style></head><body>
<div class="header">
${logoUrl ? `<img src="${logoUrl}" alt="Logo" onload="this.style.opacity=1" onerror="this.remove()" style="opacity:0;transition:opacity .2s"/>` : ''}
<div class="header-text"><h1>${orgName}</h1>${metaLines ? `<p>${metaLines}</p>` : ''}</div>
</div>
<div class="report-title">
<h2>Relatório de ${esc(subtitle)}</h2>
<div class="report-meta">
${tab === 'issued' ? `<span>Período: ${esc(from)} a ${esc(to)}</span>` : ''}
<span>Emitido em: ${esc(new Date().toLocaleString('pt-BR'))}</span>
</div></div>
${tableHtml}
<div class="footer"><span>${esc(cfg.rodapeImpressao || '')}</span><span>ASKLabControl</span></div>
</body></html>`;
  }

  function handlePrint() {
    const active = tab === 'issued' ? issued.data : tab === 'pending' ? pending.data : true;
    if (!active) { toast.error('Aguarde os dados carregarem antes de imprimir.'); return; }
    const win = window.open('', '_blank', 'width=860,height=700,scrollbars=yes');
    if (!win) { toast.error('Pop-up bloqueado. Permita pop-ups e tente novamente.'); return; }
    win.document.open();
    win.document.write(buildPrintHtml());
    win.document.close();
    win.addEventListener('load', () => { win.focus(); win.print(); });
  }

  const tabCls = (t: string) => tab === t ? 'btn-primary' : 'btn-outline';

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Relatórios</h1>
        {tab !== 'dashboard' && tab !== 'balance' && (
          <button className="btn-outline inline-flex items-center gap-1" onClick={handlePrint}>
            <Printer size={14} /> Imprimir
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className={tabCls('dashboard')} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={tabCls('issued')} onClick={() => setTab('issued')}>Emissões</button>
        <button className={tabCls('balance')} onClick={() => setTab('balance')}>Saldos</button>
        <button className={tabCls('pending')} onClick={() => setTab('pending')}>Pendências</button>
      </div>

      {/* ── Dashboard ────────────────────────────────────────────────────── */}
      {tab === 'dashboard' && <DashboardTab labs={labs.data ?? []} />}

      {/* ── Emissões ─────────────────────────────────────────────────────── */}
      {tab === 'issued' && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Agrupar por</label>
              <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="day">Por dia</option>
                <option value="week">Por semana</option>
                <option value="month">Por mês</option>
                <option value="lab">Por laboratório</option>
                <option value="procedure">Por procedimento</option>
              </select>
            </div>
            <div>
              <label className="label">De</label>
              <input type="date" className="input w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">Até</label>
              <input type="date" className="input w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <label className="label">Laboratório</label>
              <select className="input w-48" value={issuedLabId} onChange={(e) => setIssuedLabId(e.target.value)}>
                <option value="">Todos</option>
                {(labs.data ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.razaoSocial}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Procedimento</label>
              <ProcedureSearch
                value={issuedProcId} label={issuedProcLabel}
                onChange={(id, lbl) => { setIssuedProcId(id); setIssuedProcLabel(lbl); }}
              />
            </div>
          </div>

          {issued.isLoading && <p className="text-sm text-slate-500">Carregando...</p>}
          {issued.isError && <p className="text-sm text-red-500">Erro ao carregar dados.</p>}

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

      {/* ── Saldos ───────────────────────────────────────────────────────── */}
      {tab === 'balance' && <BalanceTab labs={labs.data ?? []} />}

      {/* ── Pendências ───────────────────────────────────────────────────── */}
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
