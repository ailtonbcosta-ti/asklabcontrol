import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, EyeOff, FlaskConical, Loader2, Lock, Mail, ShieldCheck, Scale, FileCheck2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';

interface PublicCfg { razaoSocial: string | null; nomeFantasia: string | null; logoUrl: string | null }

function SystemName({ className = '' }: { className?: string }) {
  return (
    <span className={className}>
      ASKLab<span className="text-brand">Control</span>
    </span>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoFalhou, setLogoFalhou] = useState(false);
  const { user, setSession } = useAuth();
  const nav = useNavigate();

  const { data: cfg, isLoading: cfgLoading } = useQuery<PublicCfg>({
    queryKey: ['cfg-login'],
    queryFn: () => api.get('/config/public').then((r) => r.data),
    staleTime: 60_000,
    retry: 0,
  });

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.post('/auth/login', { email: email.trim(), senha });
      setSession(r.data.user, r.data.access);
      nav('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Falha no login');
      setSenha('');
    } finally {
      setLoading(false);
    }
  }

  const orgName = cfg?.nomeFantasia || cfg?.razaoSocial || '';
  const temLogo = !!cfg?.logoUrl && !logoFalhou;

  return (
    <div className="flex min-h-screen bg-white">
      {/* Painel institucional (desktop) */}
      <div className="relative hidden w-[45%] max-w-2xl overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between p-12 text-white">
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgb(37 99 235 / 0.45), transparent 45%), radial-gradient(circle at 85% 80%, rgb(14 165 233 / 0.30), transparent 40%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20 backdrop-blur">
            <FlaskConical size={18} />
          </div>
          <span className="text-lg font-semibold">
            ASKLab<span className="text-brand-300">Control</span>
          </span>
        </div>

        <div className="relative">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Autorização de exames laboratoriais, com controle de cotas e contratos.
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-slate-300">
            <li className="flex items-start gap-3">
              <Scale size={18} className="mt-0.5 shrink-0 text-brand-300" />
              Balanceamento automático entre laboratórios credenciados conforme a cota mensal.
            </li>
            <li className="flex items-start gap-3">
              <FileCheck2 size={18} className="mt-0.5 shrink-0 text-brand-300" />
              Contratos, procedimentos SIGTAP e saldos sempre atualizados.
            </li>
            <li className="flex items-start gap-3">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-300" />
              Acesso por perfil e rastreabilidade das emissões.
            </li>
          </ul>
        </div>

        <div className="relative text-xs text-slate-500">© {new Date().getFullYear()} ASKLabControl</div>
      </div>

      {/* Formulário */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="mb-8 flex flex-col items-center text-center">
            {cfgLoading ? (
              <div className="h-20 w-48 animate-pulse rounded-xl bg-slate-200/70" />
            ) : temLogo ? (
              <img
                src={cfg!.logoUrl!}
                alt={orgName || 'Logotipo'}
                onError={() => setLogoFalhou(true)}
                className="max-h-24 max-w-[260px] object-contain"
              />
            ) : (
              <h1 className="text-3xl font-semibold"><SystemName /></h1>
            )}
            <p className="mt-4 text-sm text-slate-500">
              {orgName ? orgName : 'Sistema de Autorização de Exames'}
            </p>
          </div>

          <form onSubmit={submit} className="card space-y-4 p-6 sm:p-7">
            <div>
              <h2 className="text-lg font-semibold">Entrar</h2>
              <p className="text-sm text-slate-500">Use seu e-mail e senha de acesso.</p>
            </div>

            <div>
              <label className="label" htmlFor="email">E-mail</label>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  className="input pl-9"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="nome@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="senha">Senha</label>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="senha"
                  className="input pl-9 pr-10"
                  type={showSenha ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowSenha((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label={showSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  tabIndex={-1}
                >
                  {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {capsLock && <p className="mt-1.5 text-xs text-amber-600">Caps Lock está ativado.</p>}
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? (<><Loader2 size={16} className="animate-spin" /> Entrando...</>) : 'Entrar'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">
            {temLogo ? <>Powered by <SystemName className="font-medium text-slate-500" /></> : <>© {new Date().getFullYear()}</>}
          </p>
        </div>
      </div>
    </div>
  );
}
