import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';

export function ProceduresList() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const { data } = useQuery({ queryKey: ['procs', q], queryFn: () => api.get('/procedures', { params: { q } }).then((r) => r.data) });
  const [edit, setEdit] = useState<any>(null);
  const [sigtapOpts, setSigtapOpts] = useState<any[]>([]);

  async function buscarSigtap(qStr: string) {
    if (qStr.length < 3) { setSigtapOpts([]); return; }
    const r = await api.get('/sigtap/procedimentos', { params: { q: qStr } });
    setSigtapOpts(r.data);
  }

  async function excluir(p: any) {
    if (!confirm(`Excluir o procedimento "${p.descricao}"?\n\nEle será marcado como inativo. Contratos e autorizações vinculados serão preservados.`)) return;
    try {
      await api.delete(`/procedures/${p.id}`);
      toast.success('Procedimento excluído');
      qc.invalidateQueries({ queryKey: ['procs'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao excluir');
    }
  }

  async function salvar() {
    try {
      if (edit.id) await api.patch(`/procedures/${edit.id}`, edit);
      else await api.post('/procedures', edit);
      toast.success('Salvo');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['procs'] });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Procedimentos</h1>
        <button className="btn-primary" onClick={() => setEdit({ codigo: '', descricao: '', ativo: true })}>+ Novo</button>
      </div>
      <input className="input max-w-sm" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card">
        <table className="table">
          <thead><tr><th>Código</th><th>Descrição</th><th>SIGTAP</th><th></th></tr></thead>
          <tbody>
            {data?.map((p: any) => (
              <tr key={p.id}>
                <td className="font-mono">{p.codigo}</td>
                <td>{p.descricao}</td>
                <td className="font-mono text-xs">{p.sigtapCodigo || '—'}</td>
                <td className="whitespace-nowrap">
                  <button
                    title="Editar"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-brand"
                    onClick={() => setEdit(p)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="Excluir"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-slate-600 hover:text-red-600 ml-1"
                    onClick={() => excluir(p)}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="card w-full max-w-lg space-y-2">
            <h2 className="font-semibold">{edit.id ? 'Editar procedimento' : 'Novo procedimento'}</h2>
            <input className="input" placeholder="Código interno" value={edit.codigo || ''} onChange={(e) => setEdit({ ...edit, codigo: e.target.value })} />
            <input className="input" placeholder="Descrição" value={edit.descricao || ''} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} />
            <div>
              <label className="label">Buscar SIGTAP (vincula código + snapshot)</label>
              <input className="input" onChange={(e) => buscarSigtap(e.target.value)} placeholder="código ou descrição" />
              <div className="mt-1 max-h-32 overflow-y-auto">
                {sigtapOpts.map((s) => (
                  <button key={s.codigo} type="button"
                          onClick={() => { setEdit({ ...edit, sigtapCodigo: s.codigo, sigtapSnapshot: s, descricao: edit.descricao || s.descricao, codigo: edit.codigo || s.codigo }); setSigtapOpts([]); }}
                          className="block w-full text-left px-2 py-1 text-xs hover:bg-slate-100">
                    <span className="font-mono">{s.codigo}</span> · {s.descricao}
                  </button>
                ))}
              </div>
              {edit.sigtapCodigo && <div className="text-xs text-green-700 mt-1">Vinculado a SIGTAP {edit.sigtapCodigo}</div>}
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
