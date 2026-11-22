import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import multer from 'multer';
import { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, requireRole } from '../../middleware/auth';
import { onlyDigits } from '../../utils/cnpj';

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: env.UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

export const contractsRouter = Router();
contractsRouter.use(authRequired);

const contractSchema = z.object({
  numero: z.string().min(1),
  numeroCredenciamento: z.string().optional().nullable(),
  laboratoryId: z.number().int().positive(),
  vigenciaInicio: z.coerce.date(),
  vigenciaFim: z.coerce.date(),
  observacoes: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

contractsRouter.get('/', ah(async (_req, res) => {
  const list = await prisma.contract.findMany({
    orderBy: { vigenciaInicio: 'desc' },
    include: { laboratory: { select: { id: true, razaoSocial: true } }, _count: { select: { procedures: true } } },
  });
  res.json(list);
}));

contractsRouter.get('/:id', ah(async (req, res) => {
  const c = await prisma.contract.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      laboratory: true,
      procedures: { include: { procedure: true } },
      renewals: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!c) throw new HttpError(404, 'Contrato não encontrado');
  res.json(c);
}));

contractsRouter.post('/', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const data = contractSchema.parse(req.body);
  res.status(201).json(await prisma.contract.create({ data }));
}));

contractsRouter.patch('/:id', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const data = contractSchema.partial().parse(req.body);
  res.json(await prisma.contract.update({ where: { id: Number(req.params.id) }, data }));
}));

contractsRouter.delete('/:id', requireRole(Role.ADMIN), ah(async (req, res) => {
  const id = Number(req.params.id);
  const usadas = await prisma.authorization.count({ where: { contractId: id } });
  if (usadas > 0) {
    // soft-delete: existem autorizações vinculadas
    await prisma.contract.update({ where: { id }, data: { ativo: false } });
    return res.json({ ok: true, soft: true, autorizacoesVinculadas: usadas });
  }
  // sem vínculos: hard-delete (cascade derruba contract_procedures + balances)
  await prisma.contract.delete({ where: { id } });
  res.json({ ok: true, soft: false });
}));

const cpSchema = z.object({
  procedureId: z.number().int().positive(),
  qtdMensal: z.number().int().positive(),
  valorUnitario: z.number().nonnegative().optional().default(0),
  ativo: z.boolean().optional(),
});

contractsRouter.post('/:id/procedures', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const contractId = Number(req.params.id);
  const data = cpSchema.parse(req.body);

  // Verifica se o procedimento já está cadastrado no contrato (ativo ou inativo)
  const existing = await prisma.contractProcedure.findFirst({
    where: {
      contractId,
      procedureId: data.procedureId
    }
  });

  let cp;
  if (existing) {
    // Se existir, atualiza suas propriedades e marca como ativo novamente
    cp = await prisma.contractProcedure.update({
      where: { id: existing.id },
      data: {
        qtdMensal: data.qtdMensal,
        valorUnitario: data.valorUnitario,
        ativo: true
      }
    });
  } else {
    // Se não existir, cria um novo registro
    cp = await prisma.contractProcedure.create({ data: { ...data, contractId } });
  }

  // cria saldo zerado para o mês atual já
  const now = new Date();
  await prisma.contractMonthlyBalance.upsert({
    where: { contractProcedureId_ano_mes: { contractProcedureId: cp.id, ano: now.getFullYear(), mes: now.getMonth() + 1 } },
    update: {},
    create: { contractProcedureId: cp.id, ano: now.getFullYear(), mes: now.getMonth() + 1, qtdConsumida: 0 },
  });
  res.status(201).json(cp);
}));

contractsRouter.patch('/:id/procedures/:cpId', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const data = cpSchema.partial().parse(req.body);
  res.json(await prisma.contractProcedure.update({ where: { id: Number(req.params.cpId) }, data }));
}));

contractsRouter.delete('/:id/procedures/:cpId', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const cpId = Number(req.params.cpId);
  try {
    await prisma.contractProcedure.delete({ where: { id: cpId } });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    await prisma.contractProcedure.update({ where: { id: cpId }, data: { ativo: false } });
    res.json({ ok: true, deleted: false });
  }
}));

