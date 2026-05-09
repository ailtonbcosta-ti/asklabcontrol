import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../../lib/api';

export function AuthorizationPrint() {
  const { id } = useParams();
  const nav = useNavigate();
  const [auth, setAuth] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [variant, setVariant] = useState<'a4' | 'thermal'>('a4');

  useEffect(() => {
    Promise.all([api.get(`/authorizations/${id}`), api.get('/config')]).then(([a, c]) => {
      setAuth(a.data); setCfg(c.data);
    });
  }, [id]);

  if (!auth || !cfg) return <div className="p-6">Carregando...</div>;

  return (
    <div className={variant === 'thermal' ? 'p-2 max-w-[80mm] mx-auto print-thermal text-xs' : 'p-6 max-w-3xl mx-auto text-sm'}>
      <div className="no-print mb-4 flex gap-2 justify-center items-center">
        <button
          className="btn-outline inline-flex items-center gap-1"
          onClick={() => (window.history.length > 1 ? nav(-1) : nav('/autorizacoes'))}
        >
          <ArrowLeft size={14} /> Voltar
        </button>
        <span className="text-slate-300">|</span>
        <button className={variant === 'a4' ? 'btn-primary' : 'btn-outline'} onClick={() => setVariant('a4')}>A4</button>
        <button className={variant === 'thermal' ? 'btn-primary' : 'btn-outline'} onClick={() => setVariant('thermal')}>80mm</button>
        <button className="btn-primary inline-flex items-center gap-1" onClick={() => window.print()}>
          <Printer size={14} /> Imprimir
        </button>
      </div>

      <div className="text-center border-b-2 border-slate-800 pb-2 mb-3">
        {(() => {
          const logo = variant === 'thermal' ? (cfg.logoThermal80Url || cfg.logoA4Url || cfg.logoUrl)
                                              : (cfg.logoA4Url || cfg.logoUrl);
          return logo ? (
            <div className="flex justify-center mb-1">
              <img src={logo} alt="" className={variant === 'thermal' ? 'max-h-12 object-contain' : 'max-h-20 object-contain'} />
            </div>
          ) : null;
        })()}
        <div className="font-bold uppercase">{cfg.razaoSocial}</div>
        {cfg.cnpj && <div className="text-[10px]">CNPJ {cfg.cnpj}</div>}
        {cfg.endereco && <div className="text-[10px]">{cfg.endereco}{cfg.cidade ? ` · ${cfg.cidade}/${cfg.uf || ''}` : ''}</div>}
        {cfg.cabecalhoImpressao && <div className="mt-1 text-[10px]">{cfg.cabecalhoImpressao}</div>}
        <div className="mt-2 font-semibold uppercase">Autorização de Exames</div>
        <div className="font-mono">{auth.codigo}</div>
      </div>

      <div className="space-y-1 mb-3">
        <div><strong>Paciente:</strong> {auth.patient.nome}</div>
        <div className="grid grid-cols-2 gap-1">
          <div><strong>CPF:</strong> {auth.patient.cpf || '—'}</div>
          <div><strong>CNS:</strong> {auth.patient.cns || '—'}</div>
        </div>
        {auth.patient.dataNascimento && <div><strong>Nascimento:</strong> {new Date(auth.patient.dataNascimento).toLocaleDateString('pt-BR')}</div>}
      </div>

      <table className="table w-full mb-3">
        <thead><tr><th className="text-left">Código</th><th className="text-left">Procedimento</th><th>Qtd</th></tr></thead>
        <tbody>
          {auth.items.map((it: any) => (
            <tr key={it.id}><td className="font-mono">{it.procedure.codigo}</td><td>{it.procedure.descricao}</td><td className="text-center">{it.qtd}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="border-2 border-slate-800 p-2 text-center mb-3">
        <div className="text-[10px] uppercase">Dirigir-se a:</div>
        <div className="font-bold uppercase">{auth.laboratory.razaoSocial}</div>
        {auth.laboratory.endereco && <div className="text-[10px]">{auth.laboratory.endereco}</div>}
        {auth.laboratory.telefone && <div className="text-[10px]">Tel: {auth.laboratory.telefone}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div><strong>Emitida em:</strong> {new Date(auth.emitidaEm).toLocaleString('pt-BR')}</div>
        <div><strong>Válida até:</strong> {new Date(auth.validaAte).toLocaleDateString('pt-BR')}</div>
        <div><strong>Status:</strong> {auth.status}</div>
      </div>

      <div className={variant === 'thermal' ? 'mt-6' : 'mt-12'}>
        <div className="border-t border-slate-800 mx-auto" style={{ width: variant === 'thermal' ? '90%' : '60%' }} />
        <div className="text-center text-[10px] mt-1">
          <div className="font-semibold uppercase">{auth.user?.nome || '—'}</div>
          <div>Matrícula: {auth.user?.matricula || '—'}</div>
          <div className="text-slate-500">Operador autorizador</div>
        </div>
      </div>

      {cfg.rodapeImpressao && <div className="text-center text-[10px] mt-3 border-t pt-1">{cfg.rodapeImpressao}</div>}
    </div>
  );
}
