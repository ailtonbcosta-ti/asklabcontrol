import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env, securityWarnings } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFound } from './middleware/error';
import { router as apiRouter } from './routes';
import { startCronJobs } from './jobs/cron';
import { limparDiretorioNaInicializacao } from './modules/backup/backup.service';
import bcrypt from 'bcryptjs';
import { prisma } from './config/prisma';

// Avisa se o admin inicial ainda usa a senha padrão pública.
async function checkDefaultAdminPassword() {
  try {
    const u = await prisma.user.findUnique({ where: { email: env.SEED_ADMIN_EMAIL.toLowerCase() } });
    if (u?.ativo && (await bcrypt.compare('Admin@123', u.senhaHash))) {
      logger.warn(`[SEGURANÇA] O usuário ${u.email} ainda usa a senha padrão "Admin@123". Altere-a imediatamente.`);
    }
  } catch { /* ignore */ }
}

const app = express();

// Necessário atrás de reverse proxy (Traefik/Nginx/Easypanel)
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet());
// O frontend acessa a API pela mesma origem (proxy do nginx). Com CORS_ORIGIN='*'
// liberamos leitura cross-origin, mas SEM credenciais — refletir qualquer origem com
// credentials=true permitiria a sites de terceiros usar o cookie de refresh.
app.use(
  cors(
    env.CORS_ORIGIN === '*'
      ? { origin: true, credentials: false }
      : { origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true },
  ),
);
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Arquivos públicos: SOMENTE a pasta de logos. A raiz de UPLOAD_DIR também recebe
// uploads temporários (PDFs de contrato, ZIPs SIGTAP), que não devem ser expostos.
app.use(
  '/api/uploads/logos',
  (_req, res, next) => {
    // impede execução de conteúdo ativo (ex.: SVG com script) caso o arquivo seja aberto diretamente
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  },
  express.static(path.resolve(env.UPLOAD_DIR, 'logos'), {
    immutable: true,
    maxAge: '7d',
    fallthrough: false,
    dotfiles: 'deny',
    index: false,
  }),
);
app.use('/api/uploads', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/api', apiRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info(`ASKLabControl API up at :${env.PORT} (${env.NODE_ENV})`);
  for (const w of securityWarnings()) logger.warn(`[SEGURANÇA] ${w}`);
  void checkDefaultAdminPassword();
  limparDiretorioNaInicializacao();
  startCronJobs();
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
