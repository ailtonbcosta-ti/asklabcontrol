import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Printer, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';

export function AuthorizationsList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const userRole = useAuth((s) => s.user?.role);
  const canDelete = userRole === 'ADMIN' || userRole === 'GESTOR';

  const { data } = useQuery({
    queryKey: ['auths'],
    queryFn: () => api.get('/authorizations').then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/authorizations/${id}`),
    onSuccess: () => {
      toast.success('Autorização excluída e saldo restaurado.');
      qc.invalidateQueries({ queryKey: ['auths'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Falha ao excluir'),
  });

  function handleDelete(a: any) {
    if (!confirm(`Excluir a autorização ${a.codigo}?\n\nEsta ação é irreversível. O saldo consumido será restaurado.`)) return;
    deleteMutation.mutate(a.id);
  }

  const statusLabel: Record<string, string> = {
    EMITIDA: 'Emitida',
    CANCELADA: 'Cancelada',
    PARCIAL_PENDENTE: 'Parcial',
  };

  const statusClass: Record<string, string> = {
    EMITIDA: 'text-green-700 bg-green-50',
    CANCELADA: 'text-slate-500 bg-slate-100',
    PARCIAL_PENDENTE: 'text-amber-700 bg-amber-50',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Autorizações</h1>
        <Link to="/autorizacoes/emitir" className="btn-primary">+ Emitir</Link>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Paciente</th>
              <th>Laboratório</th>
              <th>Data</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((a: any) => (
              <tr key={a.id}>
                <td className="font-mono text-xs">{a.codigo}</td>
                <td>{a.patient?.nome}</td>
                <td>{a.laboratory?.razaoSocial}</td>
                <td className="text-xs">{new Date(a.emitidaEm).toLocaleString('pt-BR')}</td>
                <td>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusClass[a.status] ?? ''}`}>
                    {statusLabel[a.status] ?? a.status}
                  </span>
                </td>
                <td className="whitespace-nowrap">
                  <button
                    title="Imprimir"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-brand"
                    onClick={() => nav(`/autorizacoes/${a.id}/print`)}
                  >
                    <Printer size={14} />
                  </button>
                  {canDelete && (
                    <button
                      title="Excluir autorização"
                      className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 ml-0.5"
                      onClick={() => handleDelete(a)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data?.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-500 py-4">Nenhuma autorização</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