// ─── Renovação ──────────────────────────────────────────
// Reaproveita o mesmo contrato (mesmo id, histórico de autorizações e saldos):
// troca a vigência e ajusta a lista de procedimentos (mantém/altera, inativa,
// reativa e adiciona). A situação anterior fica registrada em contract_renewals.
const renovarSchema = z
  .object({
    vigenciaInicio: z.coerce.date(),
    vigenciaFim: z.coerce.date(),
    numero: z.string().trim().min(1).optional(),
    numeroCredenciamento: z.string().trim().optional().nullable(),
    observacao: z.string().trim().max(1000).optional().nullable(),
    existentes: z.array(z.object({
      id: z.number().int().positive(),
      ativo: z.boolean(),
      qtdMensal: z.number().int().positive(),
      valorUnitario: z.number().nonnegative(),
    })),
    novos: z.array(z.object({
      procedureId: z.number().int().positive(),
      qtdMensal: z.number().int().positive(),
      valorUnitario: z.number().nonnegative(),
    })).default([]),
  })
  .refine((d) => d.vigenciaFim > d.vigenciaInicio, {
    message: 'O fim da vigência deve ser posterior ao início',
    path: ['vigenciaFim'],
  });

contractsRouter.post('/:id/renovar', requireRole(Role.ADMIN, Role.GESTOR), ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID inválido');
  const body = renovarSchema.parse(req.body);

  const atual = await prisma.contract.findUnique({
    where: { id },
    include: { procedures: { include: { procedure: { select: { codigo: true } } } } },
  });
  if (!atual) throw new HttpError(404, 'Contrato não encontrado');

  const porId = new Map(atual.procedures.map((cp) => [cp.id, cp]));
  const porProcedure = new Map(atual.procedures.map((cp) => [cp.procedureId, cp]));

  const vistos = new Set<number>();
  for (const e of body.existentes) {
    if (!porId.has(e.id)) throw new HttpError(400, `Procedimento ${e.id} não pertence a este contrato`);
    if (vistos.has(e.id)) throw new HttpError(400, 'Procedimento repetido na lista');
    vistos.add(e.id);
  }

  // "novo" que já existe no contrato (ex.: inativo) vira reativação do registro existente
  const novosReais: typeof body.novos = [];
  const existentes = [...body.existentes];
  const novosProc = new Set<number>();
  for (const n of body.novos) {
    if (novosProc.has(n.procedureId)) throw new HttpError(400, 'Procedimento adicionado em duplicidade');
    novosProc.add(n.procedureId);
    const ja = porProcedure.get(n.procedureId);
    if (ja) {
      const idx = existentes.findIndex((e) => e.id === ja.id);
      const item = { id: ja.id, ativo: true, qtdMensal: n.qtdMensal, valorUnitario: n.valorUnitario };
      if (idx >= 0) existentes[idx] = item; else existentes.push(item);
    } else {
      novosReais.push(n);
    }
  }
  if (novosReais.length) {
    const encontrados = await prisma.procedure.count({ where: { id: { in: novosReais.map((n) => n.procedureId) } } });
    if (encontrados !== novosReais.length) throw new HttpError(400, 'Procedimento a adicionar não encontrado');
  }

  const ativosDepois = existentes.filter((e) => e.ativo).length + novosReais.length;
  if (ativosDepois === 0) throw new HttpError(400, 'O contrato renovado precisa ter ao menos um procedimento ativo');

  const resumo = {
    mantidos: [] as string[],
    alterados: [] as string[],
    inativados: [] as string[],
    reativados: [] as string[],
    adicionados: [] as string[],
  };

  const now = new Date();
  const ano = now.getFullYear();
  const mes = now.getMonth() + 1;

  const result = await prisma.$transaction(async (tx) => {
    for (const e of existentes) {
      const cp = porId.get(e.id)!;
      const cod = cp.procedure.codigo;
      const mudouQtdValor = cp.qtdMensal !== e.qtdMensal || Number(cp.valorUnitario) !== e.valorUnitario;
      if (!e.ativo) {
        if (cp.ativo) resumo.inativados.push(cod);
        if (cp.ativo) await tx.contractProcedure.update({ where: { id: cp.id }, data: { ativo: false } });
        continue;
      }
      if (!cp.ativo) resumo.reativados.push(cod);
      else if (mudouQtdValor) resumo.alterados.push(cod);
      else resumo.mantidos.push(cod);
      if (!cp.ativo || mudouQtdValor) {
        await tx.contractProcedure.update({
          where: { id: cp.id },
          data: { ativo: true, qtdMensal: e.qtdMensal, valorUnitario: e.valorUnitario },
        });
      }
    }
    // procedimentos ativos que o cliente não enviou ficam como estão (mantidos)
    for (const cp of atual.procedures) {
      if (cp.ativo && !existentes.some((e) => e.id === cp.id)) resumo.mantidos.push(cp.procedure.codigo);
    }

    for (const n of novosReais) {
      const cp = await tx.contractProcedure.create({
        data: { contractId: id, procedureId: n.procedureId, qtdMensal: n.qtdMensal, valorUnitario: n.valorUnitario },
        include: { procedure: { select: { codigo: true } } },
      });
      await tx.contractMonthlyBalance.create({ data: { contractProcedureId: cp.id, ano, mes, qtdConsumida: 0 } });
      resumo.adicionados.push(cp.procedure.codigo);
    }

    const numeroNovo = body.numero || atual.numero;
    const contrato = await tx.contract.update({
      where: { id },
      data: {
        numero: numeroNovo,
        ...(body.numeroCredenciamento !== undefined ? { numeroCredenciamento: body.numeroCredenciamento || null } : {}),
        vigenciaInicio: body.vigenciaInicio,
        vigenciaFim: body.vigenciaFim,
        ativo: true,
      },
    });

    const renovacao = await tx.contractRenewal.create({
      data: {
        contractId: id,
        numeroAnterior: atual.numero,
        numeroNovo,
        vigenciaInicioAnterior: atual.vigenciaInicio,
        vigenciaFimAnterior: atual.vigenciaFim,
        vigenciaInicioNova: body.vigenciaInicio,
        vigenciaFimNova: body.vigenciaFim,
        observacao: body.observacao || null,
        resumo,
        userId: req.user!.id,
        userNome: req.user!.nome,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        acao: 'RENOVAR_CONTRATO',
        entidade: 'contract',
        entityId: String(id),
        payload: { renovacaoId: renovacao.id, resumo },
        ip: req.ip,
      },
    });

    return { contrato, renovacao };
  });

  res.json({
    ...result.contrato,
    renovacao: result.renovacao,
    resumo: {
      mantidos: resumo.mantidos.length,
      alterados: resumo.alterados.length,
      inativados: resumo.inativados.length,
      reativados: resumo.reativados.length,
      adicionados: resumo.adicionados.length,
    },
  });
}));

