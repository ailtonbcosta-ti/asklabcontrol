import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Plus, Trash2, PencilLine, AlertTriangle, FlaskConical, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { maskCnpj, onlyDigits } from '../../lib/cnpj';

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (d: Date | string) => {
  const iso = typeof d === 'string' ? d : d.toISOString();
  const [y, m, day] = iso.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};
const fmtMoney = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ─── types ────────────────────────────────────────────────────────────────────
interface ContractItem { id?: number; nome: string; qtdLicitada: number; valorLicitado: number; }
interface Contract {
  id: number; cnpj: string; empresa: string;
  vigenciaIni: string; vigenciaFim: string; ativo: boolean;
  items: (ContractItem & { id: number })[];
}
interface ReportRow {
  contractId: number; cnpj: string; empresa: string; vigenciaFim: string;
  itemId: number; nome: string; qtdLicitada: number; valorLicitado: number;
  qtdConsumidaPeriodo: number; valorPeriodo: number;
  qtdTotalConsumida: number; saldoAtual: number; pctSaldo: number; alerta: boolean;
}

// ─── empty form helpers ───────────────────────────────────────────────────────
const emptyContract = (): Omit<Contract, 'id' | 'ativo' | 'items'> & { items: ContractItem[] } => ({
  cnpj: '', empresa: '', vigenciaIni: today(), vigenciaFim: today(), items: [],
});
const emptyItem = (): ContractItem => ({ nome: '', qtdLicitada: 0, valorLicitado: 0 });

