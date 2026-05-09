import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired } from '../../middleware/auth';
import { buscarPaciente, pecDisponivel } from '../pec/pec.connector';

export const patientsRouter = Router();
patientsRouter.use(authRequired);

const onlyDigits = (v?: string | null) => (v ? v.replace(/\D/g, '') : null);

patientsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = q
      ? {
          OR: [
            { nome: { contains: q, mode: 'insensitive' as const } },
            { cpf: { contains: onlyDigits(q) || q } },
            { cns: { contains: onlyDigits(q) || q } },
          ],
        }
      : {};
    const list = await prisma.patient.findMany({ where, orderBy: { nome: 'asc' }, take: 100 });
    res.json(list);
  }),
);

patientsRouter.get(
  '/search',
  ah(async (req, res) => {
    const cpf = onlyDigits(String(req.query.cpf || ''));
    const cns = onlyDigits(String(req.query.cns || ''));
    if (!cpf && !cns) throw new HttpError(400, 'Informe CPF ou CNS');

    const local = await prisma.patient.findFirst({
      where: { OR: [{ cpf: cpf || undefined }, { cns: cns || undefined }] },
    });

    let pec = null;
    if (await pecDisponivel()) {
      pec = await buscarPaciente({ cpf, cns });
      if (pec) {
        const data = {
          cpf: pec.cpf || cpf,
          cns: pec.cns || cns,
          nome: pec.nome || local?.nome || '—',
          dataNascimento: pec.dataNascimento ?? local?.dataNascimento,
          sexo: pec.sexo ?? local?.sexo,
          raca: pec.raca ?? local?.raca,
          etnia: pec.etnia ?? local?.etnia,
          nacionalidade: pec.nacionalidade ?? local?.nacionalidade,
          telefone: pec.telefone ?? local?.telefone,
          email: pec.email ?? local?.email,
          cep: pec.cep ?? local?.cep,
          logradouro: pec.logradouro ?? local?.logradouro,
          numero: pec.numero ?? local?.numero,
          complemento: pec.complemento ?? local?.complemento,
          bairro: pec.bairro ?? local?.bairro,
          municipioIbge: pec.municipioIbge ?? local?.municipioIbge,
          pecSyncedAt: new Date(),
          pecSourceId: pec.origem,
        };
        const saved = local
          ? await prisma.patient.update({ where: { id: local.id }, data })
          : await prisma.patient.create({ data });
        return res.json({ ...saved, _origem: 'PEC' });
      }
    }

    if (local) return res.json({ ...local, _origem: 'LOCAL' });
    return res.status(404).json({ error: 'Paciente não encontrado (local ou PEC)' });
  }),
);

const patientSchema = z.object({
  cpf: z.string().optional().nullable(),
  cns: z.string().optional().nullable(),
  nome: z.string().min(2),
  nomeMae: z.string().optional().nullable(),
  dataNascimento: z.coerce.date().optional().nullable(),
  sexo: z.string().max(1).optional().nullable(),
  telefone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  cep: z.string().optional().nullable(),
  logradouro: z.string().optional().nullable(),
  numero: z.string().optional().nullable(),
  complemento: z.string().optional().nullable(),
  bairro: z.string().optional().nullable(),
  cidade: z.string().optional().nullable(),
  uf: z.string().length(2).optional().nullable().or(z.literal('').transform(() => null)),
  municipioIbge: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});

patientsRouter.post(
  '/',
  ah(async (req, res) => {
    const data = patientSchema.parse(req.body);
    const created = await prisma.patient.create({
      data: { ...data, cpf: onlyDigits(data.cpf), cns: onlyDigits(data.cns) },
    });
    res.status(201).json(created);
  }),
);

patientsRouter.get('/:id', ah(async (req, res) => {
  const p = await prisma.patient.findUnique({ where: { id: Number(req.params.id) } });
  if (!p) throw new HttpError(404, 'Paciente não encontrado');
  res.json(p);
}));

patientsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const data = patientSchema.partial().parse(req.body);
    const upd = await prisma.patient.update({
      where: { id: Number(req.params.id) },
      data: { ...data, cpf: data.cpf !== undefined ? onlyDigits(data.cpf) : undefined, cns: data.cns !== undefined ? onlyDigits(data.cns) : undefined },
    });
    res.json(upd);
  }),
);

patientsRouter.delete('/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const [auths, pendentes] = await Promise.all([
    prisma.authorization.count({ where: { patientId: id } }),
    prisma.pendingItem.count({ where: { patientId: id } }),
  ]);
  if (auths > 0 || pendentes > 0) {
    throw new HttpError(
      409,
      `Paciente possui ${auths} autorização(ões) e ${pendentes} pendência(s) vinculadas. Não é possível excluir.`,
    );
  }
  await prisma.patient.delete({ where: { id } });
  res.json({ ok: true });
}));
