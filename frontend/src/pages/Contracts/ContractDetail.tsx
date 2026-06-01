import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { formatarDataUTC } from '../../lib/date';

interface SigtapItem { codigo: string; descricao: string; complexidade?: string | null; tpSexo?: string | null; }

export function ContractDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['contract', id], queryFn: () => api.get(`/contracts/${id}`).then((r) => r.data) });
  const [novo, setNovo] = useState<any | null>(null);
  const [editando, setEditando] = useState<any | null>(null);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [busca, setBusca] = useState('');
  const [opts, setOpts] = useState<SigtapItem[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const [activeOptIndex, setActiveOptIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // autocomplete dinâmico na tabela SIGTAP (debounced)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (busca.trim().length < 3) { setOpts([]); setActiveOptIndex(-1); return; }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await api.get('/sigtap/procedimentos', { params: { q: busca.trim() } });
        setOpts(r.data);
        setActiveOptIndex(-1);
      } catch { setOpts([]); }
      finally { setSearching(false); }
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [busca]);

  useEffect(() => {
    if (activeOptIndex >= 0 && containerRef.current) {
      const container = containerRef.current;
      const activeEl = container.children[activeOptIndex] as HTMLElement;
      if (activeEl) {
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        const elemTop = activeEl.offsetTop;
        const elemBottom = elemTop + activeEl.offsetHeight;

        if (elemTop < containerTop) {
          container.scrollTop = elemTop;
        } else if (elemBottom > containerBottom) {
          container.scrollTop = elemBottom - container.clientHeight;
        }
      }
    }
  }, [activeOptIndex]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (opts.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveOptIndex((prev: number) => (prev < opts.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveOptIndex((prev: number) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      if (activeOptIndex >= 0 && activeOptIndex < opts.length) {
        e.preventDefault();
        selecionar(opts[activeOptIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpts([]);
      setActiveOptIndex(-1);
    }
  };

  async function selecionar(s: SigtapItem) {
    try {
      const r = await api.post('/procedures/ensure-from-sigtap', {
        sigtapCodigo: s.codigo,
        descricao: s.descricao,
        snapshot: s,
      });
      setNovo({ ...(novo || {}), procedureId: r.data.id, _label: `${r.data.codigo} · ${r.data.descricao}` });
      setOpts([]);
      setBusca('');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao vincular procedimento');
    }
  }

  async function salvar() {
    if (!novo?.procedureId) return toast.error('Selecione um procedimento da tabela SIGTAP');
    if (!novo.qtdMensal || novo.qtdMensal < 1) return toast.error('Informe a quantidade mensal');
    await api.post(`/contracts/${id}/procedures`, {
      procedureId: novo.procedureId,
      qtdMensal: novo.qtdMensal,
      valorUnitario: novo.valorUnitario || 0,
    });
    toast.success('Procedimento adicionado');
    setNovo(null);
    qc.invalidateQueries({ queryKey: ['contract', id] });
  }

  async function salvarEdicao() {
    if (!editando.qtdMensal || editando.qtdMensal < 1) return toast.error('Informe a quantidade mensal');
    try {
      await api.patch(`/contracts/${id}/procedures/${editando.id}`, {
        procedureId: editando.procedureId,
        qtdMensal: editando.qtdMensal,
        valorUnitario: editando.valorUnitario || 0,
        ativo: editando.ativo,
      });
      toast.success('Procedimento atualizado');
      setEditando(null);
      qc.invalidateQueries({ queryKey: ['contract', id] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao atualizar procedimento');
    }
  }

  async function excluir(cpId: number) {
    if (!window.confirm('Tem certeza que deseja desativar/remover este procedimento do contrato?')) return;
    try {
      await api.delete(`/contracts/${id}/procedures/${cpId}`);
      toast.success('Procedimento desativado/removido');
      qc.invalidateQueries({ queryKey: ['contract', id] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao remover procedimento');
    }
  }

  if (!data) return <div>Carregando...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{data.numero} · {data.laboratory.razaoSocial}</h1>
      <div className="text-sm text-slate-500">Vigência: {formatarDataUTC(data.vigenciaInicio)} → {formatarDataUTC(data.vigenciaFim)}</div>

      <div className="card">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold">Procedimentos contratados (cota mensal)</h2>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mostrarInativos}
                onChange={(e) => setMostrarInativos(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Mostrar inativos
            </label>
          </div>
          <button className="btn-primary" onClick={() => { setNovo({ procedureId: 0, qtdTotal: 0, qtdMensal: 0, valorUnitario: 0 }); setBusca(''); setOpts([]); }}>+ Adicionar</button>
        </div>
        <table className="table">
          <thead><tr><th>Código</th><th>Descrição</th><th>Qtd/mês</th><th>Valor unit.</th><th>Ativo</th><th className="text-right">Ações</th></tr></thead>
          <tbody>
            {data.procedures
              .filter((cp: any) => mostrarInativos || cp.ativo)
              .map((cp: any) => (
              <tr key={cp.id}>
                <td className="font-mono">{cp.procedure.codigo}</td>
                <td>{cp.procedure.descricao}</td>
                <td>{cp.qtdMensal}</td>
                <td>R$ {Number(cp.valorUnitario).toFixed(2)}</td>
                <td>{cp.ativo ? 'Sim' : 'Não'}</td>
                <td className="text-right">
                  <div className="flex gap-2 justify-end">
                    <button
                      className="btn-outline text-xs px-2 py-1"
                      onClick={() => setEditando({
                        id: cp.id,
                        procedureId: cp.procedureId,
                        _label: `${cp.procedure.codigo} · ${cp.procedure.descricao}`,
                        qtdTotal: cp.qtdMensal * 12,
                        qtdMensal: cp.qtdMensal,
                        valorUnitario: Number(cp.valorUnitario),
                        ativo: cp.ativo
                      })}
                    >
                      Editar
                    </button>
                    <button
                      className="btn-outline text-xs px-2 py-1 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                      onClick={() => excluir(cp.id)}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {novo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              salvar();
            }}
            className="card w-full max-w-lg space-y-3"
          >
            <h2 className="font-semibold">Adicionar procedimento</h2>

            <div>
              <label className="label">Buscar procedimento (SIGTAP)</label>
              <input
                className="input"
                placeholder="digite código ou descrição (mín. 3 caracteres)"
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setActiveOptIndex(-1); }}
                onKeyDown={handleSearchKeyDown}
                autoFocus
              />
              {searching && <div className="text-xs text-slate-500 mt-1">buscando…</div>}
              {opts.length > 0 && (
                <div
                  ref={containerRef}
                  className="border border-slate-200 rounded mt-1 max-h-56 overflow-y-auto bg-white shadow-sm"
                >
                  {opts.map((s: SigtapItem, idx: number) => (
                    <button
                      key={s.codigo}
                      type="button"
                      onClick={() => { selecionar(s); setActiveOptIndex(-1); }}
                      onMouseEnter={() => setActiveOptIndex(idx)}
                      className={`block w-full text-left px-2 py-1.5 text-xs border-b border-slate-100 last:border-0 transition-colors ${
                        idx === activeOptIndex
                          ? 'bg-blue-50 text-blue-900 font-medium'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span className="font-mono text-slate-800 font-semibold">{s.codigo}</span> · {s.descricao}
                      {s.tpSexo && <span className="ml-2 text-[10px] bg-slate-100 px-1 rounded">{s.tpSexo}</span>}
                    </button>
                  ))}
                </div>
              )}
              {busca.length >= 3 && !searching && opts.length === 0 && (
                <div className="text-xs text-slate-500 mt-1">Nenhum procedimento SIGTAP encontrado.</div>
              )}
            </div>

            {novo._label && (
              <div className="text-xs bg-green-50 border border-green-200 text-green-800 rounded px-2 py-1">
                ✓ Selecionado: <strong>{novo._label}</strong>
              </div>
            )}

            <div>
              <label className="label">Quantidade total</label>
              <input
                className="input"
                type="number"
                min={1}
                value={novo.qtdTotal || ''}
                onChange={(e) => {
                  const valStr = e.target.value;
                  if (valStr === '') {
                    setNovo({ ...novo, qtdTotal: '', qtdMensal: '' });
                  } else {
                    const total = Number(valStr);
                    const mensal = total > 0 ? Math.max(1, Math.floor(total / 12)) : 0;
                    setNovo({ ...novo, qtdTotal: total, qtdMensal: mensal });
                  }
                }}
              />
            </div>

            <div>
              <label className="label">Quantidade mensal</label>
              <input
                className="input"
                type="number"
                min={1}
                value={novo.qtdMensal || ''}
                onChange={(e) => {
                  const valStr = e.target.value;
                  if (valStr === '') {
                    setNovo({ ...novo, qtdMensal: '' });
                  } else {
                    setNovo({ ...novo, qtdMensal: Number(valStr) });
                  }
                }}
              />
            </div>
            <div>
              <label className="label">Valor unitário (R$)</label>
              <input className="input" type="number" step="0.01" min={0} value={novo.valorUnitario || ''} onChange={(e) => setNovo({ ...novo, valorUnitario: Number(e.target.value) })} />
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-outline" onClick={() => setNovo(null)}>Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      )}

      {editando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              salvarEdicao();
            }}
            className="card w-full max-w-lg space-y-3"
          >
            <h2 className="font-semibold">Editar procedimento</h2>

            <div className="text-xs bg-slate-50 border border-slate-200 text-slate-700 rounded px-2 py-1">
              Procedimento: <strong>{editando._label}</strong>
            </div>

            <div>
              <label className="label">Quantidade total</label>
              <input
                className="input"
                type="number"
                min={1}
                value={editando.qtdTotal || ''}
                onChange={(e) => {
                  const valStr = e.target.value;
                  if (valStr === '') {
                    setEditando({ ...editando, qtdTotal: '', qtdMensal: '' });
                  } else {
                    const total = Number(valStr);
                    const mensal = total > 0 ? Math.max(1, Math.floor(total / 12)) : 0;
                    setEditando({ ...editando, qtdTotal: total, qtdMensal: mensal });
                  }
                }}
              />
            </div>

            <div>
              <label className="label">Quantidade mensal</label>
              <input
                className="input"
                type="number"
                min={1}
                value={editando.qtdMensal || ''}
                onChange={(e) => {
                  const valStr = e.target.value;
                  if (valStr === '') {
                    setEditando({ ...editando, qtdMensal: '' });
                  } else {
                    setEditando({ ...editando, qtdMensal: Number(valStr) });
                  }
                }}
              />
            </div>

            <div>
              <label className="label">Valor unitário (R$)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min={0}
                value={editando.valorUnitario}
                onChange={(e) => setEditando({ ...editando, valorUnitario: Number(e.target.value) })}
              />
            </div>

            <div className="flex items-center gap-2 py-1">
              <input
                id="edit-ativo"
                type="checkbox"
                checked={editando.ativo}
                onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="edit-ativo" className="text-sm font-medium text-slate-700 select-none">
                Procedimento ativo no contrato
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-outline" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="submit" className="btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
