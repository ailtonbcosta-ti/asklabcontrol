import { Pool } from 'pg';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { decrypt } from '../../utils/crypto';

interface PoolEntry {
  pool: Pool;
  signature: string; // host|port|db|user|ssl
}

let cached: PoolEntry | null = null;

function makeSignature(c: { host: string; porta: number; database: string; usuario: string; sslMode: string }) {
  return [c.host, c.porta, c.database, c.usuario, c.sslMode].join('|');
}

async function getPool(): Promise<Pool | null> {
  try {
    const cfg = await prisma.pecConnection.findUnique({ where: { id: 1 } });
    if (!cfg || !cfg.ativo || !cfg.host || !cfg.database || !cfg.usuario || !cfg.senhaCriptografada) {
      if (cached) {
        try { await cached.pool.end(); } catch { /* ignore */ }
        cached = null;
      }
      return null;
    }
    const sig = makeSignature(cfg as any);
    if (cached && cached.signature === sig) return cached.pool;
    if (cached) {
      try { await cached.pool.end(); } catch { /* ignore */ }
    }
    const pool = new Pool({
      host: cfg.host!,
      port: cfg.porta,
      database: cfg.database!,
      user: cfg.usuario!,
      password: decrypt(cfg.senhaCriptografada!),
      ssl: cfg.sslMode !== 'disable' ? { rejectUnauthorized: false } : false,
      statement_timeout: 60_000,
      connectionTimeoutMillis: 15_000,
      max: 5,
    });
    pool.on('error', (e) => logger.warn({ err: e.message }, 'PEC pool error'));
    cached = { pool, signature: sig };
    return pool;
  } catch (e: any) {
    logger.error({ err: e.message }, 'Failed to initialize PEC pool');
    return null;
  }
}

export function invalidatePecPool() {
  if (cached) {
    cached.pool.end().catch(() => undefined);
    cached = null;
  }
}

export interface PecPaciente {
  cns: string | null;
  cpf: string | null;
  nome: string | null;
  dataNascimento: Date | null;
  sexo: string | null;
  raca: string | null;
  etnia: string | null;
  nacionalidade: string | null;
  municipioIbge: string | null;
  cep: string | null;
  logradouroCodigo: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  telefone: string | null;
  email: string | null;
  origem: 'CAD_INDIVIDUAL' | 'CIDADAO';
}

const SQL_CIDADAO = `
  SELECT cid.nu_cns AS cns, cid.nu_cpf AS cpf, cid.no_cidadao AS nome,
         cid.dt_nascimento AS data_nascimento, cid.no_sexo AS sexo,
         rc.nu_ms AS raca, et.co_etnia_cadsus AS etnia,
         CASE cid.co_nacionalidade WHEN '1' THEN '010' WHEN '2' THEN '020' WHEN '3' THEN '031' ELSE '010' END AS nacionalidade,
         SUBSTRING(loc.co_ibge FROM 1 FOR 6) AS ibge_municipio,
         cid.ds_cep AS cep, cid.ds_logradouro AS endereco, cid.nu_numero AS numero,
         cid.ds_complemento AS complemento, cid.no_bairro AS bairro,
         COALESCE(cid.nu_telefone_celular, cid.nu_telefone_contato, cid.nu_telefone_residencial) AS telefone,
         cid.ds_email AS email
    FROM tb_cidadao cid
    LEFT JOIN tb_raca_cor rc       ON rc.co_raca_cor      = cid.co_raca_cor
    LEFT JOIN tb_etnia et          ON et.co_etnia         = cid.co_etnia
    LEFT JOIN tb_localidade loc    ON loc.co_localidade   = cid.co_localidade_endereco
   WHERE ($1::text IS NULL OR cid.nu_cns = $1)
     AND ($2::text IS NULL OR cid.nu_cpf = $2)
   ORDER BY (CASE WHEN cid.ds_cep IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN cid.ds_logradouro IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN cid.no_bairro IS NOT NULL THEN 1 ELSE 0 END) DESC,
            cid.co_seq_cidadao DESC
   LIMIT 1
`;

