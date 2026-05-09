import { Router } from 'express';
import { ah } from '../../utils/asyncHandler';
import { HttpError } from '../../middleware/error';
import { authRequired } from '../../middleware/auth';

export const cepRouter = Router();
cepRouter.use(authRequired);

// cache simples in-memory (10 min TTL) para evitar chamadas repetidas ao OpenCEP
const cache = new Map<string, { data: any; exp: number }>();
const TTL_MS = 10 * 60 * 1000;

cepRouter.get(
  '/:cep',
  ah(async (req, res) => {
    const cep = String(req.params.cep || '').replace(/\D/g, '');
    if (cep.length !== 8) throw new HttpError(400, 'CEP inválido (8 dígitos)');

    const cached = cache.get(cep);
    if (cached && cached.exp > Date.now()) return res.json(cached.data);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`https://opencep.com/v1/${cep}.json`, { signal: ctrl.signal });
      if (r.status === 404) throw new HttpError(404, 'CEP não encontrado');
      if (!r.ok) throw new HttpError(502, `OpenCEP retornou ${r.status}`);
      const j: any = await r.json();
      const data = {
        cep: (j.cep || cep).replace(/\D/g, ''),
        logradouro: j.logradouro || '',
        complemento: j.complemento || '',
        bairro: j.bairro || '',
        cidade: j.localidade || '',
        uf: j.uf || '',
        estado: j.estado || '',
        ibge: j.ibge || '',
      };
      cache.set(cep, { data, exp: Date.now() + TTL_MS });
      res.json(data);
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      if (e.name === 'AbortError') throw new HttpError(504, 'Timeout consultando OpenCEP');
      throw new HttpError(502, `Falha consultando OpenCEP: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }),
);
