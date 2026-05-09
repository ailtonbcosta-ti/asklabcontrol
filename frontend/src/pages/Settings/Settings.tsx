import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Trash2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';

type LogoTipo = 'sistema' | 'a4' | 'thermal80';
const LOGO_FIELD: Record<LogoTipo, 'logoUrl' | 'logoA4Url' | 'logoThermal80Url'> = {
  sistema: 'logoUrl',
  a4: 'logoA4Url',
  thermal80: 'logoThermal80Url',
};
const LOGO_LABEL: Record<LogoTipo, string> = {
  sistema: 'Logotipo do sistema',
  a4: 'Logotipo para impressão A4',
  thermal80: 'Logotipo para impressão térmica 80mm',
};
const LOGO_HINT: Record<LogoTipo, string> = {
  sistema: 'Aparece na tela de login e na barra lateral. PNG/SVG transparente recomendado.',
  a4: 'Cabeçalho da autorização em A4. Use alta resolução. PNG ou JPG.',
  thermal80: 'Impressora térmica monocromática. PNG preto-e-branco com largura ≤ 384px.',
};

export function Settings() {
  const [cfg, setCfg] = useState<any>(null);
  const [uploading, setUploading] = useState<LogoTipo | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [resetting, setResetting] = useState(false);
  const me = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const nav = useNavigate();
  useEffect(() => { api.get('/config').then((r) => setCfg(r.data)); }, []);
  if (!cfg) return null;

  async function executarReset() {
    if (resetText !== 'EXCLUIR TUDO') return;
    setResetting(true);
    try {
      await api.post('/config/reset', { confirmacao: 'EXCLUIR TUDO' });
      toast.success('Sistema resetado. Faça login novamente.');
      clearAuth();
      // pequeno delay para o toast aparecer
      setTimeout(() => { try { api.post('/auth/logout'); } catch { /* ignore */ } nav('/login'); }, 800);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha no reset');
    } finally { setResetting(false); }
  }

  async function uploadLogo(tipo: LogoTipo, file: File) {
    if (!file) return;
    const fd = new FormData(); fd.append('arquivo', file);
    setUploading(tipo);
    try {
      const r = await api.post(`/config/logo?tipo=${tipo}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setCfg(r.data.config);
      toast.success('Logotipo atualizado');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha no upload');
    } finally { setUploading(null); }
  }

  async function removeLogo(tipo: LogoTipo) {
    if (!confirm(`Remover ${LOGO_LABEL[tipo].toLowerCase()}?`)) return;
    try {
      const r = await api.delete(`/config/logo?tipo=${tipo}`);
      setCfg(r.data);
      toast.success('Logotipo removido');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro'); }
  }

  function set(k: string, v: any) { setCfg({ ...cfg, [k]: v }); }
  async function salvar() {
    try { await api.put('/config', cfg); toast.success('Salvo'); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Erro'); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      <div className="card">
        <h2 className="font-semibold mb-3">Logotipos</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(['sistema', 'a4', 'thermal80'] as LogoTipo[]).map((tipo) => {
            const url = cfg[LOGO_FIELD[tipo]] as string | null;
            const isThermal = tipo === 'thermal80';
            return (
              <div key={tipo} className="border border-slate-200 rounded p-2 flex flex-col">
                <div className="text-xs font-semibold mb-1">{LOGO_LABEL[tipo]}</div>
                <div className={`flex items-center justify-center mb-2 rounded h-28 ${isThermal ? 'bg-white' : 'bg-slate-50'} border border-slate-100`}>
                  {url ? (
                    <img src={url} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-xs text-slate-400">sem logo</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 mb-2">{LOGO_HINT[tipo]}</div>
                <div className="flex gap-1 mt-auto">
                  <label className="btn-outline flex-1 inline-flex items-center justify-center gap-1 cursor-pointer text-xs">
                    <Upload size={12} /> {uploading === tipo ? 'Enviando…' : url ? 'Substituir' : 'Enviar'}
                    <input type="file" accept="image/*" hidden disabled={!!uploading}
                           onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(tipo, f); e.target.value = ''; }} />
                  </label>
                  {url && (
                    <button title="Remover" className="px-2 rounded border border-slate-300 hover:bg-red-50 hover:border-red-300 text-slate-500 hover:text-red-600"
                            onClick={() => removeLogo(tipo)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="label">Razão social</label><input className="input" value={cfg.razaoSocial} onChange={(e) => set('razaoSocial', e.target.value)} /></div>
        <div><label className="label">CNPJ</label><input className="input" value={cfg.cnpj || ''} onChange={(e) => set('cnpj', e.target.value)} /></div>
        <div><label className="label">Telefone</label><input className="input" value={cfg.telefone || ''} onChange={(e) => set('telefone', e.target.value)} /></div>
        <div className="col-span-2"><label className="label">Endereço</label><input className="input" value={cfg.endereco || ''} onChange={(e) => set('endereco', e.target.value)} /></div>
        <div><label className="label">Cidade</label><input className="input" value={cfg.cidade || ''} onChange={(e) => set('cidade', e.target.value)} /></div>
        <div><label className="label">UF</label><input className="input" maxLength={2} value={cfg.uf || ''} onChange={(e) => set('uf', e.target.value.toUpperCase())} /></div>
        <div className="col-span-2"><label className="label">Validade da autorização (dias)</label>
          <input className="input" type="number" value={cfg.validadeAutorizacaoDias} onChange={(e) => set('validadeAutorizacaoDias', Number(e.target.value))} />
        </div>
        <div className="col-span-2"><label className="label">Cabeçalho impressão</label><input className="input" value={cfg.cabecalhoImpressao || ''} onChange={(e) => set('cabecalhoImpressao', e.target.value)} /></div>
        <div className="col-span-2"><label className="label">Rodapé impressão</label><input className="input" value={cfg.rodapeImpressao || ''} onChange={(e) => set('rodapeImpressao', e.target.value)} /></div>
      </div>
      <button className="btn-primary" onClick={salvar}>Salvar</button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card">
          <h2 className="font-semibold mb-1">Tabela SIGTAP</h2>
          <p className="text-sm text-slate-600 mb-2">Competência vigente: <strong>{cfg.sigtapCompetenciaVigente || '—'}</strong></p>
          <Link className="btn-outline" to="/configuracoes/sigtap">Gerenciar tabela</Link>
        </div>
        <div className="card">
          <h2 className="font-semibold mb-1">Conexão PEC</h2>
          <p className="text-sm text-slate-600 mb-2">Banco e-SUS para sincronização de pacientes.</p>
          <Link className="btn-outline" to="/configuracoes/pec">Configurar PEC</Link>
        </div>
      </div>

      {me?.role === 'ADMIN' && (
        <div className="border-2 border-red-300 bg-red-50 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle size={18} />
            <h2 className="font-semibold uppercase tracking-wide">Zona de risco</h2>
          </div>
          <p className="text-sm text-red-800">
            <strong>Resetar o sistema</strong> apaga <strong>permanentemente</strong> todos os pacientes,
            laboratórios, contratos, autorizações, procedimentos, tabela SIGTAP, configuração de PEC,
            logotipos e demais usuários. Essa ação <strong>não pode ser desfeita</strong>. Apenas a sua
            conta de administrador é preservada para que você possa configurar um novo estabelecimento.
          </p>
          <button
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-3 py-2 rounded"
            onClick={() => { setResetText(''); setResetOpen(true); }}
          >
            <Trash2 size={14} /> Resetar sistema…
          </button>
        </div>
      )}

      {resetOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 border-2 border-red-400">
            <div className="flex items-center gap-2 text-red-700 mb-3">
              <AlertTriangle size={22} />
              <h3 className="font-bold uppercase">Atenção — ação irreversível</h3>
            </div>
            <div className="text-sm text-slate-800 space-y-2 mb-4">
              <p>Você está prestes a <strong>apagar todos os dados</strong> do sistema:</p>
              <ul className="list-disc ml-5 text-xs text-slate-700">
                <li>Pacientes, autorizações e itens pendentes</li>
                <li>Laboratórios, contratos e cotas mensais</li>
                <li>Procedimentos cadastrados</li>
                <li>Competências SIGTAP importadas</li>
                <li>Configuração de conexão com PEC</li>
                <li>Logotipos e parâmetros do estabelecimento</li>
                <li>Demais usuários (apenas você será preservado)</li>
              </ul>
              <p className="text-red-700 font-medium">Os dados <u>não poderão</u> ser recuperados.</p>
            </div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Para confirmar, digite <span className="font-mono bg-red-100 text-red-700 px-1 rounded">EXCLUIR TUDO</span> abaixo:
            </label>
            <input
              autoFocus
              className="input border-red-300 focus:ring-red-500 focus:border-red-500"
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              placeholder="EXCLUIR TUDO"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setResetOpen(false)} disabled={resetting}>Cancelar</button>
              <button
                className="inline-flex items-center gap-1 bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-2 rounded"
                onClick={executarReset}
                disabled={resetText !== 'EXCLUIR TUDO' || resetting}
              >
                <Trash2 size={14} /> {resetting ? 'Apagando...' : 'Confirmar reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