// ─── Importação por PDF ─────────────────────────────────
function runParser(pdfPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const script = path.resolve(__dirname, '../../../scripts/parse_contrato.py');
    const p = spawn('python3', [script, pdfPath]);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Parser falhou (code ${code}): ${err || out}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`Saída inválida do parser: ${out.slice(0, 200)}`)); }
    });
    p.on('error', reject);
  });
}

contractsRouter.post(
  '/import-pdf/parse',
  requireRole(Role.ADMIN, Role.GESTOR),
  upload.single('arquivo'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Arquivo não enviado');
    try {
      const data = await runParser(req.file.path);

      // tentativa de match com Laboratory pelo CNPJ
      let laboratorio: any = null;
      if (data.cnpj) {
        laboratorio = await prisma.laboratory.findFirst({ where: { cnpj: onlyDigits(data.cnpj) } });
      }

      // ─── Cross-reference com SIGTAP ────────────────────
      // Códigos no contrato vêm com 9 dígitos (sem o 0 à esquerda); SIGTAP usa 10.
      // Para cada item: padroniza para 10 dígitos e busca a descrição canônica.
      const cfg = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
      let comp = cfg?.sigtapCompetenciaVigente
        ? await prisma.sigtapCompetencia.findUnique({ where: { competencia: cfg.sigtapCompetenciaVigente } })
        : null;
      if (!comp) comp = await prisma.sigtapCompetencia.findFirst({ orderBy: { competencia: 'desc' } });

      // normaliza códigos (9 → 10 dígitos com zero à esquerda) e remove duplicatas
      // que aparecem por causa de tabelas repetidas/anexos no PDF.
      const procedimentosBrutos: any[] = (data.procedimentos || []).map((p: any) => {
        const raw = String(p.codigo || '').replace(/\D/g, '');
        const codigo10 = raw.length === 9 ? '0' + raw : raw.padStart(10, '0').slice(-10);
        return { ...p, codigoOriginal: raw, codigo: codigo10, descricaoOriginal: p.descricao };
      });
      const seen = new Map<string, any>();
      let duplicados = 0;
      for (const p of procedimentosBrutos) {
        const ja = seen.get(p.codigo);
        if (!ja) {
          seen.set(p.codigo, p);
        } else {
          duplicados++;
          // se a duplicata tem dados melhores (qtd > 0, valor > 0), substitui
          if (
            (!ja.quantidadeAnual && p.quantidadeAnual) ||
            (!ja.valorUnitario && p.valorUnitario) ||
            (p.descricao && p.descricao.length > (ja.descricao || '').length)
          ) {
            seen.set(p.codigo, { ...ja, ...p });
          }
        }
      }
      const procedimentos = Array.from(seen.values());

      let competenciaUsada: string | null = null;
      let matchedCount = 0;
      if (comp && procedimentos.length) {
        competenciaUsada = comp.competencia;
        const codigos = Array.from(new Set(procedimentos.map((p) => p.codigo)));
        const sigItems = await prisma.sigtapProcedimento.findMany({
          where: { competenciaId: comp.id, codigo: { in: codigos } },
          select: { codigo: true, descricao: true, complexidade: true, tpSexo: true },
        });
        const mapa = new Map(sigItems.map((s) => [s.codigo, s]));
        for (const p of procedimentos) {
          const hit = mapa.get(p.codigo);
          if (hit) {
            p.descricao = hit.descricao;
            p.complexidade = hit.complexidade ?? null;
            p.tpSexo = hit.tpSexo ?? null;
            p.sigtapMatch = true;
            matchedCount++;
          } else {
            p.sigtapMatch = false;
          }
        }
      }

      res.json({
        ...data,
        procedimentos,
        laboratorio,
        sigtapCompetencia: competenciaUsada,
        sigtapMatched: matchedCount,
        sigtapMissing: procedimentos.length - matchedCount,
        duplicadosRemovidos: duplicados,
      });
    } finally {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
  }),
);

