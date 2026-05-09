import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from './config/prisma';
import { env } from './config/env';
import { logger } from './config/logger';

async function main() {
  const exists = await prisma.user.findUnique({ where: { email: env.SEED_ADMIN_EMAIL.toLowerCase() } });
  if (!exists) {
    await prisma.user.create({
      data: {
        nome: env.SEED_ADMIN_NAME,
        email: env.SEED_ADMIN_EMAIL.toLowerCase(),
        role: Role.ADMIN,
        senhaHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10),
      },
    });
    logger.info(`Admin seed criado: ${env.SEED_ADMIN_EMAIL}`);
  }

  const cfg = await prisma.establishmentConfig.findUnique({ where: { id: 1 } });
  if (!cfg) {
    await prisma.establishmentConfig.create({
      data: { id: 1, razaoSocial: 'Estabelecimento Autorizador', validadeAutorizacaoDias: 30 },
    });
    logger.info('Config inicial criada');
  }
}

main()
  .catch((e) => {
    logger.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
