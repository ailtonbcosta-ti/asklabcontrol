import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, DatabaseBackup, Download, Loader2, Trash2, XCircle } from 'lucide-react';
import { api } from '../../lib/api';

type Status = 'preparando' | 'executando' | 'concluido' | 'erro' | 'cancelado';

interface BackupJob {
  id: string;
  status: Status;
  progresso: number;
  fase: string;
  tabelaAtual: string | null;
  tabelasConcluidas: number;
  tabelasTotal: number;
  bytes: number;
  nomeArquivo: string;
  iniciadoEm: string;
  finalizadoEm: string | null;
  erro: string | null;
  downloadToken: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const EXPIRA_MIN = 30;

function fmtBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString('pt-BR', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}

function fmtDuracao(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}min ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

const emAndamento = (j: BackupJob | null) => !!j && (j.status === 'preparando' || j.status === 'executando');

/**
 * Download nativo do navegador: POST de formulário com o token no corpo, enviado para
 * um iframe oculto (a página não sai do lugar e o token não aparece na URL).
 */
function baixar(job: BackupJob) {
  if (!job.downloadToken) return;
  const frameName = 'asklab-backup-download';
  let iframe = document.querySelector<HTMLIFrameElement>(`iframe[name="${frameName}"]`);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.name = frameName;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${API_BASE}/backup/${encodeURIComponent(job.id)}/download`;
  form.target = frameName;
  form.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'token';
  input.value = job.downloadToken;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function BackupCard() {
  const [job, setJob] = useState<BackupJob | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  // id do job que foi iniciado/acompanhado nesta tela → baixa automaticamente ao concluir
  const autoBaixar = useRef<string | null>(null);

  // retoma um backup em andamento (ou pronto) ao abrir a página
  useEffect(() => {
    api.get('/backup/atual').then((r) => {
      const j: BackupJob | null = r.data;
      setJob(j);
      if (emAndamento(j)) autoBaixar.current = j!.id;
    }).catch(() => { /* ignore */ });
  }, []);

  // polling enquanto estiver em andamento
  const ativo = emAndamento(job);
  useEffect(() => {
    if (!ativo || !job) return;
    const id = job.id;
    const t = setInterval(async () => {
      setAgora(Date.now());
      try {
        const r = await api.get<BackupJob>(`/backup/${id}`);
        setJob(r.data);
        if (r.data.status === 'concluido' && autoBaixar.current === id) {
          autoBaixar.current = null;
          toast.success('Backup concluído. Download iniciado.');
          baixar(r.data);
        } else if (r.data.status === 'erro') {
          autoBaixar.current = null;
          toast.error(r.data.erro || 'Falha no backup');
        }
      } catch (e: any) {
        if (e.response?.status === 404) setJob(null);
      }
    }, 700);
    return () => clearInterval(t);
  }, [ativo, job?.id]);

  async function iniciar() {
    setIniciando(true);
    try {
      const r = await api.post<BackupJob>('/backup');
      autoBaixar.current = r.data.id;
      setJob(r.data);
    } catch (e: any) {
      const existente = e.response?.data?.details?.id;
      toast.error(e.response?.data?.error || 'Não foi possível iniciar o backup');
      if (existente) {
        try {
          const r = await api.get<BackupJob>(`/backup/${existente}`);
          setJob(r.data);
        } catch { /* backup de outro administrador */ }
      }
    } finally {
      setIniciando(false);
    }
  }

  async function descartar() {
    if (!job) return;
    if (ativo && !confirm('Cancelar o backup em andamento?')) return;
    try {
      await api.delete(`/backup/${job.id}`);
      autoBaixar.current = null;
      setJob(null);
      toast.success(ativo ? 'Backup cancelado' : 'Arquivo de backup descartado do servidor');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao descartar');
    }
  }

  const pct = job ? Math.max(0, Math.min(100, job.progresso)) : 0;
  const decorrido = job ? (job.finalizadoEm ? new Date(job.finalizadoEm).getTime() : agora) - new Date(job.iniciadoEm).getTime() : 0;
  const expiraEm = job?.finalizadoEm ? new Date(new Date(job.finalizadoEm).getTime() + EXPIRA_MIN * 60_000) : null;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <DatabaseBackup size={20} />
          </div>
          <div>
            <h2 className="font-semibold">Backup do banco de dados</h2>
            <p className="text-sm text-slate-500">
              Gera uma cópia completa do banco (formato <span className="font-mono text-xs">.dump</span> do PostgreSQL)
              e baixa o arquivo pelo navegador.
            </p>
          </div>
        </div>
        <button className="btn-primary" onClick={iniciar} disabled={iniciando || ativo}>
          {iniciando || ativo ? <Loader2 size={16} className="animate-spin" /> : <DatabaseBackup size={16} />}
          {ativo ? 'Gerando backup…' : 'Gerar backup'}
        </button>
      </div>

      {job && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          {/* Cabeçalho do status */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 font-medium text-slate-700">
              {job.status === 'concluido' && <CheckCircle2 size={16} className="text-emerald-600" />}
              {(job.status === 'erro' || job.status === 'cancelado') && <XCircle size={16} className="text-red-600" />}
              {ativo && <Loader2 size={16} className="animate-spin text-brand-600" />}
              {job.status === 'erro' ? 'Falha no backup' : job.fase}
            </div>
            <div className="tabular-nums font-semibold text-slate-900">{pct.toFixed(0)}%</div>
          </div>

          {/* Barra de progresso */}
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label="Progresso do backup"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                job.status === 'erro' || job.status === 'cancelado'
                  ? 'bg-red-500'
                  : job.status === 'concluido'
                    ? 'bg-emerald-500'
                    : 'bg-brand-600'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Detalhes */}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-4">
            <div>Tabelas: <span className="tabular-nums text-slate-700">{job.tabelasConcluidas}/{job.tabelasTotal || '—'}</span></div>
            <div>Tamanho: <span className="tabular-nums text-slate-700">{fmtBytes(job.bytes)}</span></div>
            <div>Tempo: <span className="tabular-nums text-slate-700">{fmtDuracao(decorrido)}</span></div>
            {ativo && job.tabelaAtual && (
              <div className="col-span-2 truncate sm:col-span-1" title={job.tabelaAtual}>
                Atual: <span className="font-mono text-slate-700">{job.tabelaAtual.replace(/^public\./, '')}</span>
              </div>
            )}
          </div>

          {job.status === 'erro' && job.erro && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-200">{job.erro}</p>
          )}

          {job.status === 'concluido' && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="btn-outline btn-sm" onClick={() => baixar(job)}>
                <Download size={14} /> Baixar arquivo
              </button>
              <button className="btn-ghost btn-sm text-slate-500 hover:text-red-600" onClick={descartar}>
                <Trash2 size={14} /> Descartar do servidor
              </button>
              <span className="text-xs text-slate-400">
                <span className="font-mono">{job.nomeArquivo}</span>
                {expiraEm && <> · disponível até {expiraEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>}
              </span>
            </div>
          )}

          {ativo && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">Você pode sair desta tela; o backup continua no servidor.</span>
              <button className="btn-ghost btn-sm text-slate-500 hover:text-red-600" onClick={descartar}>Cancelar</button>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Para restaurar: <span className="font-mono">pg_restore --no-owner -d &lt;banco&gt; arquivo.dump</span>
      </p>
    </div>
  );
}
