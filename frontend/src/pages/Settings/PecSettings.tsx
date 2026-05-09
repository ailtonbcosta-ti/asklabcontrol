import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

interface Cfg {
  ativo: boolean;
  host: string;
  porta: number;
  database: string;
  usuario: string;
  sslMode: 'disable' | 'require';
  schemaName: string;
  temSenha: boolean;
  ultimoTesteEm?: string | null;
  ultimoTesteOk?: boolean | null;
  ultimoTesteMsg?: string | null;
}

const blank: Cfg = {
  ativo: false, host: '', porta: 5432, database: 'esus', usuario: '',
  sslMode: 'disable', schemaName: 'public', temSenha: false,
};

export function PecSettings() {
  const [cfg, setCfg] = useState<Cfg>(blank);
  const [senha, setSenha] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { api.get('/pec').then((r) => setCfg(r.data)); }, []);

  function set<K extends keyof Cfg>(k: K, v: Cfg[K]) { setCfg({ ...cfg, [k]: v }); }

  async function salvar() {
    setSaving(true);
    try {
      const payload: any = { ...cfg };
      if (senha) payload.senha = senha;
      delete payload.temSenha; delete payload.ultimoTesteEm; delete payload.ultimoTesteOk; delete payload.ultimoTesteMsg;
      const r = await api.put('/pec', payload);
      setCfg(r.data); setSenha('');
      toast.success('Configuração salva');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro'); }
    finally { setSaving(false); }
  }

  async function testar() {
    setTesting(true);
    try {
      const r = await api.post('/pec/testar', {
        host: cfg.host, porta: cfg.porta, database: cfg.database,
        usuario: cfg.usuario, sslMode: cfg.sslMode,
        ...(senha ? { senha } : {}),
      });
      if (r.data.ok) toast.success(r.data.mensagem);
      else toast.error(r.data.mensagem);
      // recarrega para refletir ultimoTeste*
      const cur = await api.get('/pec'); setCfg(cur.data);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Falha no teste'); }
    finally { setTesting(false); }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">Conexão com o PEC</h1>
      <p className="text-sm text-slate-600">
        Configure a conexão de leitura ao banco PostgreSQL do PEC (e-SUS) usado para
        sincronização automática de dados de pacientes.
      </p>

      <div className="card grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.ativo} onChange={(e) => set('ativo', e.target.checked)} />
            <strong>Integração ativa</strong>
            <span className="text-xs text-slate-500">(quando desativada, busca PEC é ignorada)</span>
          </label>
        </div>
        <div className="col-span-2">
          <label className="label">Host</label>
          <input className="input" placeholder="ex: 10.220.0.20" value={cfg.host || ''} onChange={(e) => set('host', e.target.value)} />
        </div>
        <div>
          <label className="label">Porta</label>
          <input className="input" type="number" value={cfg.porta} onChange={(e) => set('porta', Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Banco</label>
          <input className="input" placeholder="esus" value={cfg.database || ''} onChange={(e) => set('database', e.target.value)} />
        </div>
        <div>
          <label className="label">Usuário</label>
          <input className="input" value={cfg.usuario || ''} onChange={(e) => set('usuario', e.target.value)} />
        </div>
        <div>
          <label className="label">Senha</label>
          <input className="input" type="password"
                 placeholder={cfg.temSenha ? '•••• (mantém atual se vazio)' : 'definir senha'}
                 value={senha} onChange={(e) => setSenha(e.target.value)} />
        </div>
        <div>
          <label className="label">SSL</label>
          <select className="input" value={cfg.sslMode} onChange={(e) => set('sslMode', e.target.value as any)}>
            <option value="disable">disable</option>
            <option value="require">require</option>
          </select>
        </div>
        <div>
          <label className="label">Schema</label>
          <input className="input" value={cfg.schemaName} onChange={(e) => set('schemaName', e.target.value)} />
        </div>
      </div>

      {cfg.ultimoTesteEm && (
        <div className={`card text-sm ${cfg.ultimoTesteOk ? 'border-green-300' : 'border-red-300'}`}>
          <div className="font-semibold">Último teste: {cfg.ultimoTesteOk ? '✅ OK' : '❌ Falha'}</div>
          <div className="text-xs text-slate-600">{new Date(cfg.ultimoTesteEm).toLocaleString('pt-BR')}</div>
          <div className="text-sm mt-1">{cfg.ultimoTesteMsg}</div>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-outline" onClick={testar} disabled={testing || !cfg.host || !cfg.database || !cfg.usuario}>
          {testing ? 'Testando...' : '🔌 Testar conexão'}
        </button>
        <button className="btn-primary" onClick={salvar} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
