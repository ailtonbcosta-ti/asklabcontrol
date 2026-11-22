import { Router } from 'express';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';

export const reportsRouter = Router();
reportsRouter.use(authRequired, requireRole(Role.ADMIN, Role.GESTOR));

// ── Datas ────────────────────────────────────────────────────────────────────
// O servidor roda no fuso local (TZ do container) e o saldo mensal usa
// getFullYear()/getMonth() locais. Os relatórios seguem a mesma regra: um dia
// ou mês vai da meia-noite local até a meia-noite local seguinte.
const TZ = process.env.TZ || 'America/Sao_Paulo';

function diaLocal(iso: string, fimDoDia = false): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new HttpError(400, `Data inválida: ${iso}`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (fimDoDia) d.setDate(d.getDate() + 1); // exclusivo
  return d;
}

/** [início, fim) em horário local a partir de ?from&to (padrão: últimos 30 dias). */
function intervalo(query: any) {
  const hoje = new Date();
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const to = query.to ? String(query.to) : isoHoje;
  const from = query.from
    ? String(query.from)
    : (() => { const d = diaLocal(to); d.setDate(d.getDate() - 29); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const inicio = diaLocal(from);
  const fim = diaLocal(to, true);
  if (fim <= inicio) throw new HttpError(400, 'Período inválido');
  return { inicio, fim };
}

/** Datas de vigência são gravadas como meia-noite UTC do dia — converte para o dia local. */
const vigenciaLocal = (d: Date, fimDoDia = false) => {
  const r = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (fimDoDia) r.setDate(r.getDate() + 1);
  return r;
};

const DIA_MS = 86_400_000;
const MES_MEDIO_DIAS = 365.25 / 12;

/** Nº de meses da vigência (arredondado): 01/01–31/12 = 12; 15/03–14/03 = 12. */
function mesesVigencia(ini: Date, fim: Date) {
  const dias = Math.round((vigenciaLocal(fim, true).getTime() - vigenciaLocal(ini).getTime()) / DIA_MS);
  return Math.max(1, Math.round(dias / MES_MEDIO_DIAS));
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const optId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Visão geral ──────────────────────────────────────────────────────────────
reportsRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const { inicio, fim } = intervalo(req.query);
    const labId = optId(req.query.laboratoryId) ?? 0;

    const [authsByLab, authsByDay, topProcedures, totais] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT l."razaoSocial" AS laboratorio, l.id AS laboratory_id, COUNT(*)::int AS total
          FROM authorizations a
          JOIN laboratories l ON l.id = a."laboratoryId"
         WHERE a."emitidaEm" >= ${inicio} AND a."emitidaEm" < ${fim}
           AND a.status <> 'CANCELADA'
           AND (${labId}::int = 0 OR a."laboratoryId" = ${labId}::int)
         GROUP BY l.id, l."razaoSocial"
         ORDER BY total DESC`,
      prisma.$queryRaw<any[]>`
        SELECT TO_CHAR(date_trunc('day', (a."emitidaEm" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS dia,
               COUNT(*)::int AS total
          FROM authorizations a
         WHERE a."emitidaEm" >= ${inicio} AND a."emitidaEm" < ${fim}
           AND a.status <> 'CANCELADA'
           AND (${labId}::int = 0 OR a."laboratoryId" = ${labId}::int)
         GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<any[]>`
        SELECT p.codigo, p.descricao, SUM(ai.qtd)::int AS total_qtd, COUNT(DISTINCT a.id)::int AS total_auths
          FROM authorization_items ai
          JOIN authorizations a ON a.id = ai."authorizationId"
          JOIN procedures p ON p.id = ai."procedureId"
         WHERE a."emitidaEm" >= ${inicio} AND a."emitidaEm" < ${fim}
           AND a.status <> 'CANCELADA'
           AND (${labId}::int = 0 OR a."laboratoryId" = ${labId}::int)
         GROUP BY p.id, p.codigo, p.descricao
         ORDER BY total_qtd DESC
         LIMIT 15`,
      prisma.$queryRaw<any[]>`
        SELECT COUNT(DISTINCT a.id)::int AS autorizacoes,
               COALESCE(SUM(ai.qtd), 0)::int AS exames,
               COALESCE(SUM(ai.qtd * COALESCE(NULLIF(ai."valorUnitarioSnapshot", 0), cpv."valorUnitario")), 0)::float AS valor,
               COUNT(DISTINCT a."patientId")::int AS pacientes
          FROM authorizations a
          LEFT JOIN authorization_items ai ON ai."authorizationId" = a.id
          LEFT JOIN contract_procedures cpv ON cpv.id = ai."contractProcedureId"
         WHERE a."emitidaEm" >= ${inicio} AND a."emitidaEm" < ${fim}
           AND a.status <> 'CANCELADA'
           AND (${labId}::int = 0 OR a."laboratoryId" = ${labId}::int)`,
    ]);

    const t = totais[0] ?? {};
    res.json({
      authsByLab,
      authsByDay,
      topProcedures,
      totalAuths: t.autorizacoes ?? 0,
      totalExames: t.exames ?? 0,
      valorTotal: r2(t.valor ?? 0),
      pacientes: t.pacientes ?? 0,
    });
  }),
);

// ── Saldo dos contratos ──────────────────────────────────────────────────────
// modo=vigencia (padrão): contratado = cota mensal × meses da vigência;
//                         consumido = itens autorizados (não cancelados) dentro da vigência.
// modo=mes:               contratado = cota mensal; consumido = itens autorizados no mês.
reportsRouter.get(
  '/contract-balance',
  ah(async (req, res) => {
    const modo = req.query.modo === 'mes' ? 'mes' : 'vigencia';
    const labId = optId(req.query.laboratoryId);
    const contractId = optId(req.query.contractId);
    const procedureId = optId(req.query.procedureId);
    const situacao = req.query.situacao === 'todos' ? 'todos' : 'vigentes';

    const hoje = new Date();
    let mesInicio: Date | null = null;
    let mesFim: Date | null = null;
    let ano = 0, mes = 0;
    if (modo === 'mes') {
      ano = num(req.query.ano) || hoje.getFullYear();
      mes = num(req.query.mes) || hoje.getMonth() + 1;
      if (mes < 1 || mes > 12) throw new HttpError(400, 'Mês inválido');
      mesInicio = new Date(ano, mes - 1, 1);
      mesFim = new Date(ano, mes, 1);
    }

    const where: Prisma.ContractWhereInput = { ativo: true };
    if (labId) where.laboratoryId = labId;
    if (contractId) where.id = contractId;
    if (modo === 'mes') {
      // vigência que toca o mês (datas de vigência em UTC-meia-noite → compara por dia)
      where.vigenciaInicio = { lt: new Date(Date.UTC(ano, mes, 1)) };
      where.vigenciaFim = { gte: new Date(Date.UTC(ano, mes - 1, 1)) };
    } else if (situacao === 'vigentes' && !contractId) {
      const hojeUTC = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
      where.vigenciaInicio = { lte: hojeUTC };
      where.vigenciaFim = { gte: hojeUTC };
    }

    const contratos = await prisma.contract.findMany({
      where,
      include: {
        laboratory: { select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true } },
        procedures: {
          where: procedureId ? { procedureId } : undefined,
          include: { procedure: { select: { id: true, codigo: true, descricao: true } } },
        },
      },
      orderBy: [{ laboratory: { razaoSocial: 'asc' } }, { vigenciaInicio: 'desc' }],
    });

    // consumo por item de contrato, no intervalo de cada contrato
    const consumos = await Promise.all(
      contratos.map((c) => {
        const ini = modo === 'mes' ? mesInicio! : vigenciaLocal(c.vigenciaInicio);
        const fim = modo === 'mes' ? mesFim! : vigenciaLocal(c.vigenciaFim, true);
        return prisma.$queryRaw<{ cp: number; qtd: number; valor: number; autorizacoes: number }[]>`
          SELECT ai."contractProcedureId" AS cp,
                 SUM(ai.qtd)::int AS qtd,
                 SUM(ai.qtd * COALESCE(NULLIF(ai."valorUnitarioSnapshot", 0), cpv."valorUnitario"))::float AS valor,
                 COUNT(DISTINCT a.id)::int AS autorizacoes
            FROM authorization_items ai
            JOIN authorizations a ON a.id = ai."authorizationId"
            JOIN contract_procedures cpv ON cpv.id = ai."contractProcedureId"
           WHERE cpv."contractId" = ${c.id}
             AND a.status <> 'CANCELADA'
             AND a."emitidaEm" >= ${ini} AND a."emitidaEm" < ${fim}
           GROUP BY 1`;
      }),
    );

    type Totais = {
      contratado: number; consumido: number; saldo: number;
      valorContratado: number; valorConsumido: number; valorSaldo: number;
      itens: number; criticos: number; esgotados: number;
    };
    const zero = (): Totais => ({ contratado: 0, consumido: 0, saldo: 0, valorContratado: 0, valorConsumido: 0, valorSaldo: 0, itens: 0, criticos: 0, esgotados: 0 });
    const somar = (a: Totais, b: Totais) => {
      for (const k of Object.keys(a) as (keyof Totais)[]) a[k] += b[k];
    };
    const fechar = (t: Totais) => ({
      ...t,
      valorContratado: r2(t.valorContratado),
      valorConsumido: r2(t.valorConsumido),
      valorSaldo: r2(t.valorSaldo),
      pctConsumido: t.contratado > 0 ? r2((t.consumido / t.contratado) * 100) : 0,
    });

    const porLab = new Map<number, any>();
    const geral = zero();
    const hojeMs = hoje.getTime();

    contratos.forEach((c, idx) => {
      const mapa = new Map(consumos[idx].map((r) => [r.cp, r]));
      const meses = modo === 'mes' ? 1 : mesesVigencia(c.vigenciaInicio, c.vigenciaFim);
      const vIni = vigenciaLocal(c.vigenciaInicio).getTime();
      const vFim = vigenciaLocal(c.vigenciaFim, true).getTime();
      const pctPrazo = modo === 'vigencia'
        ? r2(Math.min(100, Math.max(0, ((hojeMs - vIni) / (vFim - vIni)) * 100)))
        : null;

      const tc = zero();
      const itens = c.procedures
        .map((cp) => {
          const cons = mapa.get(cp.id);
          const consumido = cons?.qtd ?? 0;
          // item inativo só aparece se tiver consumo no período (para os totais fecharem)
          if (!cp.ativo && consumido === 0) return null;
          const contratado = cp.ativo ? cp.qtdMensal * meses : 0;
          const valorUnit = Number(cp.valorUnitario);
          const saldo = contratado - consumido;
          const pct = contratado > 0 ? (consumido / contratado) * 100 : consumido > 0 ? 100 : 0;
          const t: Totais = {
            contratado, consumido, saldo,
            valorContratado: contratado * valorUnit,
            valorConsumido: cons?.valor ?? 0,
            valorSaldo: saldo * valorUnit,
            itens: 1,
            criticos: pct >= 80 && saldo > 0 ? 1 : 0,
            esgotados: saldo <= 0 && contratado > 0 ? 1 : 0,
          };
          somar(tc, t);
          return {
            contractProcedureId: cp.id,
            procedureId: cp.procedureId,
            codigo: cp.procedure.codigo,
            descricao: cp.procedure.descricao,
            ativo: cp.ativo,
            qtdMensal: cp.qtdMensal,
            valorUnitario: valorUnit,
            meses,
            contratado,
            consumido,
            saldo,
            pctConsumido: r2(pct),
            autorizacoes: cons?.autorizacoes ?? 0,
            valorContratado: r2(t.valorContratado),
            valorConsumido: r2(t.valorConsumido),
            valorSaldo: r2(t.valorSaldo),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));

      if (itens.length === 0) return;

      const vigente = vIni <= hojeMs && hojeMs < vFim;
      const contrato = {
        contractId: c.id,
        numero: c.numero,
        numeroCredenciamento: c.numeroCredenciamento,
        vigenciaInicio: c.vigenciaInicio,
        vigenciaFim: c.vigenciaFim,
        vigente,
        meses,
        mesesVigencia: mesesVigencia(c.vigenciaInicio, c.vigenciaFim),
        pctPrazo,
        totais: fechar(tc),
        itens,
      };

      let lab = porLab.get(c.laboratoryId);
      if (!lab) {
        lab = {
          laboratoryId: c.laboratoryId,
          laboratorio: c.laboratory.razaoSocial,
          nomeFantasia: c.laboratory.nomeFantasia,
          cnpj: c.laboratory.cnpj,
          _t: zero(),
          contratos: [] as any[],
        };
        porLab.set(c.laboratoryId, lab);
      }
      lab.contratos.push(contrato);
      somar(lab._t, tc);
      somar(geral, tc);
    });

    const laboratorios = [...porLab.values()].map(({ _t, ...l }) => ({ ...l, totais: fechar(_t) }));

    res.json({
      modo,
      periodo: modo === 'mes' ? { ano, mes } : null,
      situacao,
      geradoEm: new Date(),
      totais: fechar(geral),
      laboratorios,
    });
  }),
);

// ── Emissões ─────────────────────────────────────────────────────────────────
const GROUPS = ['day', 'week', 'month', 'lab', 'procedure', 'detalhado'] as const;

reportsRouter.get(
  '/issued',
  ah(async (req, res) => {
    const { inicio, fim } = intervalo(req.query);
    const groupBy = (GROUPS as readonly string[]).includes(String(req.query.groupBy)) ? String(req.query.groupBy) : 'day';
    const labId = optId(req.query.laboratoryId) ?? 0;
    const procedureId = optId(req.query.procedureId) ?? 0;
    const incluirCanceladas = String(req.query.incluirCanceladas) === '1';

    const filtro = Prisma.sql`
      a."emitidaEm" >= ${inicio} AND a."emitidaEm" < ${fim}
      AND (${incluirCanceladas} OR a.status <> 'CANCELADA')
      AND (${labId}::int = 0 OR a."laboratoryId" = ${labId}::int)
      AND (${procedureId}::int = 0 OR ai."procedureId" = ${procedureId}::int)`;

    const totaisQ = prisma.$queryRaw<any[]>`
      SELECT COUNT(DISTINCT a.id)::int AS autorizacoes,
             COALESCE(SUM(ai.qtd), 0)::int AS exames,
             COALESCE(SUM(ai.qtd * COALESCE(NULLIF(ai."valorUnitarioSnapshot", 0), cpv."valorUnitario")), 0)::float AS valor,
             COUNT(DISTINCT a."patientId")::int AS pacientes
        FROM authorizations a
        JOIN authorization_items ai ON ai."authorizationId" = a.id
        JOIN contract_procedures cpv ON cpv.id = ai."contractProcedureId"
       WHERE ${filtro}`;

    let rowsQ: Promise<any[]>;
    if (groupBy === 'day' || groupBy === 'week' || groupBy === 'month') {
      const trunc = Prisma.raw(`'${groupBy}'`); // whitelist acima
      rowsQ = prisma.$queryRaw<any[]>`
        SELECT TO_CHAR(date_trunc(${trunc}, (a."emitidaEm" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS bucket,
               a."laboratoryId" AS laboratory_id,
               l."razaoSocial" AS laboratorio,
               COUNT(DISTINCT a.id)::int AS autorizacoes,
               SUM(ai.qtd)::int AS exames,
               SUM(ai.qtd * COALESCE(NULLIF(ai."valorUnitarioSnapshot", 0), cpv."valorUnitario"))::float AS valor
          FROM authorizations a
          JOIN authorization_items ai ON ai."authorizationId" = a.id
          JOIN contract_procedures cpv ON cpv.id = ai."contractProcedureId"
          JOIN laboratories l ON l.id = a."laboratoryId"
         WHERE ${filtro}
         GROUP BY 1, 2, 3
         ORDER BY 1, 3`;
    } else if (groupBy === 'lab') {
      rowsQ = prisma.$queryRaw<any[]>`
        SELECT a."laboratoryId" AS laboratory_id,
               l."razaoSocial" AS laboratorio,
               COUNT(DISTINCT a.id)::int AS autorizacoes,
               SUM(ai.qtd)::int AS exames,
               SUM(ai.qtd * COALESCE(NULLIF(ai."valorUnitarioSnapshot", 0), cpv."valorUnitario"))::float AS valor,
               COUNT(DISTINCT a."patientId")::int AS pacientes
          FROM authorizations a
          JOIN authorization_items ai ON ai."authorizationId" = a.id
          JOIN contract_procedures cpv ON cpv.id = ai."contractProcedureId"
          JOIN laboratories l ON l.id = a."laboratoryId"
         WHERE ${filtro}
         GROUP BY 1, 2
         ORDER BY exames DESC`;
    } else if (groupBy === 'procedure') {
      rowsQ = prisma.$queryRaw<any[]>`
        SELECT p.id AS procedure_id, p.codigo, p.descricao,
               COUNT(DISTINCT a.id)::int AS autorizacoes,
               SUM(ai.qtd)::int AS exames,
               SUM(ai.qtd * COALESCE(NULLIF(ai."valorUnitarioSnapshot", 0), cpv."valorUnitario"))::float AS valor,
               COUNT(DISTINCT a."laboratoryId")::int AS laboratorios
          FROM authorizations a
          JOIN authorization_items ai ON ai."authorizationId" = a.id
          JOIN contract_procedures cpv ON cpv.id = ai."contractProcedureId"
          JOIN procedures p ON p.id = ai."procedureId"
         WHERE ${filtro}
         GROUP BY 1, 2, 3
         ORDER BY exames DESC, p.descricao`;
    } else {
      rowsQ = prisma.$queryRaw<any[]>`
        SELECT a.codigo, a."emitidaEm" AS emitida_em, a.status::text AS status,
               l."razaoSocial" AS laboratorio, pa.nome AS paciente,
               p.codigo AS proc_codigo, p.descricao AS proc_descricao,
               ai.qtd, (ai.qtd * COALESCE(NULLIF(ai."valorUnitarioSnapshot", 0), cpv."valorUnitario"))::float AS valor
          FROM authorizations a
          JOIN authorization_items ai ON ai."authorizationId" = a.id
          JOIN contract_procedures cpv ON cpv.id = ai."contractProcedureId"
          JOIN laboratories l ON l.id = a."laboratoryId"
          JOIN patients pa ON pa.id = a."patientId"
          JOIN procedures p ON p.id = ai."procedureId"
         WHERE ${filtro}
         ORDER BY a."emitidaEm" DESC, a.codigo
         LIMIT 5000`;
    }

    const [rows, totais] = await Promise.all([rowsQ, totaisQ]);
    const t = totais[0] ?? {};
    res.json({
      groupBy,
      rows: rows.map((r) => ('valor' in r ? { ...r, valor: r2(Number(r.valor) || 0) } : r)),
      totais: { autorizacoes: t.autorizacoes ?? 0, exames: t.exames ?? 0, valor: r2(t.valor ?? 0), pacientes: t.pacientes ?? 0 },
      truncado: groupBy === 'detalhado' && rows.length >= 5000,
    });
  }),
);

// ── Pendências ───────────────────────────────────────────────────────────────
reportsRouter.get(
  '/pending',
  ah(async (req, res) => {
    const motivo = req.query.motivo === 'SEM_SALDO' || req.query.motivo === 'SEM_CONTRATO' ? req.query.motivo : undefined;
    const procedureId = optId(req.query.procedureId);
    const list = await prisma.pendingItem.findMany({
      where: { resolvedAt: null, ...(motivo ? { motivo } : {}), ...(procedureId ? { procedureId } : {}) },
      include: {
        patient: { select: { id: true, nome: true, cpf: true, cns: true, telefone: true } },
        procedure: { select: { id: true, codigo: true, descricao: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    res.json(list);
  }),
);
