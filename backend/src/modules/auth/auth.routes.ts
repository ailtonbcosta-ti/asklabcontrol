import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired, signAccess, signRefresh, verifyRefresh } from '../../middleware/auth';

export const authRouter = Router();

const REFRESH_COOKIE = 'asklab_rt';

function setRefreshCookie(res: any, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const body = z
      .object({ email: z.string().email(), senha: z.string().min(1) })
      .parse(req.body);
    const u = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!u || !u.ativo) throw new HttpError(401, 'Credenciais inválidas');
    const ok = await bcrypt.compare(body.senha, u.senhaHash);
    if (!ok) throw new HttpError(401, 'Credenciais inválidas');
    await prisma.user.update({ where: { id: u.id }, data: { ultimoLogin: new Date() } });
    const access = signAccess({ id: u.id, email: u.email, role: u.role, nome: u.nome });
    const refresh = signRefresh({ id: u.id });
    setRefreshCookie(res, refresh);
    res.json({ access, user: { id: u.id, email: u.email, nome: u.nome, role: u.role } });
  }),
);

authRouter.post(
  '/refresh',
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
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

authRouter.get('/me', authRequired, (req, res) => res.json(req.user));
