import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { maskCep, onlyDigitsCep } from '../../lib/cep';

const blank = {
  cpf: '', cns: '', nome: '', dataNascimento: '', sexo: '', telefone: '', email: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  municipioIbge: '', observacoes: '',
};

export function PatientForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState<any>(blank);
  const [origem, setOrigem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const cepLast = useRef<string>('');

  async function buscarCep(cepRaw: string) {
    const digits = onlyDigitsCep(cepRaw);
    if (digits.length !== 8 || cepLast.current === digits) return;
    cepLast.current = digits;
    setCepLoading(true);
    try {
      const r = await api.get(`/cep/${digits}`);
      setForm((f: any) => ({
        ...f,
        cep: maskCep(digits),
        logradouro: f.logradouro || r.data.logradouro,
        complemento: f.complemento || r.data.complemento,
        bairro: f.bairro || r.data.bairro,
        cidade: f.cidade || r.data.cidade,
        uf: f.uf || r.data.uf,
        municipioIbge: f.municipioIbge || r.data.ibge,
      }));
      toast.success('Endereço preenchido pelo CEP');
    } catch (e: any) {
      const msg = e.response?.data?.error || 'Falha ao buscar CEP';
      if (e.response?.status === 404) toast.error('CEP não encontrado');
      else toast.error(msg);
    } finally { setCepLoading(false); }
  }

  useEffect(() => {
    if (id) api.get(`/patients/${id}`).then((r) => {
      setForm({ ...r.data, dataNascimento: r.data.dataNascimento?.slice(0, 10) || '', cep: maskCep(r.data.cep) });
      setOrigem(r.data.pecSyncedAt ? `PEC (${new Date(r.data.pecSyncedAt).toLocaleString('pt-BR')})` : 'Local');
    });
  }, [id]);

  function set(k: string, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }

  async function buscarPec() {
    const cpf = form.cpf?.replace(/\D/g, '');
    const cns = form.cns?.replace(/\D/g, '');
    if (!cpf && !cns) { toast.error('Informe CPF ou CNS para buscar'); return; }
    setLoading(true);
    try {
      const r = await api.get('/patients/search', { params: { cpf, cns } });
      setForm({ ...r.data, dataNascimento: r.data.dataNascimento?.slice(0, 10) || '' });
      setOrigem(r.data._origem === 'PEC' ? `PEC (${new Date().toLocaleString('pt-BR')})` : 'Local');
      toast.success(`Dados carregados de ${r.data._origem}`);
      if (!id && r.data.id) nav(`/pacientes/${r.data.id}`, { replace: true });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha na busca');
    } finally { setLoading(false); }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = { ...form, dataNascimento: form.dataNascimento || null, cep: onlyDigitsCep(form.cep) || null };
      const r = id
        ? await api.patch(`/patients/${id}`, data)
        : await api.post('/patients', data);
      toast.success('Salvo!');
      // sempre direciona para "Emitir autorização" com o paciente já carregado
      nav('/autorizacoes/emitir', { state: { paciente: r.data } });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao salvar');
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={salvar} className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">{id ? 'Paciente' : 'Novo paciente'}</h1>
      {origem && <div className="text-xs text-slate-500">Origem: <strong>{origem}</strong></div>}
      <div className="card grid grid-cols-2 gap-3">
        <div>
          <label className="label">CPF</label>
          <input className="input" value={form.cpf || ''} onChange={(e) => set('cpf', e.target.value)} />
        </div>
        <div>
          <label className="label">CNS</label>
          <input className="input" value={form.cns || ''} onChange={(e) => set('cns', e.target.value)} />
        </div>
        <div className="col-span-2">
          <button type="button" onClick={buscarPec} disabled={loading} className="btn-outline">
            🔍 Buscar dados (Local + PEC)
          </button>
        </div>
        <div className="col-span-2">
          <label className="label">Nome</label>
          <input className="input" required value={form.nome || ''} onChange={(e) => set('nome', e.target.value)} />
        </div>
        <div>
          <label className="label">Data de nascimento</label>
          <input type="date" className="input" value={form.dataNascimento || ''} onChange={(e) => set('dataNascimento', e.target.value)} />
        </div>
        <div>
          <label className="label">Sexo</label>
          <select className="input" value={form.sexo || ''} onChange={(e) => set('sexo', e.target.value)}>
            <option value="">—</option><option value="M">M</option><option value="F">F</option>
          </select>
        </div>
        <div>
          <label className="label">Telefone</label>
          <input className="input" value={form.telefone || ''} onChange={(e) => set('telefone', e.target.value)} />
        </div>
        <div>
          <label className="label">E-mail</label>
          <input className="input" value={form.email || ''} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div>
          <label className="label">CEP {cepLoading && <span className="text-slate-500">(buscando…)</span>}</label>
          <input
            className="input"
            inputMode="numeric"
            maxLength={9}
            placeholder="00000-000"
            value={form.cep || ''}
            onChange={(e) => {
              const masked = maskCep(e.target.value);
              set('cep', masked);
              if (onlyDigitsCep(masked).length === 8) buscarCep(masked);
            }}
            onBlur={(e) => buscarCep(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Logradouro</label>
          <input className="input" value={form.logradouro || ''} onChange={(e) => set('logradouro', e.target.value)} />
        </div>
        <div>
          <label className="label">Número</label>
          <input className="input" value={form.numero || ''} onChange={(e) => set('numero', e.target.value)} />
        </div>
        <div>
          <label className="label">Complemento</label>
          <input className="input" value={form.complemento || ''} onChange={(e) => set('complemento', e.target.value)} />
        </div>
        <div>
          <label className="label">Bairro</label>
          <input className="input" value={form.bairro || ''} onChange={(e) => set('bairro', e.target.value)} />
        </div>
        <div>
          <label className="label">Cidade</label>
          <input className="input" value={form.cidade || ''} onChange={(e) => set('cidade', e.target.value)} />
        </div>
        <div>
          <label className="label">Estado (UF)</label>
          <input className="input" maxLength={2} value={form.uf || ''} onChange={(e) => set('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        </div>
      </div>
      <button disabled={loading} className="btn-primary">Salvar</button>
    </form>
  );
}
