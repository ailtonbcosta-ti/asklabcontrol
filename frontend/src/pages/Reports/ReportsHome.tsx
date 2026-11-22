import { useSearchParams } from 'react-router-dom';
import { BarChart3, FileText, Hourglass, Scale, type LucideIcon } from 'lucide-react';
import { SaldoContratos } from './SaldoContratos';
import { Emissoes } from './Emissoes';
import { Pendencias } from './Pendencias';
import { VisaoGeral } from './VisaoGeral';

type Aba = 'saldo' | 'emissoes' | 'pendencias' | 'geral';

const ABAS: { id: Aba; label: string; desc: string; icon: LucideIcon }[] = [
  { id: 'saldo', label: 'Saldo dos contratos', desc: 'Contratado, consumido e saldo por laboratório, contrato e item', icon: Scale },
  { id: 'emissoes', label: 'Emissões', desc: 'Autorizações emitidas por período, laboratório ou procedimento', icon: FileText },
  { id: 'pendencias', label: 'Pendências', desc: 'Exames aguardando saldo ou contrato', icon: Hourglass },
  { id: 'geral', label: 'Visão geral', desc: 'Indicadores e distribuição das emissões', icon: BarChart3 },
];

export function ReportsHome() {
  const [params, setParams] = useSearchParams();
  const aba = (ABAS.some((a) => a.id === params.get('aba')) ? params.get('aba') : 'saldo') as Aba;
  const atual = ABAS.find((a) => a.id === aba)!;

  return (
    <div className="space-y-5">
      <div className="no-print">
        <h1 className="page-title">Relatórios</h1>
        <p className="page-subtitle">{atual.desc}</p>
      </div>

      <div className="no-print -mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-1 border-b border-slate-200">
          {ABAS.map((a) => {
            const ativo = a.id === aba;
            return (
              <button
                key={a.id}
                onClick={() => setParams({ aba: a.id }, { replace: true })}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  ativo ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                }`}
              >
                <a.icon size={16} /> {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {aba === 'saldo' && <SaldoContratos />}
      {aba === 'emissoes' && <Emissoes />}
      {aba === 'pendencias' && <Pendencias />}
      {aba === 'geral' && <VisaoGeral />}
    </div>
  );
}
