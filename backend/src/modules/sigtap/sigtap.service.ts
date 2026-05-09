import fs from 'fs';
import path from 'path';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { obterTabelaMaisRecente, baixarArquivo } from './sigtap.downloader';
import { processarTabelaUnificada, SigtapData } from './sigtap.extractor';

const BATCH = 1000;

function extrairCompetencia(nome: string): string | null {
  const m = nome.match(/(\d{6})/);
  return m ? m[1] : null;
}

export async function persistir(data: SigtapData, competencia: string, opts: { origem: 'FTP' | 'UPLOAD'; userId?: number; versao?: string | null }) {
  const existing = await prisma.sigtapCompetencia.findUnique({ where: { competencia } });
  if (existing) await prisma.sigtapCompetencia.delete({ where: { competencia } });

  const comp = await prisma.sigtapCompetencia.create({
    data: { competencia, origem: opts.origem, importadoPor: opts.userId, versao: opts.versao || null },
  });

  const inserts: Array<() => Promise<unknown>> = [];

  if (data.procedimentos.length) {
    for (let i = 0; i < data.procedimentos.length; i += BATCH) {
      const slice = data.procedimentos.slice(i, i + BATCH);
      inserts.push(() =>
        prisma.sigtapProcedimento.createMany({
          data: slice.map((p) => ({
            competenciaId: comp.id,
            codigo: p.codigo,
            descricao: p.descricao,
            complexidade: p.complexidade ?? null,
            codigoFinanciamento: p.codigoFinanciamento ?? null,
            tpSexo: p.tpSexo ?? null,
            qtMaximaExecucao: p.qtMaximaExecucao ?? null,
            vlIdadeMinima: p.vlIdadeMinima ?? null,
            vlIdadeMaxima: p.vlIdadeMaxima ?? null,
            exigeServico: !!p.exigeServico,
            exigeCid: !!p.exigeCid,
            admiteContinuidade: !!p.admiteContinuidade,
            exigeDadosComplementares: !!p.exigeDadosComplementares,
            exigeCpf: !!p.exigeCpf,
            exigeCidCausasAssoc: !!p.exigeCidCausasAssoc,
            apacValidade2Comp: !!p.apacValidade2Comp,
            programaMaisAcesso: !!p.programaMaisAcesso,
            exigeTomografia: !!p.exigeTomografia,
            exigeRessonancia: !!p.exigeRessonancia,
            verificaHabilitTerceiro: !!p.verificaHabilitTerceiro,
            exigeSecundarioCompativel: !!p.exigeSecundarioCompativel,
            possuiRegra0011: !!p.possuiRegra0011,
          })),
          skipDuplicates: true,
        }),
      );
    }
  }

  const pushBatch = <T>(arr: T[], fn: (chunk: T[]) => Promise<unknown>) => {
    for (let i = 0; i < arr.length; i += BATCH) {
      const chunk = arr.slice(i, i + BATCH);
      inserts.push(() => fn(chunk));
    }
  };

  pushBatch(data.procCbos, (chunk) =>
    prisma.sigtapProcCbo.createMany({
      data: chunk.map((p) => ({ competenciaId: comp.id, codigoProcedimento: p.codigoProcedimento, cbo: p.cbo })),
      skipDuplicates: true,
    }),
  );
  pushBatch(data.procServicos, (chunk) =>
    prisma.sigtapProcServico.createMany({
      data: chunk.map((p) => ({
        competenciaId: comp.id,
        codigoProcedimento: p.codigoProcedimento,
        codigoServico: p.codigoServico,
        codigoClassificacao: p.codigoClassificacao,
      })),
      skipDuplicates: true,
    }),
  );
  pushBatch(data.procCids, (chunk) =>
    prisma.sigtapProcCid.createMany({
      data: chunk.map((p) => ({ competenciaId: comp.id, codigoProcedimento: p.codigoProcedimento, cid: p.cid, stPrincipal: p.stPrincipal || 'S' })),
      skipDuplicates: true,
    }),
  );
  pushBatch(data.procAtributos, (chunk) =>
    prisma.sigtapProcAtributo.createMany({
      data: chunk.map((p) => ({ competenciaId: comp.id, codigoProcedimento: p.codigoProcedimento, codigoAtributo: p.codigoAtributo, descricaoAtributo: p.descricaoAtributo })),
      skipDuplicates: true,
    }),
  );
  pushBatch(data.procRegras, (chunk) =>
    prisma.sigtapProcRegra.createMany({
      data: chunk.map((p) => ({ competenciaId: comp.id, codigoProcedimento: p.codigoProcedimento, codigoRegra: p.codigoRegra, descricaoRegra: p.descricaoRegra })),
      skipDuplicates: true,
    }),
  );
  pushBatch(data.procHabilitacoes, (chunk) =>
    prisma.sigtapProcHabilitacao.createMany({
      data: chunk.map((p) => ({ competenciaId: comp.id, codigoProcedimento: p.codigoProcedimento, codigoHabilitacao: p.codigoHabilitacao, descricaoHabilitacao: p.descricaoHabilitacao })),
      skipDuplicates: true,
    }),
  );
  pushBatch(data.procRegistros, (chunk) =>
    prisma.sigtapProcRegistro.createMany({
      data: chunk.map((p) => ({ competenciaId: comp.id, codigoProcedimento: p.codigoProcedimento, codigoRegistro: p.codigoRegistro, descricaoRegistro: p.descricaoRegistro })),
      skipDuplicates: true,
    }),
  );

  // serializa para não esgotar o pool de conexões do Prisma
  for (const run of inserts) await run();

  await prisma.establishmentConfig.upsert({
    where: { id: 1 },
    update: { sigtapCompetenciaVigente: competencia },
    create: { id: 1, razaoSocial: 'Estabelecimento Autorizador', sigtapCompetenciaVigente: competencia },
  });

  return {
    competencia,
    procedimentos: data.procedimentos.length,
    procCbos: data.procCbos.length,
    procServicos: data.procServicos.length,
    procCids: data.procCids.length,
    procAtributos: data.procAtributos.length,
    procRegras: data.procRegras.length,
    procHabilitacoes: data.procHabilitacoes.length,
    procRegistros: data.procRegistros.length,
  };
}

