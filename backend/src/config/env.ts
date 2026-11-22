import 'dotenv/config';
import { z } from 'zod';

// z.coerce.boolean() converte a string "false" em true — usar parser explícito.
const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      if (typeof v === 'boolean') return v;
      return ['1', 'true', 'yes', 'on', 'sim'].includes(v.trim().toLowerCase());
    });

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_SECURE: bool(false),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@asklab.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@123'),
  SEED_ADMIN_NAME: z.string().default('Administrador'),

  SIGTAP_FTP_HOST: z.string().default('ftp2.datasus.gov.br'),
  SIGTAP_FTP_DIR: z.string().default('/public/sistemas/tup/downloads'),
  SIGTAP_TMP_DIR: z.string().default('/tmp/sigtap'),
  SIGTAP_AUTO_UPDATE: bool(false),
  SIGTAP_AUTO_UPDATE_CRON: z.string().default('0 3 5 * *'),

  UPLOAD_DIR: z.string().default('/data/uploads'),
});

export const env = schema.parse(process.env);

// Segredos conhecidos/placeholder — se usados em produção, qualquer um pode forjar tokens.
const WEAK_SECRETS = new Set([
  'asklab_access_secret_change_me_32x',
  'asklab_refresh_secret_change_me_32',
  'troque-por-string-aleatoria-minimo-32-caracteres',
  'troque-por-outra-string-aleatoria-minimo-32-caracteres',
]);

export function securityWarnings(): string[] {
  const w: string[] = [];
  if (WEAK_SECRETS.has(env.JWT_ACCESS_SECRET) || WEAK_SECRETS.has(env.JWT_REFRESH_SECRET)) {
    w.push('JWT_ACCESS_SECRET/JWT_REFRESH_SECRET estão com valores padrão públicos. Defina segredos aleatórios (openssl rand -base64 32).');
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    w.push('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET são iguais — use valores distintos.');
  }
  return w;
}
export type Env = typeof env;
