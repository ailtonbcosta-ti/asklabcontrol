import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFound } from './middleware/error';
import { router as apiRouter } from './routes';
import { startCronJobs } from './jobs/cron';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','), credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// arquivos públicos (logos): /api/uploads/<file>
app.use(
  '/api/uploads',
  express.static(path.resolve(env.UPLOAD_DIR), {
    immutable: true,
    maxAge: '7d',
    fallthrough: false,
  }),
);

app.use('/api', apiRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info(`ASKLabControl API up at :${env.PORT} (${env.NODE_ENV})`);
  startCronJobs();
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
