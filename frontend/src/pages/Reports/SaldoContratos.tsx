import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, PackageCheck, PackageMinus } from 'lucide-react';
import { api } from '../../lib/api';
import { formatarDataUTC } from '../../lib/date';
import { baixarCsv } from '../../lib/csv';
import { imprimirPagina } from '../../lib/print';
import { MESES, fmtInt, fmtMoeda, fmtPct } from '../../lib/format';
import {
  Acoes, BuscaProcedimento, Campo, Carregando, Kpi, LegendaConsumo, MedidorConsumo, PrintFooter, PrintHeader,
  Segmentado, Vazio, nivelConsumo, useContratos, useLaboratorios,
} from './components';

// ── Tipos da API ─────────────────────────────────────────────────────────────
interface Item {
  contractProcedureId: number; procedureId: number; codigo: string; descricao: string; ativo: boolean;
  qtdMensal: number; valorUnitario: number; meses: number;
  contratado: number; consumido: number; saldo: number; pctConsumido: number; autorizacoes: number;
  valorContratado: number; valorConsumido: number; valorSaldo: number;
}
interface Contrato {
  contractId: number; numero: string; numeroCredenciamento: string | null;
  vigenciaInicio: string; vigenciaFim: string; vigente: boolean; meses: number; mesesVigencia: number; pctPrazo: number | null;
  itens: Item[];
}
interface Lab { laboratoryId: number; laboratorio: string; nomeFantasia: string | null; cnpj: string | null; contratos: Contrato[] }
interface Resposta { modo: 'vigencia' | 'mes'; laboratorios: Lab[] }

// ── Agregação no cliente (permite filtrar "só críticos" mantendo totais coerentes) ──
interface Tot { contratado: number; consumido: number; saldo: number; valorContratado: number; valorConsumido: number; valorSaldo: number; itens: number; criticos: number; esgotados: number }
const zero = (): Tot => ({ contratado: 0, consumido: 0, saldo: 0, valorContratado: 0, valorConsumido: 0, valorSaldo: 0, itens: 0, criticos: 0, esgotados: 0 });
function acumular(t: Tot, i: Item) {
  t.contratado += i.contratado; t.consumido += i.consumido; t.saldo += i.saldo;
  t.valorContratado += i.valorContratado; t.valorConsumido += i.valorConsumido; t.valorSaldo += i.valorSaldo;
  t.itens += 1;
  if (i.contratado > 0 && i.saldo <= 0) t.esgotados += 1;
  else if (i.pctConsumido >= 80) t.criticos += 1;
}
const pctDe = (t: Pick<Tot, 'contratado' | 'consumido'>) => (t.contratado > 0 ? (t.consumido / t.contratado) * 100 : t.consumido > 0 ? 100 : 0);
const ehCritico = (i: Item) => i.pctConsumido >= 80 || (i.contratado > 0 && i.saldo <= 0);

type Visao = 'laboratorio' | 'contrato' | 'procedimento';
type Ordem = 'nome' | 'consumo';

function lerPref<T>(k: string, def: T): T {
  try { const v = localStorage.getItem(k); return v === null ? def : (JSON.parse(v) as T); } catch { return def; }
}
function gravarPref(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}

