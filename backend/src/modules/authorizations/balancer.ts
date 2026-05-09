import { Prisma, PrismaClient } from '@prisma/client';

export interface ExameSolicitado {
  procedureId: number;
  qtd: number;
}

interface CandidatoCp {
  contractProcedureId: number;
  qtdMensal: number;
  consumido: number;
  saldo: number;
  procedureId: number;
}

export interface PlanoEmissao {
  autorizacoes: Array<{
    contractId: number;
    laboratoryId: number;
    items: Array<{ procedureId: number; qtd: number; contractProcedureId: number; valorUnitario: number }>;
  }>;
  pendentes: Array<{ procedureId: number; qtd: number; motivo: 'SEM_SALDO' | 'SEM_CONTRATO' }>;
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Carrega para o mês corrente todos os contratos ativos vigentes,
 * com saldo (qtd_mensal - qtd_consumida) por contract_procedure.
 * Retorna estrutura indexada por laboratório.
 */
export async function carregarSaldos(tx: Tx, ano: number, mes: number) {
  const hoje = new Date();
  const contratos = await tx.contract.findMany({
    where: { ativo: true, vigenciaInicio: { lte: hoje }, vigenciaFim: { gte: hoje }, laboratory: { ativo: true } },
    include: {
      procedures: {
        where: { ativo: true },
        include: {
          monthlyBalances: { where: { ano, mes } },
        },
      },
    },
  });

  // garante balance row de mês corrente para os pares ativos
  for (const c of contratos) {
    for (const cp of c.procedures) {
      if (cp.monthlyBalances.length === 0) {
        const created = await tx.contractMonthlyBalance.create({
          data: { contractProcedureId: cp.id, ano, mes, qtdConsumida: 0 },
        });
        cp.monthlyBalances = [created];
      }
    }
  }

  return contratos.map((c) => ({
    contractId: c.id,
    laboratoryId: c.laboratoryId,
    procedimentos: c.procedures.map<CandidatoCp>((cp) => ({
      contractProcedureId: cp.id,
      qtdMensal: cp.qtdMensal,
      consumido: cp.monthlyBalances[0]?.qtdConsumida ?? 0,
      saldo: cp.qtdMensal - (cp.monthlyBalances[0]?.qtdConsumida ?? 0),
      procedureId: cp.procedureId,
    })),
  }));
}

/**
 * Regra de negócio:
 * 1. Procura um laboratório que cubra TODOS os exames — usa o de menor índice de consumo.
 * 2. Se nenhum cobrir tudo, usa o melhor lab único (maior cobertura; desempate: menor índice).
 *    Os exames não cobertos viram PendingItem (SEM_SALDO) e o operador é avisado.
 * 3. Se nenhum lab tiver qualquer cobertura, todos viram PendingItem (SEM_CONTRATO).
 *
 * Nunca divide a autorização entre laboratórios diferentes.
 */
export function planejar(
  contratos: Awaited<ReturnType<typeof carregarSaldos>>,
  exames: ExameSolicitado[],
): PlanoEmissao {
  const plano: PlanoEmissao = { autorizacoes: [], pendentes: [] };

  // 1. Laboratório que cobre todos os exames
  const completosElegiveis = contratos
    .map((c) => {
      const items: PlanoEmissao['autorizacoes'][number]['items'] = [];
      for (const ex of exames) {
        const cp = c.procedimentos.find((p) => p.procedureId === ex.procedureId);
        if (!cp || cp.saldo < ex.qtd) return null;
        items.push({ procedureId: ex.procedureId, qtd: ex.qtd, contractProcedureId: cp.contractProcedureId, valorUnitario: 0 });
      }
      return { contrato: c, items, indice: indiceConsumo(c, items) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (completosElegiveis.length > 0) {
    completosElegiveis.sort((a, b) => a.indice - b.indice);
    const escolhido = completosElegiveis[0];
    plano.autorizacoes.push({
      contractId: escolhido.contrato.contractId,
      laboratoryId: escolhido.contrato.laboratoryId,
      items: escolhido.items,
    });
    return plano;
  }

  // 2. Nenhum lab cobre tudo: melhor lab único por cobertura parcial
  let melhor: {
    contrato: typeof contratos[number];
    items: PlanoEmissao['autorizacoes'][number]['items'];
    cobertosIds: Set<number>;
    indice: number;
  } | null = null;

  for (const c of contratos) {
    const items: PlanoEmissao['autorizacoes'][number]['items'] = [];
    const cobertosIds = new Set<number>();
    for (const ex of exames) {
      const cp = c.procedimentos.find((p) => p.procedureId === ex.procedureId);
      if (cp && cp.saldo >= ex.qtd) {
        cobertosIds.add(ex.procedureId);
        items.push({ procedureId: ex.procedureId, qtd: ex.qtd, contractProcedureId: cp.contractProcedureId, valorUnitario: 0 });
      }
    }
    if (cobertosIds.size === 0) continue;
    const indice = indiceConsumo(c, items);
    if (!melhor || cobertosIds.size > melhor.cobertosIds.size || (cobertosIds.size === melhor.cobertosIds.size && indice < melhor.indice)) {
      melhor = { contrato: c, items, cobertosIds, indice };
    }
  }

  if (melhor) {
    plano.autorizacoes.push({
      contractId: melhor.contrato.contractId,
      laboratoryId: melhor.contrato.laboratoryId,
      items: melhor.items,
    });
    for (const ex of exames) {
      if (!melhor.cobertosIds.has(ex.procedureId)) {
        plano.pendentes.push({ procedureId: ex.procedureId, qtd: ex.qtd, motivo: 'SEM_SALDO' });
      }
    }
  } else {
    for (const ex of exames) {
      plano.pendentes.push({ procedureId: ex.procedureId, qtd: ex.qtd, motivo: 'SEM_CONTRATO' });
    }
  }

  return plano;
}

function indiceConsumo(
  contrato: Awaited<ReturnType<typeof carregarSaldos>>[number],
  items: PlanoEmissao['autorizacoes'][number]['items'],
): number {
  let acc = 0;
  for (const it of items) {
    const cp = contrato.procedimentos.find((p) => p.contractProcedureId === it.contractProcedureId);
    if (!cp || cp.qtdMensal === 0) continue;
    acc += (cp.consumido + it.qtd) / cp.qtdMensal;
  }
  return acc / Math.max(items.length, 1);
}

export function gerarCodigoAutorizacao(seq: number): string {
  const stamp = new Date();
  const yy = String(stamp.getFullYear()).slice(-2);
  const mm = String(stamp.getMonth() + 1).padStart(2, '0');
  const dd = String(stamp.getDate()).padStart(2, '0');
  return `A${yy}${mm}${dd}-${String(seq).padStart(5, '0')}`;
}

export const _internal = { Prisma };
