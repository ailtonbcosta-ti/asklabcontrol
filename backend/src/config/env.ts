import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@asklab.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@123'),
  SEED_ADMIN_NAME: z.string().default('Administrador'),

  SIGTAP_FTP_HOST: z.string().default('ftp2.datasus.gov.br'),
  SIGTAP_FTP_DIR: z.string().default('/public/sistemas/tup/downloads'),
  SIGTAP_TMP_DIR: z.string().default('/tmp/sigtap'),
  SIGTAP_AUTO_UPDATE: z.coerce.boolean().default(false),
  SIGTAP_AUTO_UPDATE_CRON: z.string().default('0 3 5 * *'),

  UPLOAD_DIR: z.string().default('/data/uploads'),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
