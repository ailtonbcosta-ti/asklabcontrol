import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';

export function Login() {
  const [email, setEmail] = useState('admin@asklab.local');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.post('/auth/login', { email, senha });
      setSession(r.data.user, r.data.access);
      nav('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Falha no login');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-semibold">ASKLab<span className="text-brand">Control</span></h1>
          <p className="text-sm text-slate-500">Sistema de Autorização de Exames</p>
        </div>
        <div>
          <label className="label">E-mail</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Senha</label>
          <input className="input" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </div>
        <button disabled={loading} className="btn-primary w-full">{loading ? 'Entrando...' : 'Entrar'}</button>
      </form>
    </div>
  );
}
