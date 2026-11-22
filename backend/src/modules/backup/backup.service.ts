import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

// Fora de UPLOAD_DIR (que tem parte servida publicamente) e com permissão restrita.
export const BACKUP_DIR = path.join(os.tmpdir(), 'asklab-backups');

const EXPIRA_MS = 30 * 60_000; // arquivo pronto fica disponível por 30 min
const TIMEOUT_MS = 60 * 60_000; // aborta pg_dump após 1h
const PESO_MIN = 8192; // tabelas vazias também contam um pouco no progresso

export type BackupStatus = 'preparando' | 'executando' | 'concluido' | 'erro' | 'cancelado';

export interface BackupJob {
  id: string;
  userId: number;
  status: BackupStatus;
  progresso: number; // 0..100
  fase: string;
  tabelaAtual: string | null;
  tabelasConcluidas: number;
  tabelasTotal: number;
  bytes: number;
  arquivo: string;
  nomeArquivo: string;
  iniciadoEm: Date;
  finalizadoEm: Date | null;
  erro: string | null;
  downloadToken: string | null;
  proc?: ChildProcess;
  timers: NodeJS.Timeout[];
}

const jobs = new Map<string, BackupJob>();

export function limparDiretorioNaInicializacao() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* ignore */ }
    }
  } catch (err) {
    logger.warn({ err }, 'Não foi possível preparar o diretório de backups');
  }
}

export function publicJob(j: BackupJob) {
  return {
    id: j.id,
    status: j.status,
    progresso: Math.round(j.progresso * 10) / 10,
    fase: j.fase,
    tabelaAtual: j.tabelaAtual,
    tabelasConcluidas: j.tabelasConcluidas,
    tabelasTotal: j.tabelasTotal,
    bytes: j.bytes,
    nomeArquivo: j.nomeArquivo,
    iniciadoEm: j.iniciadoEm,
    finalizadoEm: j.finalizadoEm,
    erro: j.erro,
    downloadToken: j.downloadToken,
  };
}

export function getJob(id: string) {
  return jobs.get(id) ?? null;
}

export function jobAtualDoUsuario(userId: number) {
  const meus = [...jobs.values()].filter((j) => j.userId === userId);
  meus.sort((a, b) => b.iniciadoEm.getTime() - a.iniciadoEm.getTime());
  return meus[0] ?? null;
}

export function jobEmAndamento() {
  return [...jobs.values()].find((j) => j.status === 'preparando' || j.status === 'executando') ?? null;
}

export function descartarJob(j: BackupJob) {
  for (const t of j.timers) clearTimeout(t);
  if (j.proc && j.proc.exitCode === null) {
    j.status = 'cancelado';
    j.fase = 'Cancelado pelo usuário';
    j.proc.kill('SIGTERM');
  }
  try { fs.unlinkSync(j.arquivo); } catch { /* ignore */ }
  jobs.delete(j.id);
}

/** Converte DATABASE_URL (formato Prisma) em argumentos/variáveis do pg_dump. */
function conexaoPg() {
  const u = new URL(env.DATABASE_URL);
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const pgEnv: Record<string, string> = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: dbName,
    PGCONNECT_TIMEOUT: '15',
  };
  const ssl = u.searchParams.get('sslmode');
  if (ssl) pgEnv.PGSSLMODE = ssl;
  return { dbName, pgEnv };
}

