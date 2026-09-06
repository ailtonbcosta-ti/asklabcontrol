import { createPool, Pool } from 'mysql2/promise';
import { prisma } from '../../config/prisma';
import { decrypt } from '../../utils/crypto';

interface PoolEntry { pool: Pool; sig: string }
let cached: PoolEntry | null = null;

function sig(h: string, p: number, db: string, u: string) { return `${h}|${p}|${db}|${u}`; }

export async function getMysqlPool(): Promise<Pool | null> {
  const cfg = await prisma.bpaTerceirosConfig.findUnique({ where: { id: 1 } });
  if (!cfg?.ativo || !cfg.mysqlHost || !cfg.mysqlDatabase || !cfg.mysqlUsuario || !cfg.mysqlSenhaCriptografada) {
    if (cached) { try { await cached.pool.end(); } catch { /* ignore */ } cached = null; }
    return null;
  }
  const s = sig(cfg.mysqlHost, cfg.mysqlPort, cfg.mysqlDatabase, cfg.mysqlUsuario);
  if (cached?.sig === s) return cached.pool;
  if (cached) { try { await cached.pool.end(); } catch { /* ignore */ } }
  const pool = createPool({
    host: cfg.mysqlHost, port: cfg.mysqlPort, database: cfg.mysqlDatabase,
    user: cfg.mysqlUsuario, password: decrypt(cfg.mysqlSenhaCriptografada),
    waitForConnections: true, connectionLimit: 5, connectTimeout: 20_000, dateStrings: true,
  });
  cached = { pool, sig: s };
  return pool;
}

export function invalidateMysqlPool() {
  if (cached) { cached.pool.end().catch(() => undefined); cached = null; }
}

export interface TesteConexaoOpts {
  host: string; port: number; database: string; usuario: string; senha: string; viewName: string;
}

export async function testarConexaoMysql(opts: TesteConexaoOpts): Promise<{ ok: boolean; mensagem: string }> {
  const pool = createPool({
    host: opts.host, port: opts.port, database: opts.database,
    user: opts.usuario, password: opts.senha, connectionLimit: 1, connectTimeout: 15_000,
  });
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1`,
      [opts.database, opts.viewName],
    );
    if (!rows.length) {
      return { ok: false, mensagem: `Conexão OK, mas a view "${opts.viewName}" não foi encontrada no banco "${opts.database}".` };
    }
    const [[cnt]] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM \`${opts.viewName}\` LIMIT 0`);
    return { ok: true, mensagem: `Conexão OK. View "${opts.viewName}" acessível.` };
  } catch (e: any) {
    return { ok: false, mensagem: e.message };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function buscarAtendimentos(competencia: string) {
  const pool = await getMysqlPool();
  if (!pool) throw new Error('Conexão com o sistema terceiro não configurada ou inativa.');
  const cfg = await prisma.bpaTerceirosConfig.findUnique({ where: { id: 1 } });
  const view = cfg?.mysqlViewName || 'atendimentobpa';
  const ano = competencia.substring(0, 4);
  const mes = competencia.substring(4, 6);
  const inicio = `${ano}-${mes}-01 00:00:00`;
  const mesNum = parseInt(mes, 10);
  const anoProx = mesNum === 12 ? parseInt(ano, 10) + 1 : parseInt(ano, 10);
  const mesProx = mesNum === 12 ? 1 : mesNum + 1;
  const fim = `${String(anoProx).padStart(4, '0')}-${String(mesProx).padStart(2, '0')}-01 00:00:00`;
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM \`${view}\` WHERE dataAtendimento >= ? AND dataAtendimento < ?`,
    [inicio, fim],
  );
  return rows as any[];
}