const confirmSchema = z.object({
  numero: z.string().min(1),
  numeroCredenciamento: z.string().optional().nullable(),
  laboratoryId: z.number().int().positive(),
  vigenciaInicio: z.coerce.date(),
  vigenciaFim: z.coerce.date(),
  procedimentos: z.array(z.object({
    sigtapCodigo: z.string().min(1),
    descricao: z.string().min(1),
    quantidadeAnual: z.number().int().positive(),
    qtdMensal: z.number().int().positive(),
    valorUnitario: z.number().nonnegative(),
  })),
});

contractsRouter.post(
  '/import-pdf/confirm',
  requireRole(Role.ADMIN, Role.GESTOR),
  ah(async (req, res) => {
    const body = confirmSchema.parse(req.body);
    // Agrega duplicados no payload (mesmo sigtapCodigo): soma qtdMensal,
    // mantém a maior quantidadeAnual e o primeiro valor unitário não-zero.
    const agg = new Map<string, typeof body.procedimentos[number]>();
    let duplicados = 0;
    for (const p of body.procedimentos) {
      const cur = agg.get(p.sigtapCodigo);
      if (!cur) {
        agg.set(p.sigtapCodigo, { ...p });
      } else {
        duplicados++;
        cur.qtdMensal += p.qtdMensal;
        cur.quantidadeAnual = Math.max(cur.quantidadeAnual, p.quantidadeAnual);
        if (!cur.valorUnitario && p.valorUnitario) cur.valorUnitario = p.valorUnitario;
      }
    }
    const procedimentos = Array.from(agg.values());

    const result = await prisma.$transaction(async (tx) => {
      const contrato = await tx.contract.create({
        data: {
          numero: body.numero,
          numeroCredenciamento: body.numeroCredenciamento || null,
          laboratoryId: body.laboratoryId,
          vigenciaInicio: body.vigenciaInicio,
          vigenciaFim: body.vigenciaFim,
          observacoes: 'Importado via PDF',
        },
      });
      const now = new Date();
      const ano = now.getFullYear();
      const mes = now.getMonth() + 1;
      const procIdsUsados = new Set<number>();

      for (const p of procedimentos) {
        let proc = await tx.procedure.findFirst({
          where: { OR: [{ sigtapCodigo: p.sigtapCodigo }, { codigo: p.sigtapCodigo }] },
        });
        if (!proc) {
          proc = await tx.procedure.create({
            data: { codigo: p.sigtapCodigo, descricao: p.descricao, sigtapCodigo: p.sigtapCodigo },
          });
        } else if (!proc.ativo || !proc.sigtapCodigo) {
          proc = await tx.procedure.update({
            where: { id: proc.id },
            data: { ativo: true, sigtapCodigo: p.sigtapCodigo },
          });
        }

        // proteção extra: se 2 códigos diferentes do PDF resolveram para o mesmo Procedure interno,
        // usa upsert para somar quantidades em vez de duplicar
        if (procIdsUsados.has(proc.id)) {
          const existente = await tx.contractProcedure.findUnique({
            where: { contractId_procedureId: { contractId: contrato.id, procedureId: proc.id } },
          });
          if (existente) {
            await tx.contractProcedure.update({
              where: { id: existente.id },
              data: { qtdMensal: existente.qtdMensal + p.qtdMensal },
            });
            duplicados++;
            continue;
          }
        }
        procIdsUsados.add(proc.id);

        const cp = await tx.contractProcedure.create({
          data: {
            contractId: contrato.id,
            procedureId: proc.id,
            qtdMensal: p.qtdMensal,
            valorUnitario: p.valorUnitario,
          },
        });
        await tx.contractMonthlyBalance.create({
          data: { contractProcedureId: cp.id, ano, mes, qtdConsumida: 0 },
        });
      }
      return contrato;
    });
    res.status(201).json({ ...result, duplicadosAgregados: duplicados });
  }),
);
