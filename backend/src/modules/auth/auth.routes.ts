import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, signAccess, signRefresh, verifyRefresh } from '../../middleware/auth';

export const authRouter = Router();

// Força bruta: no máximo 10 tentativas com falha por IP a cada 15 minutos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' },
});

const refreshLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

// Hash fictício: compara mesmo quando o usuário não existe, evitando
// enumeração de e-mails pelo tempo de resposta.
const DUMMY_HASH = bcrypt.hashSync('asklab-dummy-password', 10);

const REFRESH_COOKIE = 'asklab_rt';

function setRefreshCookie(res: any, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.COOKIE_SECURE,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = z
      .object({ email: z.string().trim().email().max(200), senha: z.string().min(1).max(200) })
      .parse(req.body);
    const u = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    const ok = await bcrypt.compare(body.senha, u?.senhaHash ?? DUMMY_HASH);
    if (!u || !u.ativo || !ok) throw new HttpError(401, 'Credenciais inválidas');
    await prisma.user.update({ where: { id: u.id }, data: { ultimoLogin: new Date() } });
    const access = signAccess({ id: u.id, email: u.email, role: u.role, nome: u.nome });
    const refresh = signRefresh({ id: u.id });
    setRefreshCookie(res, refresh);
    res.json({ access, user: { id: u.id, email: u.email, nome: u.nome, role: u.role } });
  }),
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new HttpError(401, 'Sem refresh token');
    let payload;
    try {
      payload = verifyRefresh(token);
    } catch {
      throw new HttpError(401, 'Refresh inválido');
    }
    const u = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!u || !u.ativo) throw new HttpError(401, 'Usuário inativo');
    const access = signAccess({ id: u.id, email: u.email, role: u.role, nome: u.nome });
    res.json({ access });
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', httpOnly: true, sameSite: 'strict', secure: env.COOKIE_SECURE });
  res.json({ ok: true });
});

authRouter.get('/me', authRequired, (req, res) => res.json(req.user));