const SQL_CAD_INDIVIDUAL = `
  SELECT ind.nu_cns_cidadao AS cns, ind.nu_cpf_cidadao AS cpf, ind.no_cidadao AS nome,
         ind.dt_nascimento AS data_nascimento, sx.sg_sexo AS sexo,
         rc.nu_ms AS raca, et.co_etnia_cadsus AS etnia,
         CASE ind.co_nacionalidade::text WHEN '1' THEN '010' WHEN '2' THEN '020' WHEN '3' THEN '031' ELSE '010' END AS nacionalidade,
         SUBSTRING(loc.co_ibge FROM 1 FOR 6) AS ibge_municipio,
         dom.nu_cep AS cep, tl.co_tp_logradouro_cadsus AS lograd_codigo,
         dom.no_logradouro AS endereco, dom.nu_domicilio AS numero,
         dom.ds_complemento AS complemento, dom.no_bairro AS bairro,
         ind.nu_celular_cidadao AS telefone, ind.ds_email_cidadao AS email
    FROM tb_cds_cad_individual ind
    LEFT JOIN tb_sexo sx     ON sx.co_sexo     = ind.co_sexo
    LEFT JOIN tb_raca_cor rc ON rc.co_raca_cor = ind.co_raca_cor
    LEFT JOIN tb_etnia et    ON et.co_etnia    = ind.co_etnia
    LEFT JOIN LATERAL (
      SELECT dom.* FROM tb_cds_domicilio_familia df
        JOIN tb_cds_cad_domiciliar dom ON dom.co_seq_cds_cad_domiciliar = df.co_cds_cad_domiciliar
       WHERE dom.st_versao_atual = 1
         AND ( df.nu_cartao_sus = ind.nu_cns_cidadao
            OR (ind.nu_cpf_cidadao IS NOT NULL AND df.nu_cpf_cidadao = ind.nu_cpf_cidadao)
            OR df.nu_cartao_sus = ind.nu_cartao_sus_responsavel
            OR (ind.nu_cpf_responsavel IS NOT NULL AND df.nu_cpf_cidadao = ind.nu_cpf_responsavel) )
       ORDER BY dom.dt_cad_domiciliar DESC LIMIT 1
    ) dom ON TRUE
    LEFT JOIN tb_tipo_logradouro tl ON tl.co_tipo_logradouro = dom.tp_logradouro
    LEFT JOIN tb_localidade loc     ON loc.co_localidade     = dom.co_localidade_origem
   WHERE ind.st_versao_atual = 1 AND ind.st_ficha_inativa = 0
     AND ($1::text IS NULL OR ind.nu_cns_cidadao = $1)
     AND ($2::text IS NULL OR ind.nu_cpf_cidadao = $2)
   ORDER BY ind.co_seq_cds_cad_individual DESC
   LIMIT 1
`;

// tb_cidadao.no_sexo retorna "MASCULINO"/"FEMININO"; tb_sexo.sg_sexo retorna "M"/"F".
// O schema tem sexo @db.Char(1), então normaliza sempre para 1 char.
function normalizeSexo(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (s.startsWith('M')) return 'M';
  if (s.startsWith('F')) return 'F';
  return s.slice(0, 1) || null;
}

function map(row: any, origem: 'CAD_INDIVIDUAL' | 'CIDADAO'): PecPaciente {
  return {
    cns: row.cns ?? null,
    cpf: row.cpf ?? null,
    nome: row.nome ?? null,
    dataNascimento: row.data_nascimento ? new Date(row.data_nascimento) : null,
    sexo: normalizeSexo(row.sexo),
    raca: row.raca ?? null,
    etnia: row.etnia ?? null,
    nacionalidade: row.nacionalidade ?? null,
    municipioIbge: row.ibge_municipio ?? null,
    cep: row.cep ?? null,
    logradouroCodigo: row.lograd_codigo ?? null,
    logradouro: row.endereco ?? null,
    numero: row.numero ?? null,
    complemento: row.complemento ?? null,
    bairro: row.bairro ?? null,
    telefone: row.telefone ?? null,
    email: row.email ?? null,
    origem,
  };
}

export async function buscarPaciente({ cns, cpf }: { cns?: string | null; cpf?: string | null }): Promise<PecPaciente | null> {
  const p = await getPool();
  if (!p) return null;
  if (!cns && !cpf) return null;
  try {
    const r1 = await p.query(SQL_CAD_INDIVIDUAL, [cns ?? null, cpf ?? null]);
    if (r1.rows[0]) return map(r1.rows[0], 'CAD_INDIVIDUAL');
    const r2 = await p.query(SQL_CIDADAO, [cns ?? null, cpf ?? null]);
    if (r2.rows[0]) return map(r2.rows[0], 'CIDADAO');
    return null;
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Falha consulta PEC');
    return null;
  }
}

