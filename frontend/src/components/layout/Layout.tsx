import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../stores/auth';
import { Users, Settings as SettingsIcon, FileText, FilePlus, FileBarChart, ClipboardList, Building2, LogOut, Beaker, Stethoscope, Database, FlaskConical, FileOutput } from 'lucide-react';
import { api } from '../../lib/api';

const baseNav = [
  { to: '/pacientes', label: 'Pacientes', icon: Users },
  { to: '/autorizacoes', label: 'Autorizações', icon: FileText },
  { to: '/autorizacoes/emitir', label: 'Emitir', icon: FilePlus },
  { to: '/contratos', label: 'Contratos', icon: ClipboardList },
  { to: '/laboratorios', label: 'Laboratórios', icon: Building2 },
  { to: '/procedimentos', label: 'Procedimentos', icon: Stethoscope },
  { to: '/reagentes', label: 'Reagentes', icon: FlaskConical },
];

export function Layout() {
  const { user, clear } = useAuth();
  const nav = useNavigate();
  const { data: cfg } = useQuery({ queryKey: ['cfg-public'], queryFn: () => api.get('/config').then((r) => r.data) });

  const items = [...baseNav];
  if (user?.role === 'ADMIN' || user?.role === 'GESTOR') {
    items.push({ to: '/relatorios', label: 'Relatórios', icon: FileBarChart });
    items.push({ to: '/bpa-terceiros', label: 'BPA Terceiros', icon: FileOutput });
  }
  if (user?.role === 'ADMIN') {
    items.push({ to: '/usuarios', label: 'Usuários', icon: Users });
    items.push({ to: '/configuracoes', label: 'Configurações', icon: SettingsIcon });
    items.push({ to: '/configuracoes/sigtap', label: 'Tabela SIGTAP', icon: Beaker });
    items.push({ to: '/configuracoes/pec', label: 'Conexão PEC', icon: Database });
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clear();
    nav('/login');
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800">
          {cfg?.logoUrl ? (
            <div className="bg-white/95 rounded p-2 flex items-center justify-center h-14 mb-2">
              <img src={cfg.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <div className="text-lg font-semibold mb-1">ASKLab<span className="text-brand">Control</span></div>
          )}
          <div className="text-xs text-slate-400 truncate" title={cfg?.razaoSocial}>{cfg?.razaoSocial || ''}</div>
          <div className="text-xs text-slate-300 mt-1 truncate">{user?.nome}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">{user?.role}</div>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-800 ${isActive ? 'bg-slate-800 text-white border-l-2 border-brand' : 'text-slate-300'}`
              }
            >
              <it.icon size={16} /> {it.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="flex items-center gap-2 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 border-t border-slate-800">
          <LogOut size={16} /> Sair
        </button>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto"><Outlet /></main>
    </div>
  );
}
