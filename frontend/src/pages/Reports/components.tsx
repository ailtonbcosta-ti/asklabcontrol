import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, Printer, Search, X, type LucideIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';
import { fmtPct } from '../../lib/format';

// ── Cabeçalho que só aparece na impressão ────────────────────────────────────
export function PrintHeader({ titulo, filtros }: { titulo: string; filtros: (string | null | false | undefined)[] }) {
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data), staleTime: 300_000 });
  const user = useAuth((s) => s.user);
  const logo = cfg?.logoA4Url || cfg?.logoUrl;
  const meta = [
    cfg?.cnpj && `CNPJ ${cfg.cnpj}`,
    cfg?.endereco && `${cfg.endereco}${cfg.cidade ? ` — ${cfg.cidade}${cfg.uf ? `/${cfg.uf}` : ''}` : ''}`,
    cfg?.telefone && `Tel. ${cfg.telefone}`,
  ].filter(Boolean);
  const linhaFiltros = filtros.filter(Boolean).join(' · ');

  return (
    <div className="mb-4 hidden print:block">
      <div className="flex items-center gap-4 border-b-2 border-slate-900 pb-3">
        {logo && <img src={logo} alt="" className="max-h-14 max-w-[150px] object-contain" />}
        <div className="min-w-0">
          <div className="text-base font-bold text-slate-900">{cfg?.razaoSocial || 'ASKLabControl'}</div>
          {meta.length > 0 && <div className="text-[10px] text-slate-600">{meta.join(' · ')}</div>}
          {cfg?.cabecalhoImpressao && <div className="text-[10px] text-slate-600">{cfg.cabecalhoImpressao}</div>}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{titulo}</h2>
          {linhaFiltros && <div className="text-[11px] text-slate-600">{linhaFiltros}</div>}
        </div>
        <div className="shrink-0 text-right text-[10px] text-slate-500">
          Emitido em {new Date().toLocaleString('pt-BR')}
          {user?.nome && <><br />por {user.nome}</>}
        </div>
      </div>
    </div>
  );
}

export function PrintFooter() {
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: () => api.get('/config').then((r) => r.data), staleTime: 300_000 });
  return (
    <div className="mt-6 hidden justify-between border-t border-slate-300 pt-2 text-[9px] text-slate-500 print:flex">
      <span>{cfg?.rodapeImpressao || ''}</span>
      <span>ASKLabControl</span>
    </div>
  );
}

// ── Barra de ações (impressão / CSV) ─────────────────────────────────────────
export function Acoes({ onImprimir, onCsv, disabled }: { onImprimir: () => void; onCsv?: () => void; disabled?: boolean }) {
  return (
    <div className="no-print flex gap-2">
      {onCsv && (
        <button className="btn-outline" onClick={onCsv} disabled={disabled}>
          <FileSpreadsheet size={16} /> Exportar CSV
        </button>
      )}
      <button className="btn-primary" onClick={onImprimir} disabled={disabled}>
        <Printer size={16} /> Imprimir
      </button>
    </div>
  );
}

