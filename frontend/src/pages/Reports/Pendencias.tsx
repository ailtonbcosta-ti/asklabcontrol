import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Hourglass, TestTubes, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { baixarCsv } from '../../lib/csv';
import { imprimirPagina } from '../../lib/print';
import { fmtInt } from '../../lib/format';
import { Acoes, BuscaProcedimento, Campo, Carregando, Kpi, PrintFooter, PrintHeader, Segmentado, Vazio } from './components';

const MOTIVO: Record<string, string> = { SEM_SALDO: 'Sem saldo', SEM_CONTRATO: 'Sem contrato' };
const diasDesde = (d: string) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));

export function Pendencias() {
  const [motivo, setMotivo] = useState<'' | 'SEM_SALDO' | 'SEM_CONTRATO'>('');
  const [procId, setProcId] = useState<number | null>(null);
  const [procLabel, setProcLabel] = useState('');
  const [visao, setVisao] = useState<'resumo' | 'pacientes'>('resumo');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['rep-pending', motivo, procId],
    queryFn: () => api.get('/reports/pending', { params: { motivo: motivo || undefined, procedureId: procId || undefined } }).then((r) => r.data as any[]),
  });

  const lista = data ?? [];
  const resumo = useMemo(() => {
    const m = new Map<number, { codigo: string; descricao: string; itens: number; qtd: number; semSaldo: number; semContrato: number; maisAntigo: string }>();
    for (const p of lista) {
      let g = m.get(p.procedure.id);
      if (!g) { g = { codigo: p.procedure.codigo, descricao: p.procedure.descricao, itens: 0, qtd: 0, semSaldo: 0, semContrato: 0, maisAntigo: p.createdAt }; m.set(p.procedure.id, g); }
      g.itens += 1;
      g.qtd += p.qtd;
      if (p.motivo === 'SEM_SALDO') g.semSaldo += p.qtd; else g.semContrato += p.qtd;
      if (p.createdAt < g.maisAntigo) g.maisAntigo = p.createdAt;
    }
    return [...m.values()].sort((a, b) => b.qtd - a.qtd);
  }, [lista]);

  const totalQtd = lista.reduce((s, p) => s + p.qtd, 0);
  const pacientes = new Set(lista.map((p) => p.patient.id)).size;
  const maisAntigo = lista.length ? Math.max(...lista.map((p) => diasDesde(p.createdAt))) : 0;

  function exportarCsv() {
    if (visao === 'resumo') {
      baixarCsv('pendencias-por-procedimento', ['Código', 'Procedimento', 'Pacientes/itens', 'Exames pendentes', 'Sem saldo', 'Sem contrato', 'Mais antigo (dias)'],
        resumo.map((r) => [r.codigo, r.descricao, r.itens, r.qtd, r.semSaldo, r.semContrato, diasDesde(r.maisAntigo)]));
    } else {
      baixarCsv('pendencias-por-paciente', ['Paciente', 'CPF', 'CNS', 'Telefone', 'Código', 'Procedimento', 'Qtd', 'Motivo', 'Registrado em', 'Dias aguardando'],
        lista.map((p) => [p.patient.nome, p.patient.cpf, p.patient.cns, p.patient.telefone, p.procedure.codigo, p.procedure.descricao, p.qtd, MOTIVO[p.motivo], new Date(p.createdAt).toLocaleString('pt-BR'), diasDesde(p.createdAt)]));
    }
  }

  return (
    <div className="space-y-5">
      <div className="card no-print flex flex-wrap items-end gap-4">
        <Campo label="Exibir">
          <Segmentado valor={visao} onChange={setVisao} opcoes={[{ valor: 'resumo', label: 'Por procedimento' }, { valor: 'pacientes', label: 'Por paciente' }]} />
        </Campo>
        <Campo label="Motivo">
          <select className="input w-40" value={motivo} onChange={(e) => setMotivo(e.target.value as any)}>
            <option value="">Todos</option>
            <option value="SEM_SALDO">Sem saldo</option>
            <option value="SEM_CONTRATO">Sem contrato</option>
          </select>
        </Campo>
        <Campo label="Procedimento">
          <BuscaProcedimento valor={procId} label={procLabel} onChange={(id, l) => { setProcId(id); setProcLabel(l); }} />
        </Campo>
        <div className="ml-auto">
          <Acoes disabled={lista.length === 0} onCsv={exportarCsv} onImprimir={() => imprimirPagina(visao === 'pacientes' ? 'paisagem' : 'retrato')} />
        </div>
      </div>

      <PrintHeader
        titulo={`Exames pendentes — ${visao === 'resumo' ? 'por procedimento' : 'por paciente'}`}
        filtros={[motivo && `Motivo: ${MOTIVO[motivo]}`, procLabel && `Procedimento: ${procLabel}`, 'Somente pendências não resolvidas']}
      />

      {isLoading && <Carregando />}
      {isError && <Vazio>Não foi possível carregar as pendências.</Vazio>}

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          <Kpi label="Itens pendentes" valor={fmtInt(lista.length)} icon={Hourglass} tom={lista.length ? 'alerta' : 'neutro'} />
          <Kpi label="Exames aguardando" valor={fmtInt(totalQtd)} icon={TestTubes} />
          <Kpi label="Pacientes" valor={fmtInt(pacientes)} icon={Users} />
          <Kpi label="Mais antigo" valor={lista.length ? `${maisAntigo} dia${maisAntigo === 1 ? '' : 's'}` : '—'} icon={Clock}
               tom={maisAntigo > 30 ? 'critico' : maisAntigo > 7 ? 'alerta' : 'neutro'} />
        </div>
      )}

      {data && lista.length === 0 && <Vazio>Nenhuma pendência em aberto.</Vazio>}

      {lista.length > 0 && visao === 'resumo' && (
        <div className="card overflow-x-auto p-0 print:overflow-visible">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th><th>Procedimento</th><th className="text-right">Pacientes</th>
                <th className="text-right">Exames pendentes</th><th className="text-right">Sem saldo</th>
                <th className="text-right">Sem contrato</th><th className="text-right">Mais antigo</th>
              </tr>
            </thead>
            <tbody>
              {resumo.map((r) => (
                <tr key={r.codigo}>
                  <td className="whitespace-nowrap font-mono text-xs">{r.codigo}</td>
                  <td>{r.descricao}</td>
                  <td className="text-right tabular-nums">{fmtInt(r.itens)}</td>
                  <td className="text-right font-semibold tabular-nums">{fmtInt(r.qtd)}</td>
                  <td className="text-right tabular-nums">{r.semSaldo || '—'}</td>
                  <td className="text-right tabular-nums">{r.semContrato || '—'}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{diasDesde(r.maisAntigo)} dias</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50">
                <td colSpan={2} className="font-semibold">Total</td>
                <td className="text-right font-semibold tabular-nums">{fmtInt(lista.length)}</td>
                <td className="text-right font-semibold tabular-nums">{fmtInt(totalQtd)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {lista.length > 0 && visao === 'pacientes' && (
        <div className="card overflow-x-auto p-0 print:overflow-visible">
          <table className="table text-[13px]">
            <thead>
              <tr>
                <th>Paciente</th><th>CPF / CNS</th><th>Telefone</th><th>Procedimento</th>
                <th className="text-right">Qtd</th><th>Motivo</th><th>Registrado em</th><th className="text-right">Aguardando</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const dias = diasDesde(p.createdAt);
                return (
                  <tr key={p.id}>
                    <td className="font-medium text-slate-900">{p.patient.nome}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{p.patient.cpf || p.patient.cns || '—'}</td>
                    <td className="whitespace-nowrap">{p.patient.telefone || '—'}</td>
                    <td><span className="font-mono text-xs text-slate-500">{p.procedure.codigo}</span> {p.procedure.descricao}</td>
                    <td className="text-right tabular-nums">{p.qtd}</td>
                    <td>{p.motivo === 'SEM_SALDO' ? <span className="badge-amber">Sem saldo</span> : <span className="badge-red">Sem contrato</span>}</td>
                    <td className="whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td className={`whitespace-nowrap text-right tabular-nums ${dias > 30 ? 'font-semibold text-red-700' : dias > 7 ? 'text-amber-700' : ''}`}>
                      {dias} dia{dias === 1 ? '' : 's'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PrintFooter />
    </div>
  );
}
