import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2, FolderOpen, FileUp } from 'lucide-react';
import { ContractPdfImport } from './ContractPdfImport';
import { api } from '../../lib/api';
import { formatarDataUTC } from '../../lib/date';

export function ContractsList() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['contracts'], queryFn: () => api.get('/contracts').then((r) => r.data) });
  const { data: labs } = useQuery({ queryKey: ['labs'], queryFn: () => api.get('/laboratories').then((r) => r.data) });
  const [edit, setEdit] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function salvar() {
    try {
      if (edit.id) await api.patch(`/contracts/${edit.id}`, edit);
      else await api.post('/contracts', edit);
      toast.success('Salvo');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['contracts'] });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro'); }
  }

  async function excluir(c: any) {
    if (!confirm(`Excluir o contrato ${c.numero}?\n\nSe houver autorizações vinculadas, ele será apenas desativado.`)) return;
    try {
      const r = await api.delete(`/contracts/${c.id}`);
      toast.success(r.data.soft
        ? `Contrato desativado (há ${r.data.autorizacoesVinculadas} autorizações vinculadas)`
        : 'Contrato excluído');
      qc.invalidateQueries({ queryKey: ['contracts'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao excluir');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Contratos</h1>
        <div className="flex gap-2">
          <button className="btn-outline inline-flex items-center gap-1" onClick={() => setImportOpen(true)}>
            <FileUp size={14} /> Importar PDF
          </button>
          <button className="btn-primary" onClick={() => setEdit({ numero: '', numeroCredenciamento: '', laboratoryId: 0, vigenciaInicio: '', vigenciaFim: '' })}>+ Novo</button>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>Número</th><th>Laboratório</th><th>Vigência</th><th>Procedimentos</th><th></th></tr></thead>
          <tbody>
            {data?.map((c: any) => (
              <tr key={c.id}>
                <td>{c.numero}</td>
                <td>{c.laboratory?.razaoSocial}</td>
                <td>{formatarDataUTC(c.vigenciaInicio)} → {formatarDataUTC(c.vigenciaFim)}</td>
                <td>{c._count?.procedures}</td>
                <td className="whitespace-nowrap">
                  <button
                    title="Abrir"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-brand"
                    onClick={() => nav(`/contratos/${c.id}`)}
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    title="Editar"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-brand ml-1"
                    onClick={() => setEdit({ ...c, vigenciaInicio: c.vigenciaInicio?.slice(0, 10), vigenciaFim: c.vigenciaFim?.slice(0, 10) })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="Excluir"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-slate-600 hover:text-red-600 ml-1"
                    onClick={() => excluir(c)}
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
            <h2 className="font-semibold">{edit.id ? 'Editar contrato' : 'Novo contrato'}</h2>
            <input className="input" placeholder="Número do contrato" value={edit.numero || ''} onChange={(e) => setEdit({ ...edit, numero: e.target.value })} />
            <input className="input" placeholder="Nº do credenciamento (opcional)" value={edit.numeroCredenciamento || ''} onChange={(e) => setEdit({ ...edit, numeroCredenciamento: e.target.value })} />
            <select className="input" value={edit.laboratoryId || 0} onChange={(e) => setEdit({ ...edit, laboratoryId: Number(e.target.value) })}>
              <option value={0}>— Laboratório —</option>
              {labs?.map((l: any) => <option key={l.id} value={l.id}>{l.razaoSocial}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Vigência início</label>
                <input type="date" className="input" value={edit.vigenciaInicio?.slice?.(0,10) || ''} onChange={(e) => setEdit({ ...edit, vigenciaInicio: e.target.value })} />
              </div>
              <div>
                <label className="label">Vigência fim</label>
                <input type="date" className="input" value={edit.vigenciaFim?.slice?.(0,10) || ''} onChange={(e) => setEdit({ ...edit, vigenciaFim: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <ContractPdfImport
          onClose={() => setImportOpen(false)}
          onCreated={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['contracts'] }); }}
        />
      )}
    </div>
  );
}