export async function processarArquivo(caminho: string, nomeOriginal: string, opts: { origem: 'FTP' | 'UPLOAD'; userId?: number; versao?: string | null }) {
  const competencia = extrairCompetencia(nomeOriginal);
  if (!competencia) throw new Error('Não foi possível extrair competência do nome do arquivo');
  const data = await processarTabelaUnificada(caminho, competencia);
  if (data.erro) throw new Error(data.erro);
  return persistir(data, competencia, opts);
}

export async function executarJobFtp(jobId: number) {
  await prisma.sigtapJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
  try {
    const ftp = await obterTabelaMaisRecente();
    if (!ftp) throw new Error('Nenhuma TabelaUnificada encontrada no FTP');

    const ultima = await prisma.sigtapCompetencia.findFirst({ orderBy: { competencia: 'desc' } });
    if (ultima && ultima.competencia >= ftp.competencia) {
      await prisma.sigtapJob.update({
        where: { id: jobId },
        data: {
          status: 'DONE',
          finishedAt: new Date(),
          mensagem: `Já atualizado (vigente=${ultima.competencia}, FTP=${ftp.competencia})`,
          competencia: ultima.competencia,
        },
      });
      return;
    }

    fs.mkdirSync(env.SIGTAP_TMP_DIR, { recursive: true });
    const destino = path.join(env.SIGTAP_TMP_DIR, `${Date.now()}_${ftp.nome}`);
    await baixarArquivo(ftp.nome, destino);

    const resumo = await processarArquivo(destino, ftp.nome, { origem: 'FTP', versao: ftp.versao });

    try { fs.unlinkSync(destino); } catch { /* ignore */ }
    await prisma.sigtapJob.update({
      where: { id: jobId },
      data: { status: 'DONE', finishedAt: new Date(), competencia: resumo.competencia, arquivo: ftp.nome, resumo: resumo as any, mensagem: 'Importação concluída' },
    });
  } catch (e: any) {
    logger.error(e);
    await prisma.sigtapJob.update({ where: { id: jobId }, data: { status: 'ERROR', finishedAt: new Date(), mensagem: e.message } });
  }
}