function carimbo(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function iniciarBackup(userId: number): Promise<BackupJob> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const { dbName, pgEnv } = conexaoPg();
  const id = crypto.randomUUID();
  const nomeArquivo = `asklab_${dbName.replace(/[^A-Za-z0-9_-]/g, '')}_${carimbo()}.dump`;

  const job: BackupJob = {
    id,
    userId,
    status: 'preparando',
    progresso: 0,
    fase: 'Calculando tamanho das tabelas…',
    tabelaAtual: null,
    tabelasConcluidas: 0,
    tabelasTotal: 0,
    bytes: 0,
    arquivo: path.join(BACKUP_DIR, `${id}.dump`),
    nomeArquivo,
    iniciadoEm: new Date(),
    finalizadoEm: null,
    erro: null,
    downloadToken: null,
    timers: [],
  };
  jobs.set(id, job);

  // Pesos por tabela (tamanho em disco) para um progresso proporcional ao volume real.
  const rows = await prisma.$queryRaw<{ nome: string; tamanho: bigint }[]>`
    SELECT n.nspname || '.' || c.relname AS nome, pg_total_relation_size(c.oid) AS tamanho
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg_toast%'`;
  const pesos = new Map<string, number>();
  for (const r of rows) pesos.set(r.nome, Math.max(Number(r.tamanho), PESO_MIN));
  const pesoTotal = [...pesos.values()].reduce((a, b) => a + b, 0) || 1;
  job.tabelasTotal = pesos.size;

  // 0–5%: preparação · 5–10%: leitura da estrutura · 10–98%: dados · 100%: concluído
  job.status = 'executando';
  job.progresso = 5;
  job.fase = 'Lendo estrutura do banco…';

  // Banco inteiro (sem --schema): com --schema=public o dump inclui "CREATE SCHEMA public",
  // que gera erro ao restaurar num banco novo.
  const args = ['--format=custom', '--compress=6', '--verbose', '--no-owner', '--no-privileges', `--file=${job.arquivo}`];
  const proc = spawn('pg_dump', args, {
    env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', ...pgEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  job.proc = proc;

  let pesoConcluido = 0;
  let pesoAtual = 0;
  let stderrTail = '';
  let buffer = '';

  const avancarTabela = (nome: string | null) => {
    if (job.tabelaAtual) {
      pesoConcluido += pesoAtual;
      job.tabelasConcluidas++;
    }
    job.tabelaAtual = nome;
    pesoAtual = nome ? pesos.get(nome) ?? PESO_MIN : 0;
    job.progresso = Math.min(98, 10 + (88 * pesoConcluido) / pesoTotal);
  };

  proc.stderr!.on('data', (chunk: Buffer) => {
    const txt = chunk.toString('utf8');
    stderrTail = (stderrTail + txt).slice(-4000);
    buffer += txt;
    const linhas = buffer.split('\n');
    buffer = linhas.pop() || '';
    for (const linha of linhas) {
      // pg_dump: dumping contents of table "public.users"
      const m = linha.match(/dumping contents of table "?([^"\s]+)"?/i);
      if (m) {
        avancarTabela(m[1]);
        job.fase = 'Exportando dados';
      } else if (/reading|identifying|finding|flagging|saving/i.test(linha) && job.progresso < 10) {
        job.progresso = Math.min(10, job.progresso + 0.25);
      } else if (/creating|dumping|executing/i.test(linha) && !job.tabelaAtual && pesoConcluido > 0) {
        job.fase = 'Finalizando (índices e restrições)…';
      }
    }
  });

  // tamanho do arquivo gerado (feedback visual mesmo em tabelas grandes)
  const poll = setInterval(() => {
    fs.stat(job.arquivo, (err, st) => { if (!err) job.bytes = st.size; });
  }, 500);

  const timeout = setTimeout(() => {
    if (proc.exitCode === null) {
      job.erro = 'Tempo limite excedido (1h)';
      proc.kill('SIGTERM');
    }
  }, TIMEOUT_MS);
  timeout.unref();

  proc.on('error', (err: NodeJS.ErrnoException) => {
    clearInterval(poll);
    clearTimeout(timeout);
    job.status = 'erro';
    job.finalizadoEm = new Date();
    job.erro = err.code === 'ENOENT'
      ? 'pg_dump não está instalado no servidor'
      : `Falha ao iniciar pg_dump: ${err.message}`;
    job.fase = 'Erro';
    logger.error({ err }, 'Backup: falha ao iniciar pg_dump');
  });

  proc.on('close', (code) => {
    clearInterval(poll);
    clearTimeout(timeout);
    job.proc = undefined;
    job.finalizadoEm = new Date();
    if (job.status === 'cancelado' || job.status === 'erro') {
      try { fs.unlinkSync(job.arquivo); } catch { /* ignore */ }
      return;
    }
    if (code === 0) {
      avancarTabela(null);
      try { job.bytes = fs.statSync(job.arquivo).size; } catch { /* ignore */ }
      job.status = 'concluido';
      job.progresso = 100;
      job.fase = 'Backup concluído';
      job.downloadToken = crypto.randomBytes(32).toString('hex');
      const exp = setTimeout(() => descartarJob(job), EXPIRA_MS);
      exp.unref();
      job.timers.push(exp);
      logger.info({ id: job.id, bytes: job.bytes }, 'Backup concluído');
    } else {
      job.status = 'erro';
      job.fase = 'Erro';
      // última linha de erro do pg_dump, sem expor a senha (ela vai por variável de ambiente)
      const ultima = stderrTail.split('\n').filter((l) => /error|erro|fatal/i.test(l)).pop();
      job.erro = job.erro || ultima?.replace(/^pg_dump:\s*/, '').slice(0, 300) || `pg_dump terminou com código ${code}`;
      try { fs.unlinkSync(job.arquivo); } catch { /* ignore */ }
      logger.error({ id: job.id, code, stderr: stderrTail.slice(-1000) }, 'Backup falhou');
      // remove o registro com erro depois de um tempo
      const exp = setTimeout(() => jobs.delete(job.id), EXPIRA_MS);
      exp.unref();
      job.timers.push(exp);
    }
  });

  return job;
}

/** Valida o token de download (comparação em tempo constante). Vale até o arquivo expirar. */
export function tokenValido(job: BackupJob, token: unknown): boolean {
  if (job.status !== 'concluido' || !job.downloadToken || typeof token !== 'string') return false;
  const a = Buffer.from(job.downloadToken);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
