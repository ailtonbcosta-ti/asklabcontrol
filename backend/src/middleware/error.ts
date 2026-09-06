import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (_req: Request, res: Response) =>
  res.status(404).json({ error: 'Not found' });

const FIELD_LABELS: Record<string, string> = {
  cpf: 'CPF', cns: 'CNS', email: 'E-mail', cnpj: 'CNPJ', codigo: 'Código',
  matricula: 'Matrícula', numero: 'Número',
};

function prettyField(target: unknown): string {
  const fields = Array.isArray(target) ? target : [String(target)];
  return fields.map((f) => FIELD_LABELS[f] || f).join(', ');
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validação falhou', details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const f = prettyField((err.meta as any)?.target);
      return res.status(409).json({ error: `Já existe um registro com este(s) campo(s): ${f}` });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'Operação viola um vínculo existente entre registros' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    if (err.code === 'P2021') {
      logger.error({ err }, 'Prisma table not found — prisma db push may not have run');
      return res.status(500).json({ error: 'Tabela não encontrada no banco de dados. Execute prisma db push.' });
    }
    logger.warn({ err: { code: err.code, meta: err.meta, message: err.message } }, 'Prisma known error');
    return res.status(400).json({ error: err.message.split('\n').filter(Boolean).pop() || 'Erro do banco de dados' });
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Erro interno' });
};
