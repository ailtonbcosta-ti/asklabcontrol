import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, FileText, TestTubes, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { baixarCsv } from '../../lib/csv';
import { imprimirPagina } from '../../lib/print';
import { fmtInt, fmtMoeda, fmtPct, isoLocal, isoParaBr } from '../../lib/format';
import {
  Acoes, BuscaProcedimento, Campo, Carregando, Kpi, PrintFooter, PrintHeader, Vazio, useLaboratorios,
} from './components';

type Grupo = 'day' | 'week' | 'month' | 'lab' | 'procedure' | 'detalhado';
type Metrica = 'exames' | 'autorizacoes' | 'valor';

const GRUPOS: { valor: Grupo; label: string }[] = [
  { valor: 'day', label: 'Por dia' },
  { valor: 'week', label: 'Por semana' },
  { valor: 'month', label: 'Por mês' },
  { valor: 'lab', label: 'Por laboratório' },
  { valor: 'procedure', label: 'Por procedimento' },
  { valor: 'detalhado', label: 'Detalhado (item a item)' },
];

const STATUS: Record<string, string> = { EMITIDA: 'Emitida', CANCELADA: 'Cancelada', PARCIAL_PENDENTE: 'Parcial' };

function presets() {
  const h = new Date();
  const d = (y: number, m: number, dd: number) => isoLocal(new Date(y, m, dd));
  return [
    { label: 'Hoje', de: isoLocal(h), ate: isoLocal(h) },
    { label: '7 dias', de: d(h.getFullYear(), h.getMonth(), h.getDate() - 6), ate: isoLocal(h) },
    { label: 'Este mês', de: d(h.getFullYear(), h.getMonth(), 1), ate: isoLocal(h) },
    { label: 'Mês anterior', de: d(h.getFullYear(), h.getMonth() - 1, 1), ate: d(h.getFullYear(), h.getMonth(), 0) },
    { label: 'Este ano', de: d(h.getFullYear(), 0, 1), ate: isoLocal(h) },
  ];
}

function rotuloBucket(bucket: string, grupo: Grupo) {
  if (grupo === 'month') {
    const [y, m] = bucket.split('-');
    return `${m}/${y}`;
  }
  if (grupo === 'week') return `Semana de ${isoParaBr(bucket)}`;
  return isoParaBr(bucket);
}