export async function pecDisponivel(): Promise<boolean> {
  const p = await getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const TABELAS_PEC = [
  'tb_cidadao', 'tb_cds_cad_individual', 'tb_cds_cad_domiciliar',
  'tb_cds_domicilio_familia', 'tb_raca_cor', 'tb_etnia', 'tb_localidade', 'tb_tipo_logradouro',
];

/** Testa uma config arbitrária (sem persistir nem invalidar pool ativo). */
export async function testarConexao(opts: {
  host: string; porta: number; database: string; usuario: string; senha: string; sslMode: string; schemaName?: string;
}): Promise<{ ok: boolean; compativel?: boolean; mensagem: string; tabelasEncontradas?: number; faltando?: string[]; semPermissao?: string[] }> {
  const pool = new Pool({
    host: opts.host,
    port: opts.porta,
    database: opts.database,
    user: opts.usuario,
    password: opts.senha,
    ssl: opts.sslMode !== 'disable' ? { rejectUnauthorized: false } : false,
    statement_timeout: 15_000,
    connectionTimeoutMillis: 10_000,
    max: 1,
  });
  try {
    await pool.query('SELECT 1');
    const schema = opts.schemaName || 'public';
    const usuario = opts.usuario;

    // pg_catalog não filtra por permissão (ao contrário de information_schema):
    // diferencia "tabela ausente" de "sem permissão SELECT"
    const r = await pool.query(`
      SELECT t AS nome,
             to_regclass(format('%I.%I', $1::text, t)) IS NOT NULL AS existe,
             CASE WHEN to_regclass(format('%I.%I', $1::text, t)) IS NOT NULL
                  THEN has_table_privilege(format('%I.%I', $1::text, t), 'SELECT') END AS legivel
        FROM unnest($2::text[]) t
    `, [schema, TABELAS_PEC]);

    const usageOk = (await pool.query(`SELECT has_schema_privilege($1::text, 'USAGE') AS u`, [schema])).rows[0].u;

    const faltando     = r.rows.filter((x: any) => !x.existe).map((x: any) => x.nome);
    const semPermissao = r.rows.filter((x: any) => x.existe && !x.legivel).map((x: any) => x.nome);
    const legiveis     = r.rows.filter((x: any) => x.legivel === true).length;
    const compativel   = legiveis === TABELAS_PEC.length;

    let mensagem: string;
    if (compativel) {
      mensagem = `Conexão OK. ${legiveis}/${TABELAS_PEC.length} tabelas PEC acessíveis.`;
    } else if (!usageOk) {
      mensagem = `O usuário "${usuario}" não tem acesso (USAGE) ao schema "${schema}". `
        + `Execute no banco do PEC: GRANT USAGE ON SCHEMA "${schema}" TO "${usuario}";`;
    } else if (semPermissao.length && !faltando.length) {
      mensagem = `As tabelas existem, mas "${usuario}" não tem SELECT em: ${semPermissao.join(', ')}. `
        + `Execute: GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${usuario}";`;
    } else if (faltando.length && !semPermissao.length) {
      mensagem = `Estrutura incompatível: tabelas não encontradas no schema "${schema}": ${faltando.join(', ')}.`;
    } else {
      mensagem = `Estrutura/permissões incompletas no schema "${schema}".`
        + (faltando.length ? ` Ausentes: ${faltando.join(', ')}.` : '')
        + (semPermissao.length ? ` Sem SELECT para "${usuario}": ${semPermissao.join(', ')}.` : '');
    }

    // Aviso não-bloqueante: monitora se Cadastro Individual está recebendo dados
    if (compativel) {
      try {
        const fr = await pool.query(`
          SELECT (now()::date - max(dt_cad_individual)::date) AS dias
            FROM tb_cds_cad_individual
        `);
        const dias = fr.rows[0]?.dias;
        if (dias != null && dias > 90) {
          mensagem += ` ⚠ Cadastro Individual sem novos registros há ${dias} dias — endereços podem estar desatualizados.`;
        }
      } catch { /* probe informativo */ }
    }

    return { ok: true, compativel, mensagem, tabelasEncontradas: legiveis, faltando, semPermissao };
  } catch (e: any) {
    return { ok: false, mensagem: e.message };
  } finally {
    await pool.end().catch(() => undefined);
  }
}
