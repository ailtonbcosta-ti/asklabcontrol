import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { obterTabelaMaisRecente } from '../modules/sigtap/sigtap.downloader';
import { executarJobFtp } from '../modules/sigtap/sigtap.service';

export function startCronJobs() {
  // 1. Verificação automática de nova competência SIGTAP
  if (env.SIGTAP_AUTO_UPDATE) {
    cron.schedule(env.SIGTAP_AUTO_UPDATE_CRON, async () => {
      try {
        const ftp = await obterTabelaMaisRecente();
        if (!ftp) return;
        const ult = await prisma.sigtapCompetencia.findFirst({ orderBy: { competencia: 'desc' } });
        if (ult && ult.competencia >= ftp.competencia) return;
        const job = await prisma.sigtapJob.create({
          data: { tipo: 'FTP_DOWNLOAD', status: 'PENDING', arquivo: ftp.nome, competencia: ftp.competencia },
        });
        executarJobFtp(job.id);
        logger.info({ ftp }, 'SIGTAP cron: nova competência detectada, job iniciado');
      } catch (e: any) {
        logger.warn({ err: e.message }, 'SIGTAP cron falhou');
      }
    });
    logger.info(`SIGTAP cron agendado: ${env.SIGTAP_AUTO_UPDATE_CRON}`);
  }

  // 2. Renovação mensal de cotas: cria registros zerados em ContractMonthlyBalance dia 1 às 00:05
  cron.schedule('5 0 1 * *', async () => {
    try {
      const now = new Date();
      const ano = now.getFullYear();
      const mes = now.getMonth() + 1;
      const cps = await prisma.contractProcedure.findMany({
        where: { ativo: true, contract: { ativo: true, vigenciaInicio: { lte: now }, vigenciaFim: { gte: now } } },
        select: { id: true },
      });
      for (const cp of cps) {
        await prisma.contractMonthlyBalance.upsert({
          where: { contractProcedureId_ano_mes: { contractProcedureId: cp.id, ano, mes } },
          update: {},
          create: { contractProcedureId: cp.id, ano, mes, qtdConsumida: 0 },
        });
      }
      logger.info({ ano, mes, total: cps.length }, 'Renovação mensal de cotas concluída');
    } catch (e: any) {
      logger.error({ err: e.message }, 'Falha na renovação mensal');
    }
  });
}
