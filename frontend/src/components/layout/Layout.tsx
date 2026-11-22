import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, Role } from '../../stores/auth';
import {
  Users, UserCog, Settings as SettingsIcon, FileText, FilePlus, FileBarChart, ClipboardList, Building2,
  LogOut, Beaker, Stethoscope, Database, FlaskConical, FileOutput, LayoutDashboard, Menu, X, type LucideIcon,
} from 'lucide-react';
import { api } from '../../lib/api';

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; roles?: Role[] }
interface NavGroup { title: string; items: NavItem[] }

const NAV: NavGroup[] = [
  {
    title: 'Atendimento',
    items: [
      { to: '/', label: 'Início', icon: LayoutDashboard, end: true },
      { to: '/pacientes', label: 'Pacientes', icon: Users },
      { to: '/autorizacoes', label: 'Autorizações', icon: FileText, end: true },
      { to: '/autorizacoes/emitir', label: 'Emitir autorização', icon: FilePlus },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { to: '/contratos', label: 'Contratos', icon: ClipboardList },
      { to: '/laboratorios', label: 'Laboratórios', icon: Building2 },
      { to: '/procedimentos', label: 'Procedimentos', icon: Stethoscope },
      { to: '/reagentes', label: 'Reagentes', icon: FlaskConical },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { to: '/relatorios', label: 'Relatórios', icon: FileBarChart, roles: ['ADMIN', 'GESTOR'] },
      { to: '/bpa-terceiros', label: 'BPA Terceiros', icon: FileOutput, roles: ['ADMIN', 'GESTOR'] },
    ],
  },
  {
    title: 'Administração',
    items: [
      { to: '/usuarios', label: 'Usuários', icon: UserCog, roles: ['ADMIN'] },
      { to: '/configuracoes', label: 'Configurações', icon: SettingsIcon, end: true, roles: ['ADMIN'] },
      { to: '/configuracoes/sigtap', label: 'Tabela SIGTAP', icon: Beaker, roles: ['ADMIN'] },
      { to: '/configuracoes/pec', label: 'Conexão PEC', icon: Database, roles: ['ADMIN'] },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Administrador', GESTOR: 'Gestor', OPERADOR: 'Operador' };

function initials(nome?: string) {
  if (!nome) return '?';
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

export function Layout() {
  const { user, clear } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { data: cfg } = useQuery({ queryKey: ['cfg-public'], queryFn: () => api.get('/config').then((r) => r.data) });

  // fecha o menu móvel ao navegar
  useEffect(() => setOpen(false), [location.pathname]);

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.roles || (user && it.roles.includes(user.role))),
  })).filter((g) => g.items.length > 0);

  const current = NAV.flatMap((g) => g.items)
    .filter((it) => (it.end ? location.pathname === it.to : location.pathname.startsWith(it.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];

  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clear();
    nav('/login');
  }

  const orgName = cfg?.nomeFantasia || cfg?.razaoSocial || '';

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-950 text-slate-300">
      <div className="px-4 pt-5 pb-4">
        {cfg?.logoUrl ? (
          <div className="flex h-16 items-center justify-center rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-white/10">
            <img src={cfg.logoUrl} alt={orgName || 'Logotipo'} className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-900/40">
              <FlaskConical size={18} />
            </div>
            <div className="text-[15px] font-semibold text-white">
              ASKLab<span className="text-brand-400">Control</span>
            </div>
          </div>
        )}
        {cfg?.razaoSocial && (
          <div className="mt-3 truncate px-1 text-[11px] text-slate-500" title={cfg.razaoSocial}>{cfg.razaoSocial}</div>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Menu principal">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{g.title}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-brand-600/15 font-medium text-white'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-brand-400" />}
                      <it.icon size={17} className={isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300'} />
                      {it.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-xs font-semibold text-white ring-1 ring-white/10">
            {initials(user?.nome)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-100">{user?.nome}</div>
            <div className="truncate text-[11px] text-slate-500">{user ? ROLE_LABEL[user.role] : ''}</div>
          </div>
          <button
            onClick={logout}
            title="Sair"
            aria-label="Sair"
            className="rounded-md p-2 text-slate-500 transition-colors hover:bg-white/5 hover:text-red-400"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block print:!hidden">{sidebar}</aside>

      {/* Sidebar móvel (drawer) */}
      {open && (
        <div className="lg:hidden">
          <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-pop animate-slide-up">
            <button
              onClick={() => setOpen(false)}
              aria-label="Fechar menu"
              className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64 print:!pl-0">
        {/* Barra superior */}
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6">
          <button
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
            className="-ml-1 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {current && <current.icon size={16} className="shrink-0 text-slate-400" />}
            <span className="truncate font-medium text-slate-700">{current?.label || 'ASKLabControl'}</span>
          </div>
          <div className="ml-auto hidden items-center gap-2 text-xs text-slate-500 sm:flex">
            {orgName && <span className="max-w-[320px] truncate" title={orgName}>{orgName}</span>}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8 animate-fade-in print:max-w-none print:!p-0" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
