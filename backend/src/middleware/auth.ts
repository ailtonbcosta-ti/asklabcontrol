import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { HttpError } from './error';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  nome: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const signAccess = (u: AuthUser) =>
  jwt.sign(u, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL as any });

export const signRefresh = (u: { id: number }) =>
  jwt.sign(u, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_TTL as any });

export const verifyRefresh = (t: string) =>
  jwt.verify(t, env.JWT_REFRESH_SECRET) as { id: number; iat: number; exp: number };

export const authRequired = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Não autenticado'));
  try {
    req.user = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthUser;
    return next();
  } catch {
    return next(new HttpError(401, 'Token inválido'));
  }
};

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Não autenticado'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Acesso negado'));
    next();
  };
