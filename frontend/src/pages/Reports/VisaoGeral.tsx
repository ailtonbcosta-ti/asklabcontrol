import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, FileText, TestTubes, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { imprimirPagina } from '../../lib/print';
import { fmtInt, fmtMoeda, fmtPct, isoLocal, isoParaBr } from '../../lib/format';
import { Acoes, Campo, Carregando, Kpi, PrintFooter, PrintHeader, Vazio, useLaboratorios } from './components';

/** Barra horizontal com rótulo e valor sempre visíveis (cor única: magnitude). */
function Barra({ rotulo, sub, valor, max, extra }: { rotulo: string; sub?: string; valor: number; max: number; extra?: string }) {
  const pct = max > 0 ? (valor / max) * 100 : 0;
  return (
    <div className="group grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 rounded-md px-1 py-1 hover:bg-slate-50"
         title={`${rotulo}: ${fmtInt(valor)}${extra ? ` (${extra})` : ''}`}>
      <div className="min-w-0">
        <div className="truncate text-sm text-slate-700">{rotulo}</div>
        {sub && <div className="truncate font-mono text-[10px] text-slate-400">{sub}</div>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600 transition-all group-hover:bg-brand-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-24 text-right text-sm tabular-nums text-slate-700">
        {fmtInt(valor)}{extra && <span className="ml-1 text-xs text-slate-400">{extra}</span>}
      </div>
    </div>
  );
}

export function VisaoGeral() {
  const hoje = new Date();
  const [de, setDe] = useState(isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 29)));
  const [ate, setAte] = useState(isoLocal(hoje));
  const [labId, setLabId] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const labs = useLaboratorios();

  const { data, isLoading } = useQuery({
    queryKey: ['rep-dashboard', de, ate, labId],
    queryFn: () => api.get('/reports/dashboard', { params: { from: de, to: ate, laboratoryId: labId || undefined } }).then((r) => r.data),
    enabled: !!de && !!ate && de <= ate,
  });

  // série diária completa (dias sem emissão = 0)
  const dias: { dia: string; total: number }[] = (() => {
    if (!data) return [];
    const mapa = new Map<string, number>((data.authsByDay ?? []).map((d: any) => [d.dia, d.total]));
    const out: { dia: string; total: number }[] = [];
    const d = new Date(`${de}T00:00:00`);
    const fim = new Date(`${ate}T00:00:00`);
    while (d <= fim && out.length < 400) { const k = isoLocal(d); out.push({ dia: k, total: mapa.get(k) ?? 0 }); d.setDate(d.getDate() + 1); }
    return out;
  })();
  const maxDia = Math.max(1, ...dias.map((d) => d.total));
  const totalLabs = (data?.authsByLab ?? []).reduce((s: number, r: any) => s + r.total, 0);
  const maxLab = Math.max(1, ...(data?.authsByLab ?? []).map((r: any) => r.total));
  const maxProc = Math.max(1, ...(data?.topProcedures ?? []).map((r: any) => r.total_qtd));
  const nomeLab = labs.data?.find((l: any) => String(l.id) === labId)?.razaoSocial;
  const diaHover = hover !== null ? dias[hover] : null;

  return (
    <div className="space-y-5">
      <div className="card no-print flex flex-wrap items-end gap-4">
        <Campo label="De"><input type="date" className="input w-40" value={de} max={ate} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" className="input w-40" value={ate} min={de} onChange={(e) => setAte(e.target.value)} /></Campo>
        <Campo label="Laboratório">
          <select className="input w-56" value={labId} onChange={(e) => setLabId(e.target.value)}>
            <option value="">Todos</option>
            {(labs.data ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.razaoSocial}</option>)}
          </select>
        </Campo>
        <div className="ml-auto"><Acoes disabled={!data} onImprimir={() => imprimirPagina('retrato')} /></div>
      </div>

      <PrintHeader titulo="Visão geral das emissões" filtros={[`Período: ${isoParaBr(de)} a ${isoParaBr(ate)}`, nomeLab && `Laboratório: ${nomeLab}`]} />

      {isLoading && <Carregando />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
            <Kpi label="Autorizações" valor={fmtInt(data.totalAuths)} icon={FileText} />
            <Kpi label="Exames" valor={fmtInt(data.totalExames)} icon={TestTubes} />
            <Kpi label="Valor estimado" valor={fmtMoeda(data.valorTotal)} icon={Banknote} />
            <Kpi label="Pacientes" valor={fmtInt(data.pacientes)} icon={Users} />
          </div>

          {data.totalAuths === 0 ? (
            <Vazio>Nenhuma autorização no período.</Vazio>
          ) : (
            <>
              <section className="card print:break-inside-avoid">
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="font-semibold">Autorizações por dia</h3>
                  <span className="text-sm tabular-nums text-slate-500">
                    {diaHover ? <>{isoParaBr(diaHover.dia)}: <strong className="text-slate-900">{fmtInt(diaHover.total)}</strong></> : `pico de ${fmtInt(maxDia)} em um dia`}
                  </span>
                </div>
                <div className="flex h-36 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
                  {dias.map((d, i) => (
                    <div key={d.dia} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}
                         title={`${isoParaBr(d.dia)}: ${d.total}`}>
                      <div
                        className={`w-full rounded-t-[3px] ${hover === i ? 'bg-brand-700' : 'bg-brand-500'} ${d.total === 0 ? 'opacity-0' : ''}`}
                        style={{ height: `${Math.max(d.total ? 3 : 0, (d.total / maxDia) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1 text-[11px] text-slate-400">
                  <span>{isoParaBr(de)}</span><span>{isoParaBr(ate)}</span>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 print:grid-cols-1">
                <section className="card print:break-inside-avoid">
                  <h3 className="mb-1 font-semibold">Distribuição entre laboratórios</h3>
                  <p className="mb-3 text-xs text-slate-500">Autorizações emitidas por laboratório no período</p>
                  <div className="space-y-0.5">
                    {data.authsByLab.map((r: any) => (
                      <Barra key={r.laboratory_id} rotulo={r.laboratorio} valor={r.total} max={maxLab}
                             extra={fmtPct(totalLabs ? (r.total / totalLabs) * 100 : 0)} />
                    ))}
                  </div>
                </section>
                <section className="card print:break-inside-avoid">
                  <h3 className="mb-1 font-semibold">Procedimentos mais autorizados</h3>
                  <p className="mb-3 text-xs text-slate-500">Quantidade de exames (15 maiores)</p>
                  <div className="space-y-0.5">
                    {data.topProcedures.map((p: any) => (
                      <Barra key={p.codigo} rotulo={p.descricao} sub={p.codigo} valor={p.total_qtd} max={maxProc} />
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </>
      )}
      <PrintFooter />
    </div>
  );
}