export function Emissoes() {
  const p = presets();
  const [de, setDe] = useState(p[2].de);
  const [ate, setAte] = useState(p[2].ate);
  const [grupo, setGrupo] = useState<Grupo>('lab');
  const [metrica, setMetrica] = useState<Metrica>('exames');
  const [labId, setLabId] = useState('');
  const [procId, setProcId] = useState<number | null>(null);
  const [procLabel, setProcLabel] = useState('');
  const [canceladas, setCanceladas] = useState(false);

  const labs = useLaboratorios();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rep-issued', grupo, de, ate, labId, procId, canceladas],
    queryFn: () =>
      api.get('/reports/issued', {
        params: {
          groupBy: grupo, from: de, to: ate,
          laboratoryId: labId || undefined, procedureId: procId || undefined,
          incluirCanceladas: canceladas ? 1 : undefined,
        },
      }).then((r) => r.data),
    enabled: !!de && !!ate && de <= ate,
  });

  const rows: any[] = data?.rows ?? [];
  const t = data?.totais;

  // pivot período × laboratório
  const pivot = useMemo(() => {
    if (!['day', 'week', 'month'].includes(grupo)) return null;
    const labsMap = new Map<number, string>();
    const buckets = new Map<string, Map<number, any>>();
    for (const r of rows) {
      labsMap.set(r.laboratory_id, r.laboratorio);
      if (!buckets.has(r.bucket)) buckets.set(r.bucket, new Map());
      buckets.get(r.bucket)!.set(r.laboratory_id, r);
    }
    const colunas = [...labsMap.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    return { colunas, linhas: [...buckets.entries()] };
  }, [rows, grupo]);

  const fmtMetrica = (v: number) => (metrica === 'valor' ? fmtMoeda(v) : fmtInt(v));
  const nomeLab = labs.data?.find((l: any) => String(l.id) === labId)?.razaoSocial;
  const grupoLabel = GRUPOS.find((g) => g.valor === grupo)!.label;
  const metricaLabel = metrica === 'exames' ? 'Exames' : metrica === 'autorizacoes' ? 'Autorizações' : 'Valor (R$)';

  function exportarCsv() {
    const nome = `emissoes-${grupo}-${de}_a_${ate}`;
    if (pivot) {
      baixarCsv(nome, ['Período', ...pivot.colunas.map(([, n]) => n), 'Total'],
        pivot.linhas.map(([b, m]) => {
          const vals = pivot.colunas.map(([id]) => Number(m.get(id)?.[metrica] ?? 0));
          return [rotuloBucket(b, grupo), ...vals, vals.reduce((s, v) => s + v, 0)];
        }));
    } else if (grupo === 'lab') {
      baixarCsv(nome, ['Laboratório', 'Autorizações', 'Exames', 'Pacientes', 'Valor'], rows.map((r) => [r.laboratorio, r.autorizacoes, r.exames, r.pacientes, r.valor]));
    } else if (grupo === 'procedure') {
      baixarCsv(nome, ['Código', 'Procedimento', 'Autorizações', 'Exames', 'Laboratórios', 'Valor'], rows.map((r) => [r.codigo, r.descricao, r.autorizacoes, r.exames, r.laboratorios, r.valor]));
    } else {
      baixarCsv(nome, ['Autorização', 'Data', 'Status', 'Laboratório', 'Paciente', 'Código', 'Procedimento', 'Qtd', 'Valor'],
        rows.map((r) => [r.codigo, new Date(r.emitida_em).toLocaleString('pt-BR'), STATUS[r.status] || r.status, r.laboratorio, r.paciente, r.proc_codigo, r.proc_descricao, r.qtd, r.valor]));
    }
  }

  return (
    <div className="space-y-5">
      <div className="card no-print space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Campo label="De">
            <input type="date" className="input w-40" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
          </Campo>
          <Campo label="Até">
            <input type="date" className="input w-40" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
          </Campo>
          <div className="flex flex-wrap gap-1 pb-0.5">
            {p.map((x) => (
              <button
                key={x.label}
                type="button"
                className={`btn-sm ${de === x.de && ate === x.ate ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { setDe(x.de); setAte(x.ate); }}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Campo label="Agrupar">
            <select className="input w-52" value={grupo} onChange={(e) => setGrupo(e.target.value as Grupo)}>
              {GRUPOS.map((g) => <option key={g.valor} value={g.valor}>{g.label}</option>)}
            </select>
          </Campo>
          {pivot && (
            <Campo label="Mostrar">
              <select className="input w-40" value={metrica} onChange={(e) => setMetrica(e.target.value as Metrica)}>
                <option value="exames">Exames</option>
                <option value="autorizacoes">Autorizações</option>
                <option value="valor">Valor (R$)</option>
              </select>
            </Campo>
          )}
          <Campo label="Laboratório">
            <select className="input w-56" value={labId} onChange={(e) => setLabId(e.target.value)}>
              <option value="">Todos</option>
              {(labs.data ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.razaoSocial}</option>)}
            </select>
          </Campo>
          <Campo label="Procedimento">
            <BuscaProcedimento valor={procId} label={procLabel} onChange={(id, l) => { setProcId(id); setProcLabel(l); }} />
          </Campo>
          <label className="flex cursor-pointer select-none items-center gap-1.5 pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={canceladas} onChange={(e) => setCanceladas(e.target.checked)} />
            Incluir canceladas
          </label>
          <div className="ml-auto">
            <Acoes disabled={!data || rows.length === 0} onCsv={exportarCsv}
                   onImprimir={() => imprimirPagina(grupo === 'detalhado' || (pivot && pivot.colunas.length > 3) ? 'paisagem' : 'retrato')} />
          </div>
        </div>
      </div>

      <PrintHeader
        titulo={`Autorizações emitidas — ${grupoLabel.toLowerCase()}`}
        filtros={[
          `Período: ${isoParaBr(de)} a ${isoParaBr(ate)}`,
          nomeLab && `Laboratório: ${nomeLab}`,
          procLabel && `Procedimento: ${procLabel}`,
          canceladas ? 'Inclui canceladas' : 'Exceto canceladas',
          pivot && `Valores: ${metricaLabel}`,
        ]}
      />

      {isLoading && <Carregando />}
      {isError && <Vazio>Não foi possível carregar o relatório.</Vazio>}

      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <Kpi label="Autorizações" valor={fmtInt(t.autorizacoes)} icon={FileText} />
          <Kpi label="Exames autorizados" valor={fmtInt(t.exames)} icon={TestTubes}
               detalhe={t.autorizacoes ? `${(t.exames / t.autorizacoes).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por autorização` : undefined} />
          <Kpi label="Valor estimado" valor={fmtMoeda(t.valor)} icon={Banknote} />
          <Kpi label="Pacientes atendidos" valor={fmtInt(t.pacientes)} icon={Users} />
        </div>
      )}

      {data && rows.length === 0 && <Vazio>Nenhuma autorização no período.</Vazio>}

      {data && rows.length > 0 && (
        <div className="card overflow-x-auto p-0 print:overflow-visible">
          {pivot && (
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th>
                  {pivot.colunas.map(([id, nome]) => <th key={id} className="text-right">{nome}</th>)}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.linhas.map(([b, m]) => {
                  const vals = pivot.colunas.map(([id]) => Number(m.get(id)?.[metrica] ?? 0));
                  return (
                    <tr key={b}>
                      <td className="whitespace-nowrap">{rotuloBucket(b, grupo)}</td>
                      {vals.map((v, i) => <td key={i} className={`text-right tabular-nums ${v === 0 ? 'text-slate-300' : ''}`}>{fmtMetrica(v)}</td>)}
                      <td className="text-right font-semibold tabular-nums">{fmtMetrica(vals.reduce((s, v) => s + v, 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td className="font-semibold">Total</td>
                  {pivot.colunas.map(([id]) => (
                    <td key={id} className="text-right font-semibold tabular-nums">
                      {fmtMetrica(rows.filter((r) => r.laboratory_id === id).reduce((s, r) => s + Number(r[metrica] || 0), 0))}
                    </td>
                  ))}
                  <td className="text-right font-semibold tabular-nums">{fmtMetrica(rows.reduce((s, r) => s + Number(r[metrica] || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {grupo === 'lab' && (
            <table className="table">
              <thead>
                <tr>
                  <th>Laboratório</th><th className="text-right">Autorizações</th><th className="text-right">Exames</th>
                  <th className="text-right">Participação</th><th className="text-right">Pacientes</th><th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const part = t?.exames ? (r.exames / t.exames) * 100 : 0;
                  return (
                    <tr key={r.laboratory_id}>
                      <td className="font-medium text-slate-900">{r.laboratorio}</td>
                      <td className="text-right tabular-nums">{fmtInt(r.autorizacoes)}</td>
                      <td className="text-right tabular-nums">{fmtInt(r.exames)}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-brand-600" style={{ width: `${part}%` }} />
                          </div>
                          <span className="w-12 text-right text-xs tabular-nums">{fmtPct(part)}</span>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{fmtInt(r.pacientes)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{fmtMoeda(r.valor)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td className="font-semibold">Total</td>
                  <td className="text-right font-semibold tabular-nums">{fmtInt(t?.autorizacoes)}</td>
                  <td className="text-right font-semibold tabular-nums">{fmtInt(t?.exames)}</td>
                  <td className="text-right font-semibold tabular-nums">100%</td>
                  <td className="text-right font-semibold tabular-nums">{fmtInt(t?.pacientes)}</td>
                  <td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoeda(t?.valor)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {grupo === 'procedure' && (
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th><th>Procedimento</th><th className="text-right">Autorizações</th>
                  <th className="text-right">Exames</th><th className="text-right">Laboratórios</th><th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.procedure_id}>
                    <td className="whitespace-nowrap font-mono text-xs">{r.codigo}</td>
                    <td>{r.descricao}</td>
                    <td className="text-right tabular-nums">{fmtInt(r.autorizacoes)}</td>
                    <td className="text-right font-medium tabular-nums">{fmtInt(r.exames)}</td>
                    <td className="text-right tabular-nums">{fmtInt(r.laboratorios)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{fmtMoeda(r.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td colSpan={2} className="font-semibold">Total ({rows.length} procedimentos)</td>
                  <td className="text-right font-semibold tabular-nums">{fmtInt(t?.autorizacoes)}</td>
                  <td className="text-right font-semibold tabular-nums">{fmtInt(t?.exames)}</td>
                  <td />
                  <td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoeda(t?.valor)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {grupo === 'detalhado' && (
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Autorização</th><th>Data</th><th>Status</th><th>Laboratório</th><th>Paciente</th>
                  <th>Código</th><th>Procedimento</th><th className="text-right">Qtd</th><th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.status === 'CANCELADA' ? 'text-slate-400 line-through' : ''}>
                    <td className="whitespace-nowrap font-mono text-xs">{r.codigo}</td>
                    <td className="whitespace-nowrap">{new Date(r.emitida_em).toLocaleDateString('pt-BR')}</td>
                    <td>{r.status === 'CANCELADA' ? <span className="badge-red no-underline">Cancelada</span> : STATUS[r.status] || r.status}</td>
                    <td>{r.laboratorio}</td>
                    <td>{r.paciente}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{r.proc_codigo}</td>
                    <td>{r.proc_descricao}</td>
                    <td className="text-right tabular-nums">{r.qtd}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{fmtMoeda(r.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td colSpan={7} className="font-semibold">Total ({rows.length} itens)</td>
                  <td className="text-right font-semibold tabular-nums">{fmtInt(t?.exames)}</td>
                  <td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtMoeda(t?.valor)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
      {data?.truncado && <p className="text-xs text-amber-700">Exibindo os 5.000 itens mais recentes. Reduza o período para ver todos.</p>}

      <PrintFooter />
    </div>
  );
}
