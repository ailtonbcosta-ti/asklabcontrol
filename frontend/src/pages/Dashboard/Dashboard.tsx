import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, Beaker, ClipboardList, FileBarChart, FilePlus, FileText, Hourglass, Users, type LucideIcon,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function StatTile({ label, value, hint, icon: Icon, to }: {
  label: string; value: React.ReactNode; hint?: string; icon: LucideIcon; to?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-slate-500">{label}</div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Icon size={18} />
        </div>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card block transition-shadow hover:shadow-card-hover">{body}</Link>
  ) : (
    <div className="card">{body}</div>
  );
}

function QuickAction({ to, title, desc, icon: Icon }: { to: string; title: string; desc: string; icon: LucideIcon }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-900">{title}</div>
        <div className="truncate text-sm text-slate-500">{desc}</div>
      </div>
      <ArrowRight size={16} className="shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-brand-600" />
    </Link>
  );
}

export function Dashboard() {
  const user = useAuth((s) => s.user);
  const isGestao = user?.role === 'ADMIN' || user?.role === 'GESTOR';

  const { data: pendentes } = useQuery({
    queryKey: ['pending'],
    queryFn: () => api.get('/reports/pending').then((r) => r.data),
    enabled: isGestao,
  });
  const { data: resumo } = useQuery({
    queryKey: ['dash-resumo'],
    queryFn: () => api.get('/reports/dashboard').then((r) => r.data),
    enabled: isGestao,
  });
  const { data: vigente } = useQuery({
    queryKey: ['sigtap-v'],
    queryFn: () => api.get('/sigtap/competencia-vigente').then((r) => r.data),
  });

  const primeiroNome = user?.nome?.split(' ')[0] || '';
  const competencia = vigente?.competencia ? String(vigente.competencia) : null;
  const competenciaFmt = competencia && competencia.length === 6
    ? `${competencia.slice(4)}/${competencia.slice(0, 4)}`
    : competencia;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{saudacao()}{primeiroNome ? `, ${primeiroNome}` : ''}</h1>
        <p className="page-subtitle first-letter:uppercase">
          {new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {isGestao && (
          <StatTile
            label="Autorizações emitidas"
            value={resumo?.totalAuths ?? '—'}
            hint="Últimos 30 dias, exceto canceladas"
            icon={FileText}
            to="/relatorios"
          />
        )}
        {isGestao && (
          <StatTile
            label="Itens pendentes"
            value={Array.isArray(pendentes) ? pendentes.length : '—'}
            hint="Aguardando saldo de cota"
            icon={Hourglass}
            to="/relatorios"
          />
        )}
        <StatTile
          label="Tabela SIGTAP vigente"
          value={competenciaFmt || '—'}
          hint={competencia ? 'Competência em uso' : 'Nenhuma competência importada'}
          icon={Beaker}
          to={user?.role === 'ADMIN' ? '/configuracoes/sigtap' : undefined}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Acesso rápido</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <QuickAction to="/autorizacoes/emitir" title="Emitir autorização" desc="Nova autorização de exames" icon={FilePlus} />
          <QuickAction to="/pacientes" title="Pacientes" desc="Buscar ou cadastrar pacientes" icon={Users} />
          <QuickAction to="/autorizacoes" title="Autorizações" desc="Consultar e reimprimir emissões" icon={FileText} />
          <QuickAction to="/contratos" title="Contratos" desc="Vigências, cotas e saldos" icon={ClipboardList} />
          {isGestao && (
            <QuickAction to="/relatorios" title="Relatórios" desc="Emissões, saldos e pendências" icon={FileBarChart} />
          )}
        </div>
      </section>
    </div>
  );
}
