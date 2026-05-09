import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';

export function PatientsList() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['patients', q],
    queryFn: () => api.get('/patients', { params: { q } }).then((r) => r.data),
  });

  async function excluir(p: any) {
    if (!confirm(`Excluir o paciente "${p.nome}"?\n\nA exclusão é definitiva e só é permitida se não houver autorizações ou pendências vinculadas.`)) return;
    try {
      await api.delete(`/patients/${p.id}`);
      toast.success('Paciente excluído');
      qc.invalidateQueries({ queryKey: ['patients'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao excluir');
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <Link to="/pacientes/novo" className="btn-primary">+ Novo</Link>
      </div>
      <div className="flex gap-2">
        <input className="input" placeholder="Buscar por nome, CPF ou CNS" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-outline" onClick={() => refetch()} disabled={isFetching}>Buscar</button>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Nome</th><th>CPF</th><th>CNS</th><th>Nascimento</th><th></th></tr>
          </thead>
          <tbody>
            {data?.map((p: any) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td>{p.cpf || '—'}</td>
                <td>{p.cns || '—'}</td>
                <td>{p.dataNascimento ? new Date(p.dataNascimento).toLocaleDateString('pt-BR') : '—'}</td>
                <td className="whitespace-nowrap">
                  <button
                    title="Editar"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-brand"
                    onClick={() => nav(`/pacientes/${p.id}`)}
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
            {data?.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-4">Nenhum paciente</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