// ── Indicadores ──────────────────────────────────────────────────────────────
export function Kpi({ label, valor, detalhe, icon: Icon, tom = 'neutro' }: {
  label: string; valor: React.ReactNode; detalhe?: React.ReactNode; icon?: LucideIcon;
  tom?: 'neutro' | 'alerta' | 'critico';
}) {
  const corIcone = tom === 'critico' ? 'bg-red-50 text-red-600' : tom === 'alerta' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500';
  return (
    <div className="card p-4 print:border-slate-300 print:p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        {Icon && (
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg print:hidden ${corIcone}`}>
            <Icon size={16} />
          </div>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900 print:text-lg">{valor}</div>
      {detalhe && <div className="mt-0.5 text-xs text-slate-500">{detalhe}</div>}
    </div>
  );
}

// ── Medidor de consumo (sempre com o % em texto ao lado) ─────────────────────
export function nivelConsumo(pct: number, saldo?: number) {
  if ((saldo !== undefined && saldo <= 0) || pct >= 90) return 'critico' as const;
  if (pct >= 70) return 'alerta' as const;
  return 'ok' as const;
}

export function MedidorConsumo({ pct, saldo, largura = 'w-24' }: { pct: number; saldo?: number; largura?: string }) {
  const nivel = nivelConsumo(pct, saldo);
  const cor = nivel === 'critico' ? 'bg-red-500' : nivel === 'alerta' ? 'bg-amber-500' : 'bg-emerald-500';
  const texto = nivel === 'critico' ? 'text-red-700' : nivel === 'alerta' ? 'text-amber-700' : 'text-slate-700';
  return (
    <div className="flex items-center justify-end gap-2" title={`${fmtPct(pct)} consumido`}>
      <div className={`h-1.5 ${largura} overflow-hidden rounded-full bg-slate-200 print:h-1`}>
        <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className={`w-12 text-right text-xs font-medium tabular-nums ${texto}`}>{fmtPct(pct)}</span>
    </div>
  );
}

export function LegendaConsumo() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-full bg-emerald-500" /> até 70% consumido</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-full bg-amber-500" /> 70% a 90%</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-full bg-red-500" /> acima de 90% ou esgotado</span>
    </div>
  );
}

// ── Controle segmentado ──────────────────────────────────────────────────────
export function Segmentado<T extends string>({ valor, opcoes, onChange }: {
  valor: T; opcoes: { valor: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onChange(o.valor)}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            valor === o.valor ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Estados ──────────────────────────────────────────────────────────────────
export function Carregando() {
  return <div className="flex items-center gap-2 py-10 text-sm text-slate-500 justify-center"><Loader2 size={16} className="animate-spin" /> Carregando…</div>;
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="card py-10 text-center text-sm text-slate-500">{children}</div>;
}

// ── Busca de procedimento ────────────────────────────────────────────────────
export function BuscaProcedimento({ valor, label, onChange }: {
  valor: number | null; label: string; onChange: (id: number | null, label: string) => void;
}) {
  const [q, setQ] = useState(label);
  const [aberto, setAberto] = useState(false);
  const [res, setRes] = useState<any[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setQ(label), [label]);

  function buscar(texto: string) {
    setQ(texto);
    clearTimeout(timer.current);
    if (!texto.trim()) { setRes([]); if (valor) onChange(null, ''); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.get('/procedures', { params: { q: texto } });
        setRes(r.data);
        setAberto(true);
      } catch { setRes([]); }
    }, 250);
  }

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
      <input
        className="input w-72 pl-9 pr-8"
        placeholder="Código ou nome…"
        value={q}
        onChange={(e) => buscar(e.target.value)}
        onFocus={() => { if (res.length) setAberto(true); }}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
      />
      {valor && (
        <button
          type="button"
          aria-label="Limpar procedimento"
          className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          onMouseDown={() => { setQ(''); setRes([]); onChange(null, ''); }}
        >
          <X size={14} />
        </button>
      )}
      {aberto && res.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-60 w-[28rem] max-w-[90vw] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-pop">
          {res.map((p: any) => (
            <button
              key={p.id}
              type="button"
              className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50"
              onMouseDown={() => { const l = `${p.codigo} — ${p.descricao}`; setQ(l); onChange(p.id, l); setAberto(false); }}
            >
              <span className="mr-2 font-mono text-xs text-slate-400">{p.codigo}</span>{p.descricao}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Opções de laboratório/contrato compartilhadas ────────────────────────────
export function useLaboratorios() {
  return useQuery({
    queryKey: ['labs'],
    queryFn: () => api.get('/laboratories').then((r) => r.data as any[]),
    staleTime: 60_000,
  });
}

export function useContratos() {
  return useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then((r) => r.data as any[]),
    staleTime: 60_000,
  });
}

export function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