// ─── alert banner ─────────────────────────────────────────────────────────────
function AlertBanner({ rows }: { rows: ReportRow[] }) {
  const alerts = rows.filter((r) => r.alerta);
  if (alerts.length === 0) return null;
  return (
    <div className="flex items-start gap-3 bg-red-50 border border-red-300 rounded-lg p-3 animate-pulse-once">
      <AlertTriangle size={20} className="text-red-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-red-700">
          {alerts.length} reagente{alerts.length > 1 ? 's' : ''} com saldo crítico (≤ 10%)
        </p>
        <ul className="mt-1 space-y-0.5">
          {alerts.map((r) => (
            <li key={r.itemId} className="text-xs text-red-600">
              <span className="font-medium">{r.nome}</span> — saldo: {fmtNum(r.saldoAtual)}{' '}
              ({r.pctSaldo.toFixed(1)}%) · CNPJ {maskCnpj(r.cnpj)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── stock bar ────────────────────────────────────────────────────────────────
function StockBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped <= 10 ? 'bg-red-500' : clamped <= 25 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className={`text-[10px] font-semibold tabular-nums w-9 text-right ${
        clamped <= 10 ? 'text-red-600' : clamped <= 25 ? 'text-amber-600' : 'text-emerald-700'
      }`}>{clamped.toFixed(0)}%</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Cadastro de Contratos
// ═══════════════════════════════════════════════════════════════════════════════
function CadastroContratos() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState(emptyContract());
  const [showForm, setShowForm] = useState(false);

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ['reagent-contracts'],
    queryFn: () => api.get('/reagents/contracts').then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form & { id?: number }) =>
      data.id
        ? api.put(`/reagents/contracts/${data.id}`, data).then((r) => r.data)
        : api.post('/reagents/contracts', data).then((r) => r.data),
    onSuccess: () => {
      toast.success(editing ? 'Contrato atualizado.' : 'Contrato cadastrado.');
      qc.invalidateQueries({ queryKey: ['reagent-contracts'] });
      setShowForm(false);
      setEditing(null);
      setForm(emptyContract());
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Falha ao salvar'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/reagents/contracts/${id}`),
    onSuccess: () => {
      toast.success('Contrato excluído.');
      qc.invalidateQueries({ queryKey: ['reagent-contracts'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Falha ao excluir'),
  });

  function openNew() {
    setEditing(null);
    setForm(emptyContract());
    setShowForm(true);
  }

  function openEdit(c: Contract) {
    setEditing(c);
    setForm({
      cnpj: maskCnpj(c.cnpj), empresa: c.empresa,
      vigenciaIni: c.vigenciaIni.slice(0, 10),
      vigenciaFim: c.vigenciaFim.slice(0, 10),
      items: c.items.map((i) => ({ ...i })),
    });
    setShowForm(true);
  }

  function addItemRow() {
    setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  }

  function removeItemRow(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function updateItemRow(idx: number, field: keyof ContractItem, value: string | number) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => i === idx ? { ...it, [field]: value } : it),
    }));
  }

  function handleSave() {
    if (onlyDigits(form.cnpj).length !== 14) return toast.error('CNPJ inválido — informe os 14 dígitos');
    if (!form.empresa.trim()) return toast.error('Preencha o nome da empresa');
    if (form.items.length === 0) return toast.error('Adicione ao menos um reagente');
    const invalid = form.items.find((i) => !i.nome.trim() || i.qtdLicitada <= 0 || i.valorLicitado <= 0);
    if (invalid) return toast.error('Preencha todos os campos dos reagentes');
    saveMutation.mutate({
      ...form,
      cnpj: onlyDigits(form.cnpj),
      ...(editing ? { id: editing.id } : {}),
    } as any);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-slate-700">Contratos cadastrados</h2>
        <button className="btn-primary" onClick={openNew}>
          <Plus size={14} className="mr-1" /> Novo Contrato
        </button>
      </div>

      {showForm && (
        <div className="card border-l-4 border-brand space-y-4">
          <h3 className="font-semibold text-sm text-slate-700">
            {editing ? `Editando contrato — ${maskCnpj(editing.cnpj)}` : 'Novo contrato'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">CNPJ da Empresa *</label>
              <input
                className="input"
                placeholder="xx.xxx.xxx/xxxx-xx"
                value={form.cnpj}
                maxLength={18}
                onChange={(e) => setForm({ ...form, cnpj: maskCnpj(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Nome da Empresa *</label>
              <input className="input" value={form.empresa}
                onChange={(e) => setForm({ ...form, empresa: e.target.value })} />
            </div>
            <div>
              <label className="label">Vigência — Data Inicial *</label>
              <input type="date" className="input" value={form.vigenciaIni}
                onChange={(e) => setForm({ ...form, vigenciaIni: e.target.value })} />
            </div>
            <div>
              <label className="label">Vigência — Data Final *</label>
              <input type="date" className="input" value={form.vigenciaFim}
                onChange={(e) => setForm({ ...form, vigenciaFim: e.target.value })} />
            </div>
          </div>

          {/* Tabela de reagentes */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Reagentes licitados</h4>
              <button className="btn-outline text-xs py-1 px-2" onClick={addItemRow}>
                <Plus size={12} className="mr-1" /> Adicionar reagente
              </button>
            </div>
            {form.items.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">Nenhum reagente adicionado ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nome do Reagente</th>
                      <th className="w-32">Qtd. Licitada</th>
                      <th className="w-36">Valor Licitado (R$)</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, idx) => (
                      <tr key={idx}>
                        <td>
                          <input className="input text-xs py-1" value={it.nome}
                            onChange={(e) => updateItemRow(idx, 'nome', e.target.value)}
                            placeholder="Nome do reagente" />
                        </td>
                        <td>
                          <input type="number" min={0} className="input text-xs py-1 w-full"
                            value={it.qtdLicitada}
                            onChange={(e) => updateItemRow(idx, 'qtdLicitada', Number(e.target.value))} />
                        </td>
                        <td>
                          <input type="number" min={0} step="0.01" className="input text-xs py-1 w-full"
                            value={it.valorLicitado}
                            onChange={(e) => updateItemRow(idx, 'valorLicitado', Number(e.target.value))} />
                        </td>
                        <td>
                          <button onClick={() => removeItemRow(idx)}
                            className="text-red-500 hover:text-red-700 p-1">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button className="btn-outline" onClick={() => { setShowForm(false); setEditing(null); }}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Salvando…' : 'Salvar Contrato'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : contracts.length === 0 ? (
        <div className="card text-center py-10 text-slate-400 text-sm">
          <FlaskConical size={32} className="mx-auto mb-2 opacity-30" />
          Nenhum contrato cadastrado. Clique em "Novo Contrato" para começar.
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => (
            <ContractCard
              key={c.id} contract={c}
              onEdit={() => openEdit(c)}
              onDelete={() => {
                if (!confirm(`Excluir contrato do CNPJ ${maskCnpj(c.cnpj)}? Esta ação é irreversível.`)) return;
                deleteMutation.mutate(c.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContractCard({ contract: c, onEdit, onDelete }: {
  contract: Contract; onEdit: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const expiring = new Date(c.vigenciaFim) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return (
    <div className="card">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">{maskCnpj(c.cnpj)}</span>
            {expiring && (
              <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded">
                Vence em breve
              </span>
            )}
          </div>
          <p className="font-semibold text-slate-800 mt-0.5">{c.empresa}</p>
          <p className="text-xs text-slate-500">
            Vigência: {fmtDate(c.vigenciaIni)} a {fmtDate(c.vigenciaFim)} · {c.items.length} reagente{c.items.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-500 hover:text-brand"
            onClick={onEdit} title="Editar">
            <PencilLine size={14} />
          </button>
          <button className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"
            onClick={onDelete} title="Excluir">
            <Trash2 size={14} />
          </button>
          <button className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-400"
            onClick={() => setOpen(!open)} title="Expandir reagentes">
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {open && c.items.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Reagente</th>
                <th className="text-right">Qtd. Licitada</th>
                <th className="text-right">Valor Unit.</th>
                <th className="text-right">Valor Total</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.nome}</td>
                  <td className="text-right tabular-nums">{fmtNum(it.qtdLicitada)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(it.valorLicitado)}</td>
                  <td className="text-right tabular-nums font-medium">
                    {fmtMoney(it.qtdLicitada * it.valorLicitado)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={3} className="text-right text-xs uppercase tracking-wide text-slate-500">
                  Total do Contrato
                </td>
                <td className="text-right tabular-nums text-brand">
                  {fmtMoney(c.items.reduce((s, i) => s + i.qtdLicitada * i.valorLicitado, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Registro de Consumo
// ═══════════════════════════════════════════════════════════════════════════════
function RegistroConsumo() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data) });

  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ['reagent-contracts'],
    queryFn: () => api.get('/reagents/contracts').then((r) => r.data),
  });

  const [selectedContractId, setSelectedContractId] = useState<number | ''>('');
  const [periodoIni, setPeriodoIni] = useState(today());
  const [periodoFim, setPeriodoFim] = useState(today());
  const [obs, setObs] = useState('');
  const [qtds, setQtds] = useState<Record<number, number>>({});

  const selectedContract = contracts.find((c) => c.id === selectedContractId);

  function handleContractChange(id: number | '') {
    setSelectedContractId(id);
    setQtds({});
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedContract) throw new Error('Selecione um contrato');
      const items = selectedContract.items.map((it) => ({
        itemId: it.id,
        qtdConsumida: qtds[it.id] ?? 0,
      }));
      return api.post('/reagents/consumptions', {
        contractId: selectedContract.id,
        periodoIni, periodoFim, observacoes: obs || null, items,
      });
    },
    onSuccess: () => {
      toast.success('Registro salvo com sucesso.');
      qc.invalidateQueries({ queryKey: ['reagent-consumptions'] });
      qc.invalidateQueries({ queryKey: ['reagent-report'] });
      setQtds({});
      setObs('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Falha ao salvar'),
  });

  function totalGeral() {
    if (!selectedContract) return 0;
    return selectedContract.items.reduce((s, it) => s + (qtds[it.id] ?? 0) * it.valorLicitado, 0);
  }

  function handlePrint() {
    if (!selectedContract) return toast.error('Selecione um contrato primeiro');
    const cfg = config.data ?? {};
    const logoSrc = cfg.logoA4Url || cfg.logoUrl
      ? `${window.location.origin}${cfg.logoA4Url || cfg.logoUrl}`
      : '';
    const orgName = esc(cfg.razaoSocial || 'ASKLabControl');
    const metaLines = [
      cfg.cnpj && `CNPJ: ${cfg.cnpj}`,
      cfg.cidade && `${cfg.cidade}${cfg.uf ? `/${cfg.uf}` : ''}`,
      cfg.telefone && `Tel: ${cfg.telefone}`,
    ].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');

    const rows = selectedContract.items.map((it) => {
      const qtd = qtds[it.id] ?? 0;
      const total = qtd * it.valorLicitado;
      return `<tr>
        <td>${esc(it.nome)}</td>
        <td class="num">${fmtNum(it.valorLicitado)}</td>
        <td class="num">${fmtNum(qtd)}</td>
        <td class="num">${fmtMoney(total)}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Consumo de Reagentes</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #1a1a1a; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 10px; }
  .logo { height: 48px; object-fit: contain; }
  .org { flex: 1; }
  .org-name { font-size: 13pt; font-weight: 700; }
  .org-meta { font-size: 7.5pt; color: #555; margin-top: 2px; }
  .title { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; text-align: center; margin: 8px 0 4px; }
  .subtitle { font-size: 8pt; color: #555; text-align: center; margin-bottom: 10px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-bottom: 10px; font-size: 8pt; }
  .meta-grid dt { color: #777; }
  .meta-grid dd { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 8px; }
  thead tr { background: #1a1a1a; color: #fff; }
  th { padding: 5px 6px; text-align: left; font-weight: 600; }
  th.num, td.num { text-align: right; }
  td { padding: 4px 6px; border-bottom: 1px solid #e5e5e5; }
  tr:nth-child(even) td { background: #f7f7f7; }
  .total-row td { font-weight: 700; background: #f0f0f0; border-top: 2px solid #1a1a1a; }
  .footer { margin-top: 14px; border-top: 1px solid #ddd; padding-top: 6px; font-size: 7pt; color: #888; display: flex; justify-content: space-between; }
</style></head><body>
<div class="header">
  ${logoSrc ? `<img src="${logoSrc}" class="logo" />` : ''}
  <div class="org">
    <div class="org-name">${orgName}</div>
    ${metaLines ? `<div class="org-meta">${metaLines}</div>` : ''}
  </div>
</div>
<div class="title">Registro de Consumo de Reagentes</div>
<div class="subtitle">Período: ${fmtDate(periodoIni)} a ${fmtDate(periodoFim)}</div>
<dl class="meta-grid">
  <dt>CNPJ</dt><dd>${esc(maskCnpj(selectedContract.cnpj))}</dd>
  <dt>Empresa</dt><dd>${esc(selectedContract.empresa)}</dd>
  <dt>Vigência</dt><dd>${fmtDate(selectedContract.vigenciaIni)} a ${fmtDate(selectedContract.vigenciaFim)}</dd>
  <dt>Emissão</dt><dd>${new Date().toLocaleString('pt-BR')}</dd>
</dl>
${obs ? `<p style="font-size:8pt;color:#555;margin-bottom:8px">Obs.: ${esc(obs)}</p>` : ''}
<table>
  <thead><tr>
    <th>Reagente</th><th class="num">Valor Licitado</th>
    <th class="num">Qtd. Consumida</th><th class="num">Total (R$)</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row">
    <td colspan="3" style="text-align:right">TOTAL GERAL</td>
    <td class="num">${fmtMoney(totalGeral())}</td>
  </tr></tfoot>
</table>
<div class="footer">
  <span>${cfg.rodapeImpressao ? esc(cfg.rodapeImpressao) : ''}</span>
  <span>ASKLabControl</span>
</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=860,height=700');
    if (!win) return toast.error('Popup bloqueado. Permita popups para este site.');
    win.document.write(html);
    win.document.close();
    win.addEventListener('load', () => win.print());
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-700">Registro de Consumo</h2>

      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="label">Contrato *</label>
            <select
              className="input"
              value={selectedContractId}
              onChange={(e) => handleContractChange(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Selecione um contrato…</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>{maskCnpj(c.cnpj)} — {c.empresa}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Período — Início *</label>
            <input type="date" className="input" value={periodoIni}
              onChange={(e) => setPeriodoIni(e.target.value)} />
          </div>
          <div>
            <label className="label">Período — Fim *</label>
            <input type="date" className="input" value={periodoFim}
              onChange={(e) => setPeriodoFim(e.target.value)} />
          </div>
        </div>

        {selectedContract && (
          <>
            <div className="mt-1">
              <p className="text-xs text-slate-500 mb-2">
                Contrato: <span className="font-medium text-slate-700">{selectedContract.empresa}</span>
                {' · '}Vigência: {fmtDate(selectedContract.vigenciaIni)} a {fmtDate(selectedContract.vigenciaFim)}
              </p>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reagente</th>
                      <th className="text-right w-32">Valor Licitado</th>
                      <th className="w-36">Qtd. Consumida</th>
                      <th className="text-right w-36">Total (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedContract.items.map((it) => {
                      const qtd = qtds[it.id] ?? 0;
                      return (
                        <tr key={it.id}>
                          <td className="text-sm">{it.nome}</td>
                          <td className="text-right tabular-nums text-sm">{fmtMoney(it.valorLicitado)}</td>
                          <td>
                            <input
                              type="number" min={0} step="0.01"
                              className="input text-sm py-1 w-full"
                              value={qtd}
                              onChange={(e) => setQtds({ ...qtds, [it.id]: Number(e.target.value) })}
                            />
                          </td>
                          <td className="text-right tabular-nums font-medium text-sm">
                            {fmtMoney(qtd * it.valorLicitado)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Total Geral
                      </td>
                      <td className="text-right tabular-nums font-bold text-brand">
                        {fmtMoney(totalGeral())}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div>
              <label className="label">Observações</label>
              <textarea className="input" rows={2} value={obs}
                onChange={(e) => setObs(e.target.value)} />
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                className="btn-primary"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Salvando…' : 'Salvar Registro'}
              </button>
              <button className="btn-outline inline-flex items-center gap-1" onClick={handlePrint}>
                <Printer size={14} /> Imprimir Consumo
              </button>
            </div>
          </>
        )}

        {!selectedContract && (
          <p className="text-sm text-slate-400 py-4 text-center">
            Selecione um contrato para registrar o consumo de reagentes.
          </p>
        )}
      </div>

      <ConsumptionHistory />
    </div>
  );
}

function ConsumptionHistory() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data) });

  const { data: list = [], isLoading } = useQuery<any[]>({
    queryKey: ['reagent-consumptions'],
    queryFn: () => api.get('/reagents/consumptions').then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/reagents/consumptions/${id}`),
    onSuccess: () => {
      toast.success('Registro excluído.');
      qc.invalidateQueries({ queryKey: ['reagent-consumptions'] });
      qc.invalidateQueries({ queryKey: ['reagent-report'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Falha'),
  });

  function printRecord(rec: any) {
    const cfg = config.data ?? {};
    const logoSrc = cfg.logoA4Url || cfg.logoUrl
      ? `${window.location.origin}${cfg.logoA4Url || cfg.logoUrl}`
      : '';
    const orgName = esc(cfg.razaoSocial || 'ASKLabControl');
    const metaLines = [
      cfg.cnpj && `CNPJ: ${cfg.cnpj}`,
      cfg.cidade && `${cfg.cidade}${cfg.uf ? `/${cfg.uf}` : ''}`,
      cfg.telefone && `Tel: ${cfg.telefone}`,
    ].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');

    const total = rec.items.reduce(
      (s: number, i: any) => s + i.qtdConsumida * i.item.valorLicitado, 0,
    );

    const rows = rec.items.map((i: any) => `<tr>
      <td>${esc(i.item.nome)}</td>
      <td class="num">${fmtMoney(i.item.valorLicitado)}</td>
      <td class="num">${fmtNum(i.qtdConsumida)}</td>
      <td class="num">${fmtMoney(i.qtdConsumida * i.item.valorLicitado)}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Consumo de Reagentes</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #1a1a1a; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 10px; }
  .logo { height: 48px; object-fit: contain; }
  .org-name { font-size: 13pt; font-weight: 700; }
  .org-meta { font-size: 7.5pt; color: #555; margin-top: 2px; }
  .title { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; text-align: center; margin: 8px 0 4px; }
  .subtitle { font-size: 8pt; color: #555; text-align: center; margin-bottom: 10px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-bottom: 10px; font-size: 8pt; }
  .meta-grid dt { color: #777; }
  .meta-grid dd { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 8px; }
  thead tr { background: #1a1a1a; color: #fff; }
  th { padding: 5px 6px; text-align: left; font-weight: 600; }
  th.num, td.num { text-align: right; }
  td { padding: 4px 6px; border-bottom: 1px solid #e5e5e5; }
  tr:nth-child(even) td { background: #f7f7f7; }
  .total-row td { font-weight: 700; background: #f0f0f0; border-top: 2px solid #1a1a1a; }
  .footer { margin-top: 14px; border-top: 1px solid #ddd; padding-top: 6px; font-size: 7pt; color: #888; display: flex; justify-content: space-between; }
</style></head><body>
<div class="header">
  ${logoSrc ? `<img src="${logoSrc}" class="logo" />` : ''}
  <div style="flex:1">
    <div class="org-name">${orgName}</div>
    ${metaLines ? `<div class="org-meta">${metaLines}</div>` : ''}
  </div>
</div>
<div class="title">Registro de Consumo de Reagentes</div>
<div class="subtitle">Período: ${fmtDate(rec.periodoIni)} a ${fmtDate(rec.periodoFim)}</div>
<dl class="meta-grid">
  <dt>CNPJ</dt><dd>${esc(maskCnpj(rec.contract.cnpj))}</dd>
  <dt>Empresa</dt><dd>${esc(rec.contract.empresa)}</dd>
  <dt>Vigência</dt><dd>${fmtDate(rec.contract.vigenciaIni)} a ${fmtDate(rec.contract.vigenciaFim)}</dd>
  <dt>Emissão</dt><dd>${new Date().toLocaleString('pt-BR')}</dd>
</dl>
${rec.observacoes ? `<p style="font-size:8pt;color:#555;margin-bottom:8px">Obs.: ${esc(rec.observacoes)}</p>` : ''}
<table>
  <thead><tr>
    <th>Reagente</th>
    <th class="num">Valor Licitado</th>
    <th class="num">Qtd. Consumida</th>
    <th class="num">Total (R$)</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row">
    <td colspan="3" style="text-align:right">TOTAL GERAL</td>
    <td class="num">${fmtMoney(total)}</td>
  </tr></tfoot>
</table>
<div class="footer">
  <span>${cfg.rodapeImpressao ? esc(cfg.rodapeImpressao) : ''}</span>
  <span>ASKLabControl</span>
</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=860,height=700');
    if (!win) return toast.error('Popup bloqueado. Permita popups para este site.');
    win.document.write(html);
    win.document.close();
    win.addEventListener('load', () => win.print());
  }

  // ── estado de edição ────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPeriodoIni, setEditPeriodoIni] = useState('');
  const [editPeriodoFim, setEditPeriodoFim] = useState('');
  const [editObs, setEditObs] = useState('');
  const [editQtds, setEditQtds] = useState<Record<number, number>>({});

  // contratos no cache (carregados pela aba de cadastro / consumo)
  const contracts = (qc.getQueryData<Contract[]>(['reagent-contracts'])) ?? [];

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) =>
      api.put(`/reagents/consumptions/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Registro atualizado.');
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['reagent-consumptions'] });
      qc.invalidateQueries({ queryKey: ['reagent-report'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Falha ao salvar'),
  });

  function openEdit(rec: any) {
    setEditingId(rec.id);
    setEditPeriodoIni(rec.periodoIni.slice(0, 10));
    setEditPeriodoFim(rec.periodoFim.slice(0, 10));
    setEditObs(rec.observacoes ?? '');
    // pré-popula com qtds salvas
    const qtdMap: Record<number, number> = {};
    rec.items.forEach((i: any) => { qtdMap[i.itemId] = i.qtdConsumida; });
    setEditQtds(qtdMap);
  }

  function handleUpdate(rec: any) {
    const contract = contracts.find((c) => c.id === rec.contractId);
    const allItems = contract?.items ?? rec.items.map((i: any) => i.item);
    const items = allItems.map((it: any) => ({
      itemId: it.id,
      qtdConsumida: editQtds[it.id] ?? 0,
    }));
    updateMutation.mutate({
      id: rec.id,
      payload: {
        contractId: rec.contractId,
        periodoIni: editPeriodoIni,
        periodoFim: editPeriodoFim,
        observacoes: editObs || null,
        items,
      },
    });
  }

  if (isLoading) return null;
  if (list.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Formulário de edição inline */}
      {editingId !== null && (() => {
        const rec = list.find((r: any) => r.id === editingId);
        if (!rec) return null;
        const contract = contracts.find((c) => c.id === rec.contractId);
        const allItems: any[] = contract?.items ?? rec.items.map((i: any) => ({ ...i.item }));
        const editTotal = allItems.reduce(
          (s: number, it: any) => s + (editQtds[it.id] ?? 0) * it.valorLicitado, 0,
        );
        return (
          <div className="card border-l-4 border-brand space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-sm text-slate-700">
                Editando registro — <span className="font-mono">{maskCnpj(rec.contract.cnpj)}</span> · {rec.contract.empresa}
              </h3>
              <button className="text-slate-400 hover:text-slate-600 text-xs" onClick={() => setEditingId(null)}>
                Cancelar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Período — Início</label>
                <input type="date" className="input" value={editPeriodoIni}
                  onChange={(e) => setEditPeriodoIni(e.target.value)} />
              </div>
              <div>
                <label className="label">Período — Fim</label>
                <input type="date" className="input" value={editPeriodoFim}
                  onChange={(e) => setEditPeriodoFim(e.target.value)} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reagente</th>
                    <th className="text-right w-32">Valor Licitado</th>
                    <th className="w-36">Qtd. Consumida</th>
                    <th className="text-right w-36">Total (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {allItems.map((it: any) => {
                    const qtd = editQtds[it.id] ?? 0;
                    return (
                      <tr key={it.id}>
                        <td className="text-sm">{it.nome}</td>
                        <td className="text-right tabular-nums text-sm">{fmtMoney(it.valorLicitado)}</td>
                        <td>
                          <input
                            type="number" min={0} step="0.01"
                            className="input text-sm py-1 w-full"
                            value={qtd}
                            onChange={(e) =>
                              setEditQtds({ ...editQtds, [it.id]: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="text-right tabular-nums font-medium text-sm">
                          {fmtMoney(qtd * it.valorLicitado)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td colSpan={3} className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Total Geral
                    </td>
                    <td className="text-right tabular-nums font-bold text-brand">
                      {fmtMoney(editTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div>
              <label className="label">Observações</label>
              <textarea className="input" rows={2} value={editObs}
                onChange={(e) => setEditObs(e.target.value)} />
            </div>

            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => setEditingId(null)}>Cancelar</button>
              <button
                className="btn-primary"
                onClick={() => handleUpdate(rec)}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Salvando…' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Tabela de histórico */}
      <div className="card">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Histórico de registros
        </h3>
        <table className="table">
          <thead>
            <tr>
              <th>CNPJ</th>
              <th>Empresa</th>
              <th>Período</th>
              <th className="text-right">Total (R$)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((rec: any) => {
              const total = rec.items.reduce(
                (s: number, i: any) => s + i.qtdConsumida * i.item.valorLicitado, 0,
              );
              const isEditing = editingId === rec.id;
              return (
                <tr key={rec.id} className={isEditing ? 'bg-brand/5' : ''}>
                  <td className="font-mono text-xs">{maskCnpj(rec.contract.cnpj)}</td>
                  <td className="text-sm">{rec.contract.empresa}</td>
                  <td className="text-xs">{fmtDate(rec.periodoIni)} a {fmtDate(rec.periodoFim)}</td>
                  <td className="text-right tabular-nums text-sm font-medium">{fmtMoney(total)}</td>
                  <td className="whitespace-nowrap">
                    <button
                      title="Editar registro"
                      className={`inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 ml-0.5 ${
                        isEditing ? 'text-brand' : 'text-slate-400 hover:text-slate-700'
                      }`}
                      onClick={() => isEditing ? setEditingId(null) : openEdit(rec)}
                    >
                      <PencilLine size={13} />
                    </button>
                    <button
                      title="Imprimir registro"
                      className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-400 hover:text-brand ml-0.5"
                      onClick={() => printRecord(rec)}
                    >
                      <Printer size={13} />
                    </button>
                    <button
                      title="Excluir registro"
                      className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 ml-0.5"
                      onClick={() => {
                        if (!confirm('Excluir este registro de consumo?')) return;
                        deleteMutation.mutate(rec.id);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 — Relatório de Consumo
// ═══════════════════════════════════════════════════════════════════════════════
const fmtDateISO = (d: Date) => d.toISOString().slice(0, 10);
const default90 = fmtDateISO(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));

function RelatorioConsumo() {
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data) });
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ['reagent-contracts'],
    queryFn: () => api.get('/reagents/contracts').then((r) => r.data),
  });

  const [from, setFrom] = useState(default90);
  const [to, setTo] = useState(fmtDateISO(new Date()));
  const [contractId, setContractId] = useState<number | ''>('');

  const { data: rows = [], isLoading, refetch } = useQuery<ReportRow[]>({
    queryKey: ['reagent-report', from, to, contractId],
    queryFn: () =>
      api.get('/reagents/report', {
        params: { from, to, ...(contractId ? { contractId } : {}) },
      }).then((r) => r.data),
  });

  const alerts = rows.filter((r) => r.alerta);
  const totalPeriodo = rows.reduce((s, r) => s + r.valorPeriodo, 0);

  function handlePrint() {
    if (rows.length === 0) return toast.error('Nenhum dado para imprimir.');
    const cfg = config.data ?? {};
    const logoSrc = cfg.logoA4Url || cfg.logoUrl
      ? `${window.location.origin}${cfg.logoA4Url || cfg.logoUrl}`
      : '';
    const orgName = esc(cfg.razaoSocial || 'ASKLabControl');
    const metaLines = [
      cfg.cnpj && `CNPJ: ${cfg.cnpj}`,
      cfg.cidade && `${cfg.cidade}${cfg.uf ? `/${cfg.uf}` : ''}`,
      cfg.telefone && `Tel: ${cfg.telefone}`,
    ].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');

    const tableRows = rows.map((r) => {
      const alertMark = r.alerta
        ? `<span style="color:#dc2626;font-weight:700">⚠ </span>` : '';
      const saldoColor = r.pctSaldo <= 10 ? 'color:#dc2626;font-weight:700'
        : r.pctSaldo <= 25 ? 'color:#d97706' : 'color:#16a34a';
      return `<tr>
        <td>${alertMark}${esc(r.nome)}</td>
        <td class="num">${fmtNum(r.qtdLicitada)}</td>
        <td class="num">${fmtNum(r.qtdConsumidaPeriodo)}</td>
        <td class="num">${fmtMoney(r.valorPeriodo)}</td>
        <td class="num">${fmtNum(r.qtdTotalConsumida)}</td>
        <td class="num" style="${saldoColor}">${fmtNum(r.saldoAtual)} (${r.pctSaldo.toFixed(1)}%)</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório de Consumo de Reagentes</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8.5pt; color: #1a1a1a; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 10px; }
  .logo { height: 48px; object-fit: contain; }
  .org-name { font-size: 13pt; font-weight: 700; }
  .org-meta { font-size: 7.5pt; color: #555; margin-top: 2px; }
  .title { font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing:.04em; text-align:center; margin:8px 0 2px; }
  .subtitle { font-size: 8pt; color: #555; text-align: center; margin-bottom: 8px; }
  .alert-box { border: 1px solid #fca5a5; background: #fef2f2; border-radius: 4px; padding: 6px 10px; margin-bottom: 8px; font-size: 7.5pt; color: #991b1b; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  thead tr { background: #1a1a1a; color: #fff; }
  th { padding: 5px 5px; text-align: left; font-weight: 600; font-size: 7.5pt; }
  th.num, td.num { text-align: right; }
  td { padding: 4px 5px; border-bottom: 1px solid #e5e5e5; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .total-row td { font-weight: 700; background: #f0f0f0; border-top: 2px solid #1a1a1a; }
  .section-header td { background: #334155; color: white; font-weight: 600; font-size: 7.5pt; padding: 4px 5px; }
  .footer { margin-top: 12px; border-top: 1px solid #ddd; padding-top: 5px; font-size: 7pt; color: #888; display: flex; justify-content: space-between; }
</style></head><body>
<div class="header">
  ${logoSrc ? `<img src="${logoSrc}" class="logo" />` : ''}
  <div style="flex:1">
    <div class="org-name">${orgName}</div>
    ${metaLines ? `<div class="org-meta">${metaLines}</div>` : ''}
  </div>
</div>
<div class="title">Relatório de Consumo de Reagentes</div>
<div class="subtitle">Período: ${fmtDate(from)} a ${fmtDate(to)} · Emitido em ${new Date().toLocaleString('pt-BR')}</div>
${alerts.length > 0 ? `<div class="alert-box">⚠ ALERTA: ${alerts.length} reagente(s) com saldo crítico (≤ 10%): ${alerts.map((a) => esc(a.nome)).join(', ')}</div>` : ''}
<table>
  <thead><tr>
    <th>Reagente</th>
    <th class="num">Qtd. Licitada</th>
    <th class="num">Qtd. Período</th>
    <th class="num">Valor Período</th>
    <th class="num">Total Consumido</th>
    <th class="num">Saldo Atual</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
  <tfoot><tr class="total-row">
    <td colspan="3" style="text-align:right">TOTAL DO PERÍODO</td>
    <td class="num">${fmtMoney(totalPeriodo)}</td>
    <td colspan="2"></td>
  </tr></tfoot>
</table>
<div class="footer">
  <span>${cfg.rodapeImpressao ? esc(cfg.rodapeImpressao) : ''}</span>
  <span>ASKLabControl</span>
</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=860,height=700');
    if (!win) return toast.error('Popup bloqueado.');
    win.document.write(html);
    win.document.close();
    win.addEventListener('load', () => win.print());
  }

  // Group rows by contract
  const byContract = rows.reduce<Record<number, ReportRow[]>>((acc, r) => {
    if (!acc[r.contractId]) acc[r.contractId] = [];
    acc[r.contractId].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Período — Início</label>
          <input type="date" className="input w-40" value={from}
            onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">Período — Fim</label>
          <input type="date" className="input w-40" value={to}
            onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label">Contrato</label>
          <select className="input w-52" value={contractId}
            onChange={(e) => setContractId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Todos os contratos</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{maskCnpj(c.cnpj)} — {c.empresa}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={() => refetch()}>Gerar Relatório</button>
        <button className="btn-outline inline-flex items-center gap-1" onClick={handlePrint}>
          <Printer size={14} /> Imprimir
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Carregando…</p>}

      {!isLoading && rows.length === 0 && (
        <div className="card text-center py-10 text-slate-400 text-sm">
          Nenhum dado encontrado para o período selecionado.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          <AlertBanner rows={rows} />

          {/* Resumo */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Reagentes', value: rows.length },
              { label: 'Com alerta', value: alerts.length, red: alerts.length > 0 },
              { label: 'Valor no período', value: fmtMoney(totalPeriodo) },
              { label: 'Contratos', value: Object.keys(byContract).length },
            ].map((s) => (
              <div key={s.label} className={`card text-center py-3 ${s.red ? 'border-red-300 bg-red-50' : ''}`}>
                <div className={`text-lg font-bold ${s.red ? 'text-red-600' : 'text-slate-800'}`}>{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Por contrato */}
          {Object.entries(byContract).map(([cid, cRows]) => {
            const first = cRows[0];
            const cTotal = cRows.reduce((s, r) => s + r.valorPeriodo, 0);
            return (
              <div key={cid} className="card overflow-hidden p-0">
                <div className="bg-slate-800 text-white px-4 py-2 flex justify-between items-center">
                  <div>
                    <span className="font-mono text-xs opacity-70">{maskCnpj(first.cnpj)}</span>
                    <span className="ml-2 font-semibold">{first.empresa}</span>
                  </div>
                  <span className="text-xs opacity-70">
                    Venc. {fmtDate(first.vigenciaFim)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Reagente</th>
                        <th className="text-right">Qtd. Licitada</th>
                        <th className="text-right">Qtd. Período</th>
                        <th className="text-right">Valor Período</th>
                        <th className="text-right">Total Consumido</th>
                        <th className="w-36">Saldo Atual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cRows.map((r) => (
                        <tr key={r.itemId} className={r.alerta ? 'bg-red-50' : ''}>
                          <td className="text-sm">
                            {r.alerta && <AlertTriangle size={12} className="inline text-red-500 mr-1 mb-0.5" />}
                            {r.nome}
                          </td>
                          <td className="text-right tabular-nums text-sm">{fmtNum(r.qtdLicitada)}</td>
                          <td className="text-right tabular-nums text-sm">{fmtNum(r.qtdConsumidaPeriodo)}</td>
                          <td className="text-right tabular-nums text-sm">{fmtMoney(r.valorPeriodo)}</td>
                          <td className="text-right tabular-nums text-sm">{fmtNum(r.qtdTotalConsumida)}</td>
                          <td>
                            <StockBar pct={r.pctSaldo} />
                            <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                              {fmtNum(r.saldoAtual)} restante{r.saldoAtual !== 1 ? 's' : ''}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50">
                        <td colSpan={3} className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Total do Período
                        </td>
                        <td className="text-right tabular-nums font-bold text-brand">{fmtMoney(cTotal)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}

          <div className="card bg-slate-800 text-white flex justify-between items-center py-3">
            <span className="text-sm font-semibold uppercase tracking-wide opacity-80">Total Geral do Período</span>
            <span className="text-xl font-bold">{fmtMoney(totalPeriodo)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — tabs
// ═══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { id: 'cadastro', label: 'Cadastro de Contratos' },
  { id: 'consumo', label: 'Registro de Consumo' },
  { id: 'relatorio', label: 'Relatório de Consumo' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function ReagentesHome() {
  const [tab, setTab] = useState<TabId>('cadastro');

  // Alert badge: fetch report data for the alert count
  const { data: reportRows = [] } = useQuery<ReportRow[]>({
    queryKey: ['reagent-report', '', '', ''],
    queryFn: () => api.get('/reagents/report').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const alertCount = reportRows.filter((r) => r.alerta).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FlaskConical size={22} className="text-brand" />
        <h1 className="text-2xl font-semibold">Controle de Reagentes</h1>
        {alertCount > 0 && (
          <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full animate-bounce">
            <AlertTriangle size={11} /> {alertCount} alerta{alertCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {t.label}
            {t.id === 'relatorio' && alertCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold">
                {alertCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'cadastro' && <CadastroContratos />}
      {tab === 'consumo' && <RegistroConsumo />}
      {tab === 'relatorio' && <RelatorioConsumo />}
    </div>
  );
}
