import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

export function SigtapManager() {
  const qc = useQueryClient();
  const { data: comps, refetch } = useQuery({ queryKey: ['sigtap-comps'], queryFn: () => api.get('/sigtap/competencias').then((r) => r.data) });
  const { data: vigente } = useQuery({ queryKey: ['sigtap-vigente'], queryFn: () => api.get('/sigtap/competencia-vigente').then((r) => r.data) });
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<any>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    const it = setInterval(async () => {
      const r = await api.get(`/sigtap/jobs/${jobId}`);
      setJob(r.data);
      if (r.data.status === 'DONE' || r.data.status === 'ERROR') {
        clearInterval(it);
        refetch();
        qc.invalidateQueries({ queryKey: ['sigtap-vigente'] });
        toast[r.data.status === 'DONE' ? 'success' : 'error'](r.data.mensagem || r.data.status);
      }
    }, 2000);
    return () => clearInterval(it);
  }, [jobId]);

  async function baixarFtp() {
    try {
      const r = await api.post('/sigtap/baixar-datasus');
      toast(`Job iniciado para ${r.data.ftp.competencia}`);
      setJobId(r.data.jobId);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Falha'); }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append('arquivo', file);
    setUploading(true);
    try {
      const r = await api.post('/sigtap/importar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Importado ${r.data.competencia} · ${r.data.procedimentos} procedimentos`);
      refetch();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro upload'); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function tornarVigente(competencia: string) {
    await api.put('/sigtap/competencia-vigente', { competencia });
    toast.success(`Vigente: ${competencia}`);
    qc.invalidateQueries({ queryKey: ['sigtap-vigente'] });
  }

  async function excluir(id: number) {
    if (!confirm('Excluir esta competência?')) return;
    await api.delete(`/sigtap/competencias/${id}`);
    refetch();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tabela Unificada SIGTAP</h1>

      <div className="card">
        <div className="text-sm text-slate-500">Competência vigente</div>
        <div className="text-3xl font-bold">{vigente?.competencia || '—'}</div>
        {vigente?.registro && (
          <div className="text-xs text-slate-500 mt-1">
            Importada em {new Date(vigente.registro.importadoEm).toLocaleString('pt-BR')} via {vigente.registro.origem}
          </div>
        )}
      </div>

      <div className="card flex flex-wrap gap-2">
        <button className="btn-primary" onClick={baixarFtp} disabled={!!jobId && job?.status !== 'DONE' && job?.status !== 'ERROR'}>
          ⬇ Baixar do DATASUS (FTP)
        </button>
        <label className="btn-outline cursor-pointer">
          {uploading ? 'Enviando...' : '📁 Upload manual (.zip)'}
          <input type="file" accept=".zip" hidden onChange={upload} disabled={uploading} />
        </label>
      </div>

      {job && (
        <div className="card text-sm">
          <div><strong>Job #{job.id}</strong> · {job.status}</div>
          <div>{job.mensagem}</div>
          {job.resumo && <pre className="text-xs mt-1 bg-slate-50 p-2 rounded">{JSON.stringify(job.resumo, null, 2)}</pre>}
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold mb-2">Competências importadas</h2>
        <table className="table">
          <thead><tr><th>Competência</th><th>Origem</th><th>Importada em</th><th>Procedimentos</th><th></th></tr></thead>
          <tbody>
            {comps?.map((c: any) => (
              <tr key={c.id}>
                <td className="font-mono">{c.competencia}{c.competencia === vigente?.competencia && <span className="ml-2 text-xs bg-green-100 text-green-700 px-1 rounded">vigente</span>}</td>
                <td>{c.origem}</td>
                <td>{new Date(c.importadoEm).toLocaleString('pt-BR')}</td>
                <td>{c._count?.procedimentos}</td>
                <td className="space-x-2">
                  {c.competencia !== vigente?.competencia && <button className="text-brand text-xs" onClick={() => tornarVigente(c.competencia)}>tornar vigente</button>}
                  <button className="text-red-600 text-xs" onClick={() => excluir(c.id)}>excluir</button>
                </td>
              </tr>
            ))}
            {comps?.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-4">Nenhuma competência importada</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
