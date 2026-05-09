import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/auth';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { api } from '../../lib/api';

interface Item { procedureId: number; codigo: string; descricao: string; qtd: number; }

export function AuthorizationEmit() {
  const nav = useNavigate();
  const location = useLocation();
  const userRole = useAuth((s) => s.user?.role);
  const preSelectedPatient = (location.state as any)?.paciente as any | undefined;
  const [pacQ, setPacQ] = useState('');
  const [paciente, setPaciente] = useState<any>(preSelectedPatient || null);
  const [pacOptions, setPacOptions] = useState<any[]>([]);
  const [pacOpen, setPacOpen] = useState(false);
  const [pacLoading, setPacLoading] = useState(false);
  const pacDebounce = useRef<number | null>(null);
  const pacBlurTimer = useRef<number | null>(null);

  useEffect(() => {
    if (preSelectedPatient) {
      // limpa o state para não persistir entre navegações
      window.history.replaceState({}, document.title);
    }
  }, [preSelectedPatient]);

  const [procQ, setProcQ] = useState('');
  const [procOptions, setProcOptions] = useState<any[]>([]);
  const [procOpen, setProcOpen] = useState(false);
  const [procLoading, setProcLoading] = useState(false);
  const procDebounce = useRef<number | null>(null);
  const procBlurTimer = useRef<number | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const [obs, setObs] = useState('');
  const [simulacao, setSimulacao] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  interface ParcialInfo { authId: number; pendentes: Array<{ descricao: string; codigo: string; qtd: number }>; }
  const [parcialInfo, setParcialInfo] = useState<ParcialInfo | null>(null);

  // autocomplete dinâmico de paciente
  useEffect(() => {
    if (pacDebounce.current) window.clearTimeout(pacDebounce.current);
    const q = pacQ.trim();
    if (q.length < 2) { setPacOptions([]); return; }
    setPacLoading(true);
    pacDebounce.current = window.setTimeout(async () => {
      try {
        const r = await api.get('/patients', { params: { q } });
        setPacOptions(r.data);
        setPacOpen(true);
      } catch { setPacOptions([]); }
      finally { setPacLoading(false); }
    }, 250);
    return () => { if (pacDebounce.current) window.clearTimeout(pacDebounce.current); };
  }, [pacQ]);
  // autocomplete dinâmico (debounce 250ms)
  useEffect(() => {
    if (procDebounce.current) window.clearTimeout(procDebounce.current);
    const q = procQ.trim();
    if (q.length < 2) { setProcOptions([]); return; }
    setProcLoading(true);
    procDebounce.current = window.setTimeout(async () => {
      try {
        const r = await api.get('/procedures', { params: { q, ativo: 1 } });
        setProcOptions(r.data);
        setProcOpen(true);
      } catch { setProcOptions([]); }
      finally { setProcLoading(false); }
    }, 250);
    return () => { if (procDebounce.current) window.clearTimeout(procDebounce.current); };
  }, [procQ]);
  function addItem(p: any) {
    if (items.find((i) => i.procedureId === p.id)) return;
    setItems([...items, { procedureId: p.id, codigo: p.codigo, descricao: p.descricao, qtd: 1 }]);
  }
  function removeItem(id: number) { setItems(items.filter((i) => i.procedureId !== id)); }

  async function simular() {
    if (!paciente || items.length === 0) return toast.error('Selecione paciente e ao menos um exame');
    const r = await api.post('/authorizations/simulate', { patientId: paciente.id, exames: items.map((i) => ({ procedureId: i.procedureId, qtd: i.qtd })) });
    setSimulacao(r.data);
  }

  async function emitir() {
    if (!paciente || items.length === 0) return toast.error('Selecione paciente e exames');
    setLoading(true);
    try {
      const r = await api.post('/authorizations', {
        patientId: paciente.id,
        exames: items.map((i) => ({ procedureId: i.procedureId, qtd: i.qtd })),
        observacoes: obs || null,
      });
      const first = r.data.auths?.[0];
      const rawPendentes: Array<{ procedureId: number; qtd: number }> = r.data.pendentes ?? [];
      const canSeeReports = userRole === 'ADMIN' || userRole === 'GESTOR';

      if (!first && rawPendentes.length > 0) {
        // Nenhum laboratório tinha saldo — tudo virou pendência
        toast.error(`Nenhum laboratório com saldo disponível — ${rawPendentes.length} exame(s) registrado(s) como pendência.`);
        nav(canSeeReports ? '/relatorios' : '/autorizacoes');
      } else if (first && rawPendentes.length > 0) {
        // Autorização parcial — mostra painel de confirmação antes de ir para impressão
        setParcialInfo({
          authId: first.id,
          pendentes: rawPendentes.map((p) => {
            const it = items.find((i) => i.procedureId === p.procedureId);
            return { descricao: it?.descricao ?? `Procedimento #${p.procedureId}`, codigo: it?.codigo ?? '', qtd: p.qtd };
          }),
        });
      } else {
        toast.success('Autorização emitida!');
        nav(`/autorizacoes/${first!.id}/print`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao emitir');
    } finally { setLoading(false); }
  }

  function cancelar() {
    if (paciente || items.length > 0 || obs) {
      if (!confirm('Cancelar esta autorização? Os dados preenchidos serão descartados.')) return;
    }
    nav('/');
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Emitir autorização</h1>
        <button type="button" onClick={cancelar} className="btn-outline inline-flex items-center gap-1">
          <X size={14} /> Cancelar
        </button>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">1. Paciente</h2>
        {paciente ? (
          <div className="flex justify-between items-center">
            <div>
              <div className="font-medium">{paciente.nome}</div>
              <div className="text-xs text-slate-500">CPF {paciente.cpf || '—'} · CNS {paciente.cns || '—'}</div>
            </div>
            <button className="btn-outline" onClick={() => { setPaciente(null); setPacQ(''); }}>Alterar</button>
          </div>
        ) : (
          <div className="relative">
            <input
              className="input"
              placeholder="Buscar paciente por nome, CPF ou CNS (mín. 2 caracteres)"
              value={pacQ}
              onChange={(e) => setPacQ(e.target.value)}
              onFocus={() => { if (pacOptions.length > 0) setPacOpen(true); }}
              onBlur={() => { pacBlurTimer.current = window.setTimeout(() => setPacOpen(false), 200); }}
              autoFocus
            />
            {pacOpen && (pacLoading || pacOptions.length > 0 || pacQ.trim().length >= 2) && (
              <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
                {pacLoading && <div className="px-2 py-1 text-xs text-slate-500">buscando…</div>}
                {!pacLoading && pacOptions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); if (pacBlurTimer.current) window.clearTimeout(pacBlurTimer.current); }}
                    onClick={() => { setPaciente(p); setPacQ(''); setPacOptions([]); setPacOpen(false); }}
                    className="block w-full text-left px-2 py-1 text-sm hover:bg-slate-100 border-b border-slate-100 last:border-0"
                  >
                    <div className="font-medium">{p.nome}</div>
                    <div className="text-[11px] text-slate-500">
                      CPF {p.cpf || '—'} · CNS {p.cns || '—'}
                      {p.dataNascimento && <> · {new Date(p.dataNascimento).toLocaleDateString('pt-BR')}</>}
                    </div>
                  </button>
                ))}
                {!pacLoading && pacOptions.length === 0 && pacQ.trim().length >= 2 && (
                  <div className="px-2 py-1 text-xs text-slate-500">
                    Nenhum paciente encontrado.{' '}
                    <button type="button" onClick={() => nav('/pacientes/novo')} className="text-brand underline">Cadastrar novo</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">2. Exames</h2>
        <div className="relative">
          <input
            className="input"
            placeholder="Buscar procedimento por código ou nome (mín. 2 caracteres)"
            value={procQ}
            onChange={(e) => setProcQ(e.target.value)}
            onFocus={() => { if (procOptions.length > 0) setProcOpen(true); }}
            onBlur={() => { procBlurTimer.current = window.setTimeout(() => setProcOpen(false), 200); }}
          />
          {procOpen && (procLoading || procOptions.length > 0 || procQ.trim().length >= 2) && (
            <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
              {procLoading && <div className="px-2 py-1 text-xs text-slate-500">buscando…</div>}
              {!procLoading && procOptions.map((p) => {
                const jaAdicionado = items.some((i) => i.procedureId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={jaAdicionado}
                    onMouseDown={(e) => { e.preventDefault(); if (procBlurTimer.current) window.clearTimeout(procBlurTimer.current); }}
                    onClick={() => { addItem(p); setProcQ(''); setProcOptions([]); setProcOpen(false); }}
                    className={`block w-full text-left px-2 py-1 text-sm border-b border-slate-100 last:border-0 ${
                      jaAdicionado ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : 'hover:bg-slate-100'
                    }`}
                  >
                    <span className="font-mono text-xs text-slate-700">{p.codigo}</span> · {p.descricao}
                    {jaAdicionado && <span className="ml-2 text-[10px] text-slate-500">(já adicionado)</span>}
                  </button>
                );
              })}
              {!procLoading && procOptions.length === 0 && procQ.trim().length >= 2 && (
                <div className="px-2 py-1 text-xs text-slate-500">Nenhum procedimento encontrado</div>
              )}
            </div>
          )}
        </div>
        {items.length > 0 && (
          <table className="table mt-2">
            <thead><tr><th>Código</th><th>Descrição</th><th>Qtd</th><th></th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.procedureId}>
                  <td className="font-mono text-xs">{i.codigo}</td>
                  <td>{i.descricao}</td>
                  <td><input type="number" min={1} value={i.qtd} onChange={(e) => setItems(items.map((x) => x.procedureId === i.procedureId ? { ...x, qtd: Number(e.target.value) } : x))} className="input w-20" /></td>
                  <td><button onClick={() => removeItem(i.procedureId)} className="text-red-600 text-xs">remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <label className="label">Observações</label>
        <textarea className="input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>

      {parcialInfo ? (
        <div className="card border border-amber-400 bg-amber-50">
          <h3 className="font-semibold text-amber-800 mb-1">Autorização emitida parcialmente</h3>
          <p className="text-sm text-amber-700 mb-3">
            Os exames abaixo não foram autorizados por saldo insuficiente e foram registrados como pendências:
          </p>
          <ul className="text-sm text-amber-900 list-disc ml-4 mb-4 space-y-0.5">
            {parcialInfo.pendentes.map((p, i) => (
              <li key={i}>
                {p.codigo && <span className="font-mono text-xs mr-1 text-slate-600">{p.codigo}</span>}
                {p.descricao} — qtd {p.qtd}
              </li>
            ))}
          </ul>
          <button className="btn-primary" onClick={() => nav(`/autorizacoes/${parcialInfo.authId}/print`)}>
            Confirmar e imprimir
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={cancelar} className="btn-outline">Cancelar</button>
          <button onClick={simular} className="btn-outline">Simular balanceamento</button>
          <button onClick={emitir} disabled={loading} className="btn-primary">{loading ? 'Emitindo...' : 'Emitir'}</button>
        </div>
      )}

      {simulacao && !parcialInfo && (
        <div className="card">
          <h3 className="font-semibold mb-2">Pré-visualização</h3>
          {simulacao.autorizacoes.length > 0 ? (
            <div className="mb-3 border-l-2 border-brand pl-2">
              <div className="text-sm font-medium">Lab #{simulacao.autorizacoes[0].laboratoryId} · Contrato #{simulacao.autorizacoes[0].contractId}</div>
              <ul className="text-xs text-slate-600 list-disc ml-4">
                {simulacao.autorizacoes[0].items.map((it: any, j: number) => <li key={j}>Proc #{it.procedureId} · qtd {it.qtd}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nenhum laboratório com cobertura completa encontrado.</p>
          )}
          {simulacao.pendentes?.length > 0 && (
            <div className="text-sm text-red-600 mt-2">
              <strong>Ficariam pendentes (sem saldo):</strong>
              <ul className="text-xs list-disc ml-4">
                {simulacao.pendentes.map((p: any, i: number) => <li key={i}>Proc #{p.procedureId} · qtd {p.qtd}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
