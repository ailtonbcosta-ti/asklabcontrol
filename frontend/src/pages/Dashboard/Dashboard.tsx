import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export function Dashboard() {
  const { data: pendentes } = useQuery({ queryKey: ['pending'], queryFn: () => api.get('/reports/pending').then((r) => r.data).catch(() => []) });
  const { data: vigente } = useQuery({ queryKey: ['sigtap-v'], queryFn: () => api.get('/sigtap/competencia-vigente').then((r) => r.data) });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="text-sm text-slate-500">Itens pendentes</div>
          <div className="text-3xl font-bold mt-1">{pendentes?.length ?? '—'}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">SIGTAP vigente</div>
          <div className="text-2xl font-semibold mt-1">{vigente?.competencia || '—'}</div>
        </div>
        <div className="card">
          <div className="text-sm text-slate-500">Sistema</div>
          <div className="text-base mt-1">ASKLabControl v0.1</div>
        </div>
      </div>
    </div>
  );
}