export function SaldoContratos() {
  const hoje = new Date();
  const [modo, setModo] = useState<'vigencia' | 'mes'>('vigencia');
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [situacao, setSituacao] = useState<'vigentes' | 'todos'>('vigentes');
  const [labId, setLabId] = useState('');
  const [contractId, setContractId] = useState('');
  const [procId, setProcId] = useState<number | null>(null);
  const [procLabel, setProcLabel] = useState('');
  const [visao, setVisao] = useState<Visao>(() => lerPref('rep.saldo.visao', 'contrato'));
  const [ordem, setOrdem] = useState<Ordem>('nome');
  const [soCriticos, setSoCriticos] = useState(false);
  const [mostrarValores, setMostrarValores] = useState<boolean>(() => lerPref('rep.saldo.valores', false));

  useEffect(() => gravarPref('rep.saldo.visao', visao), [visao]);
  useEffect(() => gravarPref('rep.saldo.valores', mostrarValores), [mostrarValores]);

  const labs = useLaboratorios();
  const contratos = useContratos();

  const { data, isLoading, isError } = useQuery<Resposta>({
    queryKey: ['rep-saldo', modo, ano, mes, situacao, labId, contractId, procId],
    queryFn: () =>
      api.get('/reports/contract-balance', {
        params: {
          modo, situacao,
          ano: modo === 'mes' ? ano : undefined,
          mes: modo === 'mes' ? mes : undefined,
          laboratoryId: labId || undefined,
          contractId: contractId || undefined,
          procedureId: procId || undefined,
        },
      }).then((r) => r.data),
  });

  // árvore filtrada + totais
  const arvore = useMemo(() => {
    const geral = zero();
    const labsOut = (data?.laboratorios ?? [])
      .map((l) => {
        const tl = zero();
        const cs = l.contratos
          .map((c) => {
            const tc = zero();
            let itens = c.itens.filter((i) => !soCriticos || ehCritico(i));
            if (ordem === 'consumo') itens = [...itens].sort((a, b) => b.pctConsumido - a.pctConsumido);
            itens.forEach((i) => { acumular(tc, i); acumular(tl, i); acumular(geral, i); });
            return { ...c, itens, tot: tc };
          })
          .filter((c) => c.itens.length > 0);
        return { ...l, contratos: cs, tot: tl };
      })
      .filter((l) => l.contratos.length > 0);
    if (ordem === 'consumo') labsOut.sort((a, b) => pctDe(b.tot) - pctDe(a.tot));
    return { labs: labsOut, geral };
  }, [data, soCriticos, ordem]);

  // visão por procedimento: agrupa os itens de todos os contratos
  const porProcedimento = useMemo(() => {
    const m = new Map<number, { procedureId: number; codigo: string; descricao: string; tot: Tot; fontes: { lab: string; contrato: string; item: Item }[] }>();
    for (const l of arvore.labs) for (const c of l.contratos) for (const i of c.itens) {
      let g = m.get(i.procedureId);
      if (!g) { g = { procedureId: i.procedureId, codigo: i.codigo, descricao: i.descricao, tot: zero(), fontes: [] }; m.set(i.procedureId, g); }
      acumular(g.tot, i);
      g.fontes.push({ lab: l.laboratorio, contrato: c.numero, item: i });
    }
    const arr = [...m.values()];
    arr.sort(ordem === 'consumo' ? (a, b) => pctDe(b.tot) - pctDe(a.tot) : (a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
    return arr;
  }, [arvore, ordem]);

  const contratosDoLab = (contratos.data ?? []).filter((c: any) => c.ativo !== false && (!labId || String(c.laboratoryId) === labId));
  const nomeLab = labs.data?.find((l: any) => String(l.id) === labId)?.razaoSocial;
  const nomeContrato = contratos.data?.find((c: any) => String(c.id) === contractId)?.numero;
  const anos = Array.from({ length: 6 }, (_, i) => hoje.getFullYear() - 4 + i);
  const g = arvore.geral;
  const rotuloContratado = modo === 'mes' ? 'Cota do mês' : 'Contratado';
  const periodoTxt = modo === 'mes' ? `${MESES[mes - 1]}/${ano}` : `Vigência dos contratos (${situacao === 'vigentes' ? 'vigentes hoje' : 'todos os ativos'})`;

  const filtrosImpressao = [
    `Apuração: ${periodoTxt}`,
    nomeLab && `Laboratório: ${nomeLab}`,
    nomeContrato && `Contrato: ${nomeContrato}`,
    procLabel && `Procedimento: ${procLabel}`,
    soCriticos && 'Somente itens críticos (≥ 80% ou esgotados)',
  ];

  function exportarCsv() {
    const linhas: unknown[][] = [];
    for (const l of arvore.labs) for (const c of l.contratos) for (const i of c.itens) {
      linhas.push([
        l.laboratorio, l.cnpj || '', c.numero, formatarDataUTC(c.vigenciaInicio), formatarDataUTC(c.vigenciaFim),
        i.codigo, i.descricao, i.ativo ? 'Ativo' : 'Inativo', i.qtdMensal, i.meses,
        i.contratado, i.consumido, i.saldo, Math.round(i.pctConsumido * 10) / 10,
        i.valorUnitario, i.valorContratado, i.valorConsumido, i.valorSaldo,
      ]);
    }
    baixarCsv(`saldo-contratos-${modo === 'mes' ? `${ano}-${String(mes).padStart(2, '0')}` : 'vigencia'}`, [
      'Laboratório', 'CNPJ', 'Contrato', 'Início vigência', 'Fim vigência', 'Código', 'Procedimento', 'Situação item',
      'Cota mensal', 'Meses', rotuloContratado, 'Consumido', 'Saldo', '% consumido',
      'Valor unitário', 'Valor contratado', 'Valor consumido', 'Valor saldo',
    ], linhas);
  }

  // ── Células reutilizadas ──
  const cabecalhoNumeros = (
    <>
      <th className="text-right">{rotuloContratado}</th>
      <th className="text-right">Consumido</th>
      <th className="text-right">Saldo</th>
      <th className="text-right">Consumo</th>
      {mostrarValores && <><th className="text-right">Valor contratado</th><th className="text-right">Valor consumido</th><th className="text-right">Saldo (R$)</th></>}
    </>
  );
  const celulasNumeros = (t: { contratado: number; consumido: number; saldo: number; valorContratado: number; valorConsumido: number; valorSaldo: number }, forte = false) => {
    const pct = pctDe(t);
    const nivel = nivelConsumo(pct, t.contratado > 0 ? t.saldo : undefined);
    const fw = forte ? 'font-semibold' : '';
    return (
      <>
        <td className={`text-right tabular-nums ${fw}`}>{fmtInt(t.contratado)}</td>
        <td className={`text-right tabular-nums ${fw}`}>{fmtInt(t.consumido)}</td>
        <td className={`text-right tabular-nums font-semibold ${nivel === 'critico' ? 'text-red-700' : nivel === 'alerta' ? 'text-amber-700' : 'text-slate-900'}`}>
          {fmtInt(t.saldo)}
        </td>
        <td className="text-right"><MedidorConsumo pct={pct} saldo={t.contratado > 0 ? t.saldo : undefined} /></td>
        {mostrarValores && (
          <>
            <td className={`text-right tabular-nums whitespace-nowrap ${fw}`}>{fmtMoeda(t.valorContratado)}</td>
            <td className={`text-right tabular-nums whitespace-nowrap ${fw}`}>{fmtMoeda(t.valorConsumido)}</td>
            <td className={`text-right tabular-nums whitespace-nowrap ${fw}`}>{fmtMoeda(t.valorSaldo)}</td>
          </>
        )}
      </>
    );
  };

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="card no-print space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Campo label="Apuração">
            <Segmentado
              valor={modo}
              onChange={setModo}
              opcoes={[{ valor: 'vigencia', label: 'Vigência do contrato' }, { valor: 'mes', label: 'Mês' }]}
            />
          </Campo>
          {modo === 'mes' ? (
            <>
              <Campo label="Mês">
                <select className="input w-36" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                  {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Campo>
              <Campo label="Ano">
                <select className="input w-28" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
                  {anos.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Campo>
            </>
          ) : (
            <Campo label="Contratos">
              <select className="input w-48" value={situacao} onChange={(e) => setSituacao(e.target.value as any)}>
                <option value="vigentes">Vigentes hoje</option>
                <option value="todos">Todos os ativos</option>
              </select>
            </Campo>
          )}
          <Campo label="Laboratório">
            <select className="input w-56" value={labId} onChange={(e) => { setLabId(e.target.value); setContractId(''); }}>
              <option value="">Todos</option>
              {(labs.data ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.razaoSocial}</option>)}
            </select>
          </Campo>
          <Campo label="Contrato">
            <select className="input w-44" value={contractId} onChange={(e) => setContractId(e.target.value)}>
              <option value="">Todos</option>
              {contratosDoLab.map((c: any) => <option key={c.id} value={c.id}>{c.numero}</option>)}
            </select>
          </Campo>
          <Campo label="Procedimento">
            <BuscaProcedimento valor={procId} label={procLabel} onChange={(id, l) => { setProcId(id); setProcLabel(l); }} />
          </Campo>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <Segmentado
              valor={visao}
              onChange={setVisao}
              opcoes={[
                { valor: 'laboratorio', label: 'Por laboratório' },
                { valor: 'contrato', label: 'Por contrato e item' },
                { valor: 'procedimento', label: 'Por procedimento' },
              ]}
            />
            <select className="input w-auto py-1.5" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenação">
              <option value="nome">Ordem alfabética</option>
              <option value="consumo">Maior consumo primeiro</option>
            </select>
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={soCriticos} onChange={(e) => setSoCriticos(e.target.checked)} />
              Só itens críticos
            </label>
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={mostrarValores} onChange={(e) => setMostrarValores(e.target.checked)} />
              Mostrar valores (R$)
            </label>
          </div>
          <Acoes
            disabled={!data || arvore.labs.length === 0}
            onCsv={exportarCsv}
            onImprimir={() => imprimirPagina(visao === 'laboratorio' && !mostrarValores ? 'retrato' : 'paisagem')}
          />
        </div>
      </div>

      <PrintHeader titulo="Saldo dos contratos" filtros={filtrosImpressao} />

      {isLoading && <Carregando />}
      {isError && <Vazio>Não foi possível carregar o relatório.</Vazio>}

      {data && arvore.labs.length === 0 && (
        <Vazio>
          {soCriticos ? 'Nenhum item crítico para os filtros escolhidos.' : 'Nenhum contrato encontrado para os filtros escolhidos.'}
        </Vazio>
      )}

      {data && arvore.labs.length > 0 && (
        <>
          {/* Indicadores */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
            <Kpi
              label={modo === 'mes' ? 'Cota do mês' : 'Quantidade contratada'}
              valor={fmtInt(g.contratado)}
              detalhe={mostrarValores ? fmtMoeda(g.valorContratado) : `${g.itens} itens de contrato`}
              icon={Boxes}
            />
            <Kpi
              label="Consumido"
              valor={fmtInt(g.consumido)}
              detalhe={<>{fmtPct(pctDe(g))} do contratado{mostrarValores ? ` · ${fmtMoeda(g.valorConsumido)}` : ''}</>}
              icon={PackageMinus}
            />
            <Kpi
              label="Saldo"
              valor={fmtInt(g.saldo)}
              detalhe={mostrarValores ? fmtMoeda(g.valorSaldo) : `${fmtPct(100 - pctDe(g))} disponível`}
              icon={PackageCheck}
              tom={g.saldo <= 0 ? 'critico' : 'neutro'}
            />
            <Kpi
              label="Itens críticos"
              valor={fmtInt(g.criticos + g.esgotados)}
              detalhe={`${g.esgotados} esgotado${g.esgotados === 1 ? '' : 's'} · ${g.criticos} acima de 80%`}
              icon={AlertTriangle}
              tom={g.esgotados > 0 ? 'critico' : g.criticos > 0 ? 'alerta' : 'neutro'}
            />
          </div>

          {/* ── Por laboratório ── */}
          {visao === 'laboratorio' && (
            <div className="card overflow-x-auto p-0 print:overflow-visible">
              <table className="table">
                <thead>
                  <tr>
                    <th>Laboratório</th>
                    <th className="text-right">Contratos</th>
                    <th className="text-right">Itens</th>
                    {cabecalhoNumeros}
                  </tr>
                </thead>
                <tbody>
                  {arvore.labs.map((l) => (
                    <tr key={l.laboratoryId}>
                      <td>
                        <div className="font-medium text-slate-900">{l.laboratorio}</div>
                        {l.cnpj && <div className="text-[11px] text-slate-500">CNPJ {l.cnpj}</div>}
                      </td>
                      <td className="text-right tabular-nums">{l.contratos.length}</td>
                      <td className="text-right tabular-nums">
                        {l.tot.itens}
                        {l.tot.esgotados + l.tot.criticos > 0 && (
                          <span className="ml-1.5 badge-red" title="Itens críticos">{l.tot.esgotados + l.tot.criticos}</span>
                        )}
                      </td>
                      {celulasNumeros(l.tot)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td className="font-semibold">Total geral</td>
                    <td className="text-right font-semibold tabular-nums">{arvore.labs.reduce((s, l) => s + l.contratos.length, 0)}</td>
                    <td className="text-right font-semibold tabular-nums">{g.itens}</td>
                    {celulasNumeros(g, true)}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ── Por contrato e item ── */}
          {visao === 'contrato' && (
            <div className="space-y-5">
              {arvore.labs.map((l) => (
                <section key={l.laboratoryId} className="card p-0 print:break-inside-auto">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-5 py-3 print:px-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">{l.laboratorio}</h3>
                      {l.cnpj && <div className="text-[11px] text-slate-500">CNPJ {l.cnpj}</div>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                      <span>{rotuloContratado}: <strong className="tabular-nums text-slate-900">{fmtInt(l.tot.contratado)}</strong></span>
                      <span>Consumido: <strong className="tabular-nums text-slate-900">{fmtInt(l.tot.consumido)}</strong></span>
                      <span>Saldo: <strong className="tabular-nums text-slate-900">{fmtInt(l.tot.saldo)}</strong></span>
                      <span className="tabular-nums">({fmtPct(pctDe(l.tot))} consumido)</span>
                    </div>
                  </div>

                  {l.contratos.map((c) => {
                    const pctC = pctDe(c.tot);
                    const acimaDoRitmo = modo === 'vigencia' && c.pctPrazo !== null && pctC > c.pctPrazo + 10;
                    return (
                      <div key={c.contractId} className="border-b border-slate-100 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50/70 px-5 py-2 text-xs text-slate-600 print:px-2">
                          <span className="text-sm font-semibold text-slate-800">Contrato {c.numero}</span>
                          {c.numeroCredenciamento && <span>Cred. {c.numeroCredenciamento}</span>}
                          <span>Vigência {formatarDataUTC(c.vigenciaInicio)} a {formatarDataUTC(c.vigenciaFim)} ({c.mesesVigencia} {c.mesesVigencia === 1 ? 'mês' : 'meses'})</span>
                          {!c.vigente && modo === 'vigencia' && <span className="badge-slate">Fora da vigência</span>}
                          {c.pctPrazo !== null && <span>Prazo decorrido <strong className="tabular-nums">{fmtPct(c.pctPrazo)}</strong></span>}
                          <span>Consumido <strong className="tabular-nums">{fmtPct(pctC)}</strong></span>
                          {acimaDoRitmo && <span className="badge-amber" title="O consumo está à frente do tempo de contrato decorrido">Consumo acima do ritmo</span>}
                        </div>
                        <div className="overflow-x-auto print:overflow-visible">
                          <table className={`table table-fixed [&_th]:whitespace-normal [&_th]:align-bottom ${mostrarValores ? 'min-w-[66rem]' : 'min-w-[46rem]'}`}>
                            {/* larguras fixas: colunas alinhadas entre os contratos */}
                            <colgroup>
                              <col className="w-24" />
                              <col />
                              {modo === 'vigencia' && <col className="w-[4.5rem]" />}
                              <col className="w-24" /><col className="w-24" /><col className="w-20" /><col className="w-36" />
                              {mostrarValores && <><col className="w-28" /><col className="w-28" /><col className="w-28" /></>}
                            </colgroup>
                            <thead>
                              <tr>
                                <th>Código</th>
                                <th>Procedimento</th>
                                {modo === 'vigencia' && <th className="text-right">Cota/mês</th>}
                                {cabecalhoNumeros}
                              </tr>
                            </thead>
                            <tbody>
                              {c.itens.map((i) => (
                                <tr key={i.contractProcedureId}>
                                  <td className="whitespace-nowrap font-mono text-xs">{i.codigo}</td>
                                  <td>
                                    {i.descricao}
                                    {!i.ativo && <span className="ml-1.5 badge-slate">inativo</span>}
                                  </td>
                                  {modo === 'vigencia' && <td className="text-right tabular-nums text-slate-500">{fmtInt(i.qtdMensal)}</td>}
                                  {celulasNumeros(i)}
                                </tr>
                              ))}
                            </tbody>
                            {c.itens.length > 1 && (
                              <tfoot>
                                <tr className="bg-slate-50/70">
                                  <td colSpan={modo === 'vigencia' ? 3 : 2} className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Subtotal do contrato
                                  </td>
                                  {celulasNumeros(c.tot, true)}
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}

              <div className="card overflow-x-auto p-0 print:break-inside-avoid">
                <table className="table">
                  <thead><tr><th>Resumo</th>{cabecalhoNumeros}</tr></thead>
                  <tbody>
                    <tr><td className="font-semibold">Total geral ({g.itens} itens)</td>{celulasNumeros(g, true)}</tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Por procedimento ── */}
          {visao === 'procedimento' && (
            <div className="card overflow-x-auto p-0 print:overflow-visible">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Procedimento / Laboratório</th>
                    {cabecalhoNumeros}
                  </tr>
                </thead>
                <tbody>
                  {porProcedimento.map((p) => (
                    <Fragment key={p.procedureId}>
                      <tr className="[&>td]:bg-slate-50/70">
                        <td className="whitespace-nowrap font-mono text-xs font-semibold">{p.codigo}</td>
                        <td className="font-semibold text-slate-900">{p.descricao}</td>
                        {celulasNumeros(p.tot, true)}
                      </tr>
                      {p.fontes.map((f) => (
                        <tr key={f.item.contractProcedureId} className="text-[13px]">
                          <td />
                          <td className="pl-6 text-slate-600">
                            {f.lab} <span className="text-slate-400">· contrato {f.contrato}</span>
                          </td>
                          {celulasNumeros(f.item)}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <td colSpan={2} className="font-semibold">Total geral ({porProcedimento.length} procedimentos)</td>
                    {celulasNumeros(g, true)}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="space-y-1">
            <LegendaConsumo />
            <p className="text-[11px] text-slate-500">
              {modo === 'vigencia'
                ? 'Contratado = cota mensal × nº de meses da vigência. Consumido = exames autorizados (não cancelados) dentro da vigência de cada contrato.'
                : 'Cota do mês = quantidade mensal do item. Consumido = exames autorizados (não cancelados) no mês.'}
              {mostrarValores && ' Valor consumido usa o valor unitário gravado em cada autorização.'}
            </p>
          </div>
        </>
      )}

      <PrintFooter />
    </div>
  );
}
