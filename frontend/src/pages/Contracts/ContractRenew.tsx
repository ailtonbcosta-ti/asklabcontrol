import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft, ArrowRight, CalendarRange, CheckCircle2, Loader2, RefreshCw, Search, Trash2, Undo2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { formatarDataUTC } from '../../lib/date';

interface SigtapItem { codigo: string; descricao: string; complexidade?: string | null; tpSexo?: string | null }

interface LinhaExistente {
  id: number;
  procedureId: number;
  codigo: string;
  descricao: string;
  ativoAntes: boolean;
  ativo: boolean;
  qtdMensal: number | '';
  valorUnitario: number | '';
  qtdMensalAntes: number;
  valorUnitarioAntes: number;
}

interface LinhaNova {
  procedureId: number;
  codigo: string;
  descricao: string;
  qtdMensal: number | '';
  valorUnitario: number | '';
}

// datas de vigência são gravadas como meia-noite UTC — trabalhar sempre em UTC
const isoDia = (d: Date) => d.toISOString().slice(0, 10);
function addDiasUTC(iso: string, dias: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return isoDia(d);
}
function addMesesUTC(iso: string, meses: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return isoDia(d);
}

function SigtapBusca({ onSelecionar, disabled }: { onSelecionar: (s: SigtapItem) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<SigtapItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (q.trim().length < 3) { setOpts([]); setAtivo(-1); return; }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.get('/sigtap/procedimentos', { params: { q: q.trim() } });
        setOpts(r.data);
        setAtivo(-1);
      } catch { setOpts([]); } finally { setLoading(false); }
    }, 300);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [q]);

  function escolher(s: SigtapItem) {
    onSelecionar(s);
    setQ('');
    setOpts([]);
  }

  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
      <input
        className="input pl-9"
        placeholder="Buscar na tabela SIGTAP por código ou descrição (mín. 3 caracteres)"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (!opts.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => Math.min(opts.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' && ativo >= 0) { e.preventDefault(); escolher(opts[ativo]); }
          else if (e.key === 'Escape') { setOpts([]); }
        }}
      />
      {loading && <Loader2 size={16} className="absolute right-3 top-2.5 animate-spin text-slate-400" />}
      {opts.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-pop">
          {opts.map((s, i) => (
            <button
              key={s.codigo}
              type="button"
              onMouseEnter={() => setAtivo(i)}
              onClick={() => escolher(s)}
              className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 ${
                i === ativo ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="font-mono font-semibold">{s.codigo}</span> · {s.descricao}
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 3 && !loading && opts.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">Nenhum procedimento SIGTAP encontrado.</p>
      )}
    </div>
  );
}

export function ContractRenew() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: contrato } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => api.get(`/contracts/${id}`).then((r) => r.data),
  });

  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [numero, setNumero] = useState('');
  const [credenciamento, setCredenciamento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [linhas, setLinhas] = useState<LinhaExistente[]>([]);
  const [novos, setNovos] = useState<LinhaNova[]>([]);
  const [filtro, setFiltro] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  // inicializa o formulário a partir do contrato atual
  useEffect(() => {
    if (!contrato) return;
    const fimAnterior = String(contrato.vigenciaFim).slice(0, 10);
    const ini = addDiasUTC(fimAnterior, 1);
    setInicio(ini);
    setFim(addDiasUTC(addMesesUTC(ini, 12), -1));
    setNumero(contrato.numero || '');
    setCredenciamento(contrato.numeroCredenciamento || '');
    setLinhas(
      contrato.procedures
        .map((cp: any): LinhaExistente => ({
          id: cp.id,
          procedureId: cp.procedureId,
          codigo: cp.procedure.codigo,
          descricao: cp.procedure.descricao,
          ativoAntes: cp.ativo,
          ativo: cp.ativo,
          qtdMensal: cp.qtdMensal,
          valorUnitario: Number(cp.valorUnitario),
          qtdMensalAntes: cp.qtdMensal,
          valorUnitarioAntes: Number(cp.valorUnitario),
        }))
        .sort((a: LinhaExistente, b: LinhaExistente) => Number(b.ativoAntes) - Number(a.ativoAntes) || a.codigo.localeCompare(b.codigo)),
    );
  }, [contrato]);

  const setLinha = (lid: number, patch: Partial<LinhaExistente>) =>
    setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, ...patch } : l)));

  async function adicionar(s: SigtapItem) {
    try {
      const r = await api.post('/procedures/ensure-from-sigtap', { sigtapCodigo: s.codigo, descricao: s.descricao, snapshot: s });
      const proc = r.data;
      const existente = linhas.find((l) => l.procedureId === proc.id);
      if (existente) {
        setLinha(existente.id, { ativo: true });
        if (!existente.ativoAntes) setMostrarInativos(true);
        toast(existente.ativoAntes ? 'Este procedimento já está no contrato — mantido.' : 'Procedimento já existia (inativo) — será reativado.', { icon: 'ℹ️' });
        return;
      }
      if (novos.some((n) => n.procedureId === proc.id)) {
        toast('Procedimento já adicionado.', { icon: 'ℹ️' });
        return;
      }
      setNovos((ns) => [...ns, { procedureId: proc.id, codigo: proc.codigo, descricao: proc.descricao, qtdMensal: '', valorUnitario: '' }]);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao selecionar procedimento');
    }
  }

  const resumo = useMemo(() => {
    let mantidos = 0, alterados = 0, inativados = 0, reativados = 0;
    for (const l of linhas) {
      if (l.ativoAntes && !l.ativo) inativados++;
      else if (!l.ativoAntes && l.ativo) reativados++;
      else if (l.ativo) {
        if (Number(l.qtdMensal) !== l.qtdMensalAntes || Number(l.valorUnitario) !== l.valorUnitarioAntes) alterados++;
        else mantidos++;
      }
    }
    return { mantidos, alterados, inativados, reativados, adicionados: novos.length, ativos: mantidos + alterados + reativados + novos.length };
  }, [linhas, novos]);

  const visiveis = linhas.filter((l) => {
    if (!mostrarInativos && !l.ativoAntes && !l.ativo) return false;
    const f = filtro.trim().toLowerCase();
    return !f || l.codigo.includes(f) || l.descricao.toLowerCase().includes(f);
  });
  const qtdInativosAntes = linhas.filter((l) => !l.ativoAntes).length;

  function validar(): string | null {
    if (!inicio || !fim) return 'Informe o início e o fim da nova vigência';
    if (fim <= inicio) return 'O fim da vigência deve ser posterior ao início';
    if (!numero.trim()) return 'Informe o número do contrato';
    if (resumo.ativos === 0) return 'O contrato precisa ter ao menos um procedimento ativo';
    const invalido = [...linhas.filter((l) => l.ativo), ...novos].find((l) => !l.qtdMensal || Number(l.qtdMensal) < 1);
    if (invalido) return `Informe a quantidade mensal de ${invalido.codigo}`;
    return null;
  }

  async function renovar() {
    setSalvando(true);
    try {
      const r = await api.post(`/contracts/${id}/renovar`, {
        vigenciaInicio: inicio,
        vigenciaFim: fim,
        numero: numero.trim(),
        numeroCredenciamento: credenciamento.trim() || null,
        observacao: observacao.trim() || null,
        existentes: linhas.map((l) => ({
          id: l.id,
          ativo: l.ativo,
          // linhas inativas não são editadas: reenvia os valores anteriores
          qtdMensal: l.ativo ? Number(l.qtdMensal) : l.qtdMensalAntes,
          valorUnitario: l.ativo ? Number(l.valorUnitario || 0) : l.valorUnitarioAntes,
        })),
        novos: novos.map((n) => ({ procedureId: n.procedureId, qtdMensal: Number(n.qtdMensal), valorUnitario: Number(n.valorUnitario || 0) })),
      });
      toast.success(`Contrato renovado até ${formatarDataUTC(r.data.vigenciaFim)}`);
      qc.invalidateQueries({ queryKey: ['contract', id] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
      nav(`/contratos/${id}`);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao renovar contrato');
      setConfirmar(false);
    } finally {
      setSalvando(false);
    }
  }

  if (!contrato) {
    return <div className="flex items-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando…</div>;
  }

  const numInput = 'input w-24 py-1.5 text-right tabular-nums';

  return (
    <div className="space-y-6 pb-24">
      <div>
        <Link to={`/contratos/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand">
          <ArrowLeft size={14} /> Voltar ao contrato
        </Link>
        <h1 className="page-title mt-2 flex items-center gap-2"><RefreshCw size={22} className="text-brand" /> Renovar contrato</h1>
        <p className="page-subtitle">
          {contrato.numero} · {contrato.laboratory?.razaoSocial}. O cadastro é reaproveitado: as autorizações já emitidas
          e o histórico continuam vinculados a este contrato.
        </p>
      </div>

      {/* Vigência */}
      <section className="card">
        <h2 className="mb-4 flex items-center gap-2 font-semibold"><CalendarRange size={18} className="text-slate-400" /> Nova vigência</h2>
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <span className="text-slate-500">Atual:</span>
          <span className="font-medium text-slate-700">{formatarDataUTC(contrato.vigenciaInicio)} → {formatarDataUTC(contrato.vigenciaFim)}</span>
          <ArrowRight size={14} className="text-slate-400" />
          <span className="text-slate-500">Nova:</span>
          <span className="font-medium text-brand-700">
            {inicio ? formatarDataUTC(inicio) : '—'} → {fim ? formatarDataUTC(fim) : '—'}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Início da vigência</label>
            <input type="date" className="input" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div>
            <label className="label">Fim da vigência</label>
            <input type="date" className="input" value={fim} onChange={(e) => setFim(e.target.value)} />
            <div className="mt-1.5 flex gap-1">
              {[6, 12, 24].map((m) => (
                <button key={m} type="button" className="btn-ghost btn-sm px-2 py-0.5" disabled={!inicio}
                        onClick={() => setFim(addDiasUTC(addMesesUTC(inicio, m), -1))}>
                  +{m} meses
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Número do contrato</label>
            <input className="input" value={numero} onChange={(e) => setNumero(e.target.value)} />
          </div>
          <div>
            <label className="label">Nº do credenciamento</label>
            <input className="input" value={credenciamento} onChange={(e) => setCredenciamento(e.target.value)} placeholder="opcional" />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="label">Observação da renovação</label>
            <input className="input" value={observacao} onChange={(e) => setObservacao(e.target.value)}
                   placeholder="Ex.: termo aditivo nº 02/2026 (opcional)" />
          </div>
        </div>
      </section>

      {/* Procedimentos existentes */}
      <section className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Procedimentos do contrato</h2>
            <p className="text-sm text-slate-500">Desmarque o que não faz mais parte do contrato e ajuste quantidades e valores se mudaram.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-56 py-1.5" placeholder="Filtrar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            {qtdInativosAntes > 0 && (
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
                Mostrar inativos ({qtdInativosAntes})
              </label>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setLinhas((ls) => ls.map((l) => (l.ativoAntes ? { ...l, ativo: true } : l)))}>
              Manter todos
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">Manter</th>
                <th>Código</th>
                <th>Descrição</th>
                <th className="text-right">Qtd/mês</th>
                <th className="text-right">Valor unit. (R$)</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const alterado = l.ativo && l.ativoAntes &&
                  (Number(l.qtdMensal) !== l.qtdMensalAntes || Number(l.valorUnitario) !== l.valorUnitarioAntes);
                return (
                  <tr key={l.id} className={!l.ativo ? 'opacity-60' : ''}>
                    <td>
                      <input type="checkbox" className="h-4 w-4" checked={l.ativo} aria-label={`Manter ${l.codigo}`}
                             onChange={(e) => setLinha(l.id, { ativo: e.target.checked })} />
                    </td>
                    <td className="font-mono text-xs">{l.codigo}</td>
                    <td className={!l.ativo ? 'line-through decoration-slate-400' : ''}>{l.descricao}</td>
                    <td className="text-right">
                      <input type="number" min={1} className={numInput} disabled={!l.ativo} value={l.qtdMensal}
                             onChange={(e) => setLinha(l.id, { qtdMensal: e.target.value === '' ? '' : Number(e.target.value) })} />
                    </td>
                    <td className="text-right">
                      <input type="number" min={0} step="0.01" className={`${numInput} w-28`} disabled={!l.ativo} value={l.valorUnitario}
                             onChange={(e) => setLinha(l.id, { valorUnitario: e.target.value === '' ? '' : Number(e.target.value) })} />
                    </td>
                    <td className="whitespace-nowrap">
                      {l.ativoAntes && !l.ativo && <span className="badge-red">Será inativado</span>}
                      {!l.ativoAntes && l.ativo && <span className="badge-green">Será reativado</span>}
                      {!l.ativoAntes && !l.ativo && <span className="badge-slate">Inativo</span>}
                      {alterado && <span className="badge-amber">Alterado</span>}
                      {l.ativoAntes && l.ativo && !alterado && <span className="badge-slate">Mantido</span>}
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-slate-500">Nenhum procedimento{filtro ? ' para o filtro' : ''}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Novos procedimentos */}
      <section className="card">
        <h2 className="font-semibold">Adicionar procedimentos</h2>
        <p className="mb-4 text-sm text-slate-500">Inclua os procedimentos que passaram a fazer parte do contrato.</p>
        <SigtapBusca onSelecionar={adicionar} />

        {novos.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Código</th><th>Descrição</th><th className="text-right">Qtd/mês</th><th className="text-right">Valor unit. (R$)</th><th></th></tr>
              </thead>
              <tbody>
                {novos.map((n) => (
                  <tr key={n.procedureId}>
                    <td className="font-mono text-xs">{n.codigo}</td>
                    <td>{n.descricao} <span className="badge-brand ml-1">Novo</span></td>
                    <td className="text-right">
                      <input type="number" min={1} className={numInput} value={n.qtdMensal} autoFocus
                             onChange={(e) => setNovos((ns) => ns.map((x) => x.procedureId === n.procedureId ? { ...x, qtdMensal: e.target.value === '' ? '' : Number(e.target.value) } : x))} />
                    </td>
                    <td className="text-right">
                      <input type="number" min={0} step="0.01" className={`${numInput} w-28`} value={n.valorUnitario}
                             onChange={(e) => setNovos((ns) => ns.map((x) => x.procedureId === n.procedureId ? { ...x, valorUnitario: e.target.value === '' ? '' : Number(e.target.value) } : x))} />
                    </td>
                    <td className="text-right">
                      <button type="button" title="Remover" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => setNovos((ns) => ns.filter((x) => x.procedureId !== n.procedureId))}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Barra de resumo fixa */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/90 backdrop-blur-md lg:left-64">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="badge-slate">{resumo.mantidos} mantidos</span>
            {resumo.alterados > 0 && <span className="badge-amber">{resumo.alterados} alterados</span>}
            {resumo.reativados > 0 && <span className="badge-green">{resumo.reativados} reativados</span>}
            {resumo.adicionados > 0 && <span className="badge-brand">{resumo.adicionados} novos</span>}
            {resumo.inativados > 0 && <span className="badge-red">{resumo.inativados} inativados</span>}
            <span className="text-slate-500">· {resumo.ativos} ativos após a renovação</span>
          </div>
          <div className="flex gap-2">
            <Link to={`/contratos/${id}`} className="btn-outline">Cancelar</Link>
            <button className="btn-primary" onClick={() => {
              const erro = validar();
              if (erro) { toast.error(erro); return; }
              setConfirmar(true);
            }}>
              <RefreshCw size={16} /> Renovar contrato
            </button>
          </div>
        </div>
      </div>

      {confirmar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 size={20} className="text-brand" /> Confirmar renovação</h3>
            <div className="space-y-1 text-sm text-slate-600">
              <p>Contrato <strong>{numero}</strong> passará a valer de <strong>{formatarDataUTC(inicio)}</strong> até <strong>{formatarDataUTC(fim)}</strong>.</p>
              <ul className="ml-5 list-disc text-slate-600">
                {resumo.mantidos > 0 && <li>{resumo.mantidos} procedimento(s) mantido(s)</li>}
                {resumo.alterados > 0 && <li>{resumo.alterados} com quantidade/valor alterado</li>}
                {resumo.reativados > 0 && <li>{resumo.reativados} reativado(s)</li>}
                {resumo.adicionados > 0 && <li>{resumo.adicionados} novo(s)</li>}
                {resumo.inativados > 0 && <li className="text-red-700">{resumo.inativados} inativado(s) — deixarão de receber autorizações</li>}
              </ul>
              <p className="pt-1 text-xs text-slate-500">A vigência anterior fica registrada no histórico de renovações.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setConfirmar(false)} disabled={salvando}>
                <Undo2 size={15} /> Revisar
              </button>
              <button className="btn-primary" onClick={renovar} disabled={salvando}>
                {salvando && <Loader2 size={16} className="animate-spin" />}
                {salvando ? 'Renovando…' : 'Confirmar renovação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
