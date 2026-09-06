import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

// ─── tipos ────────────────────────────────────────────────────────────────────
interface Cfg {
  ativo: boolean;
  mysqlHost: string; mysqlPort: number; mysqlDatabase: string; mysqlUsuario: string;
  mysqlViewName: string; temSenha: boolean;
  cnes: string; cnsProfissional: string; cbo: string; ine: string; ibgeMunicipio: string;
  orgaoOrigem: string; orgaoDestino: string; indicadorDestino: string; versao: string;
  ultimoTesteEm?: string | null; ultimoTesteOk?: boolean | null; ultimoTesteMsg?: string | null;
}
interface Preview {
  competencia: string; total: number; incluidos: number; protocolos: number;
  procedimentos: number; excluidos_sem_id: number; excluidos_sem_codigo: number;
  excluidos_qtd_zero: number; com_endereco: number;
}

const blankCfg: Cfg = {
  ativo: false, mysqlHost: '', mysqlPort: 3306, mysqlDatabase: '', mysqlUsuario: '',
  mysqlViewName: 'atendimentobpa', temSenha: false,
  cnes: '', cnsProfissional: '', cbo: '', ine: '', ibgeMunicipio: '',
  orgaoOrigem: '', orgaoDestino: '', indicadorDestino: 'M', versao: 'D05.00',
};

// ─── helpers ──────────────────────────────────────────────────────────────────
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function competenciasDisponiveis() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return { value: `${yyyy}${mm}`, label: `${MESES[d.getMonth()]}/${yyyy}` };
  });
}

// ─── componente ───────────────────────────────────────────────────────────────
export function BpaTerceirosHome() {
  const [tab, setTab] = useState<'exportar' | 'config'>('exportar');
  const [cfg, setCfg] = useState<Cfg>(blankCfg);
  const [senha, setSenha] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [competencia, setCompetencia] = useState(competenciasDisponiveis()[1].value);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.get('/bpa-terceiros/config')
      .then(r => setCfg(r.data))
      .catch((e: any) => {
        const msg = e.response?.data?.error;
        if (msg) toast.error(`Erro ao carregar configuração: ${msg}`);
      });
  }, []);

  function setC<K extends keyof Cfg>(k: K, v: Cfg[K]) { setCfg(c => ({ ...c, [k]: v })); }

  // ── config: salvar ──────────────────────────────────────────────────────────
  async function salvarConfig() {
    setSaving(true);
    try {
      const payload: any = { ...cfg };
      if (senha) payload.senha = senha;
      delete payload.temSenha; delete payload.ultimoTesteEm;
      delete payload.ultimoTesteOk; delete payload.ultimoTesteMsg;
      const r = await api.put('/bpa-terceiros/config', payload);
      setCfg(r.data); setSenha('');
      toast.success('Configuração salva');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSaving(false); }
  }

  // ── config: testar conexão ─────────────────────────────────────────────────
  async function testarConexao() {
    setTesting(true);
    try {
      const r = await api.post('/bpa-terceiros/config/testar', {
        mysqlHost: cfg.mysqlHost, mysqlPort: cfg.mysqlPort,
        mysqlDatabase: cfg.mysqlDatabase, mysqlUsuario: cfg.mysqlUsuario,
        mysqlViewName: cfg.mysqlViewName, ...(senha ? { senha } : {}),
      });
      if (r.data.ok) toast.success(r.data.mensagem);
      else toast.error(r.data.mensagem);
      const cur = await api.get('/bpa-terceiros/config'); setCfg(cur.data);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Falha no teste'); }
    finally { setTesting(false); }
  }

  // ── exportação: preview ────────────────────────────────────────────────────
  async function carregarPreview() {
    setLoadingPreview(true); setPreview(null);
    try {
      const r = await api.get(`/bpa-terceiros/preview?competencia=${competencia}`);
      setPreview(r.data);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro ao carregar prévia'); }
    finally { setLoadingPreview(false); }
  }

  // ── exportação: gerar arquivo ─────────────────────────────────────────────
  async function exportar() {
    setExporting(true);
    try {
      const r = await api.get(`/bpa-terceiros/exportar?competencia=${competencia}`, { responseType: 'blob' });
      const disp: string = r.headers['content-disposition'] || '';
      const match = disp.match(/filename="([^"]+)"/);
      const nome = match ? match[1] : `PA_${competencia}.MAR`;
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = nome;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const invalidos = Number(r.headers['x-bpa-invalidos'] ?? 0);
      if (invalidos) toast(`Arquivo gerado com ${invalidos} registro(s) ignorado(s) (código inválido).`, { icon: '⚠️' });
      else toast.success(`Arquivo ${nome} gerado com sucesso!`);
    } catch (e: any) {
      if (e.response?.data instanceof Blob) {
        const txt = await e.response.data.text();
        try { const j = JSON.parse(txt); toast.error(j.error || 'Erro ao exportar'); }
        catch { toast.error('Erro ao exportar'); }
      } else { toast.error(e.response?.data?.error || 'Erro ao exportar'); }
    } finally { setExporting(false); }
  }

  const competencias = competenciasDisponiveis();
  const labelComp = competencias.find(c => c.value === competencia)?.label ?? competencia;

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">BPA Terceiros</h1>
      <p className="text-sm text-slate-600">
        Geração do arquivo BPA-I a partir dos dados do sistema terceiro (view externa MySQL).
      </p>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-200">
        {([['exportar', 'Exportação BPA'], ['config', 'Config Sistema Terceiro']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Aba: Exportação ──────────────────────────────────────────────────── */}
      {tab === 'exportar' && (
        <div className="space-y-4">
          {!cfg.ativo && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              A integração com o sistema terceiro está <strong>inativa</strong>. Configure a conexão na aba{' '}
              <button className="underline font-medium" onClick={() => setTab('config')}>Config Sistema Terceiro</button>.
            </div>
          )}
          {cfg.ativo && (!cfg.cnes || !cfg.cnsProfissional || !cfg.cbo) && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              CNES, CNS do profissional e CBO são obrigatórios para exportar.{' '}
              <button className="underline font-medium" onClick={() => setTab('config')}>Configurar agora</button>
            </div>
          )}

          <div className="card flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Competência</label>
              <select className="input" value={competencia} onChange={e => { setCompetencia(e.target.value); setPreview(null); }}>
                {competencias.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <button className="btn-outline" onClick={carregarPreview} disabled={loadingPreview || !cfg.ativo}>
              {loadingPreview ? 'Carregando...' : 'Ver prévia'}
            </button>
          </div>

          {/* Prévia */}
          {preview && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-base">Prévia — {labelComp}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Total de itens na view', value: preview.total.toLocaleString('pt-BR'), color: 'text-slate-700' },
                  { label: 'Serão incluídos', value: preview.incluidos.toLocaleString('pt-BR'), color: 'text-green-700 font-semibold' },
                  { label: 'Protocolos distintos', value: preview.protocolos.toLocaleString('pt-BR'), color: 'text-blue-700' },
                  { label: 'Procedimentos distintos', value: preview.procedimentos.toLocaleString('pt-BR'), color: 'text-blue-700' },
                  { label: 'Com endereço', value: preview.com_endereco.toLocaleString('pt-BR'), color: 'text-slate-600' },
                ].map(s => (
                  <div key={s.label} className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500 mb-1">{s.label}</div>
                    <div className={`text-xl ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {(preview.excluidos_sem_id > 0 || preview.excluidos_sem_codigo > 0 || preview.excluidos_qtd_zero > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm space-y-1">
                  <div className="font-semibold text-amber-800">Itens que serão ignorados:</div>
                  {preview.excluidos_sem_id > 0 && <div className="text-amber-700">• {preview.excluidos_sem_id.toLocaleString('pt-BR')} sem CPF nem CNS</div>}
                  {preview.excluidos_sem_codigo > 0 && <div className="text-amber-700">• {preview.excluidos_sem_codigo.toLocaleString('pt-BR')} sem código de tabela (codTabela vazio)</div>}
                  {preview.excluidos_qtd_zero > 0 && <div className="text-amber-700">• {preview.excluidos_qtd_zero.toLocaleString('pt-BR')} com quantidade = 0 (cancelados)</div>}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button className="btn-primary" onClick={exportar}
                  disabled={exporting || preview.incluidos === 0 || !cfg.cnes || !cfg.cnsProfissional || !cfg.cbo}>
                  {exporting ? 'Gerando arquivo...' : `Gerar arquivo BPA — ${labelComp}`}
                </button>
              </div>
            </div>
          )}

          {/* Gerar direto sem prévia */}
          {!preview && cfg.ativo && (
            <div className="text-sm text-slate-500 italic">
              Clique em <strong>Ver prévia</strong> para conferir os dados antes de exportar.
            </div>
          )}
        </div>
      )}

      {/* ── Aba: Config Sistema Terceiro ─────────────────────────────────────── */}
      {tab === 'config' && (
        <div className="space-y-4">

          {/* Conexão MySQL */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-base">Conexão MySQL (sistema terceiro)</h2>

            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cfg.ativo} onChange={e => setC('ativo', e.target.checked)} />
                <strong>Integração ativa</strong>
                <span className="text-xs text-slate-500">(quando inativa, a exportação é bloqueada)</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Host</label>
                <input className="input" placeholder="ex: labmunguarabira.ddns.com.br"
                  value={cfg.mysqlHost} onChange={e => setC('mysqlHost', e.target.value)} />
              </div>
              <div>
                <label className="label">Porta</label>
                <input className="input" type="number" value={cfg.mysqlPort}
                  onChange={e => setC('mysqlPort', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Banco de dados</label>
                <input className="input" placeholder="ex: pmguarabira"
                  value={cfg.mysqlDatabase} onChange={e => setC('mysqlDatabase', e.target.value)} />
              </div>
              <div>
                <label className="label">Usuário</label>
                <input className="input" value={cfg.mysqlUsuario}
                  onChange={e => setC('mysqlUsuario', e.target.value)} />
              </div>
              <div>
                <label className="label">Senha</label>
                <input className="input" type="password"
                  placeholder={cfg.temSenha ? '•••• (mantém atual se vazio)' : 'definir senha'}
                  value={senha} onChange={e => setSenha(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label">Nome da view</label>
                <input className="input" placeholder="atendimentobpa"
                  value={cfg.mysqlViewName} onChange={e => setC('mysqlViewName', e.target.value)} />
              </div>
            </div>

            {cfg.ultimoTesteEm && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${cfg.ultimoTesteOk ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                <div className="font-semibold">{cfg.ultimoTesteOk ? '✅ Último teste: OK' : '❌ Último teste: Falha'}</div>
                <div className="text-xs text-slate-500">{new Date(cfg.ultimoTesteEm).toLocaleString('pt-BR')}</div>
                <div className="text-sm mt-1">{cfg.ultimoTesteMsg}</div>
              </div>
            )}

            <div className="flex gap-2">
              <button className="btn-outline" onClick={testarConexao}
                disabled={testing || !cfg.mysqlHost || !cfg.mysqlDatabase || !cfg.mysqlUsuario}>
                {testing ? 'Testando...' : '🔌 Testar conexão'}
              </button>
            </div>
          </div>

          {/* Configurações BPA */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-base">Parâmetros de geração do BPA</h2>
            <p className="text-xs text-slate-500">
              Dados do estabelecimento executor usados para montar o arquivo BPA-I.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">CNES do estabelecimento</label>
                <input className="input" maxLength={7} placeholder="7 dígitos"
                  value={cfg.cnes} onChange={e => setC('cnes', e.target.value)} />
              </div>
              <div>
                <label className="label">CNS do profissional</label>
                <input className="input" maxLength={15} placeholder="15 dígitos"
                  value={cfg.cnsProfissional} onChange={e => setC('cnsProfissional', e.target.value)} />
              </div>
              <div>
                <label className="label">CBO</label>
                <input className="input" maxLength={6} placeholder="6 dígitos"
                  value={cfg.cbo} onChange={e => setC('cbo', e.target.value)} />
              </div>
              <div>
                <label className="label">INE (equipe)</label>
                <input className="input" maxLength={10} placeholder="10 chars (opcional)"
                  value={cfg.ine} onChange={e => setC('ine', e.target.value)} />
              </div>
              <div>
                <label className="label">Cód. IBGE do município</label>
                <input className="input" maxLength={6} placeholder="6 dígitos"
                  value={cfg.ibgeMunicipio} onChange={e => setC('ibgeMunicipio', e.target.value)} />
              </div>
              <div>
                <label className="label">Indicador destino</label>
                <select className="input" value={cfg.indicadorDestino} onChange={e => setC('indicadorDestino', e.target.value)}>
                  <option value="M">M — Municipal</option>
                  <option value="E">E — Estadual</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Órgão origem (nome do estabelecimento no BPA)</label>
                <input className="input" placeholder="ex: LABORATORIO MUNICIPAL DE GUARABIRA"
                  value={cfg.orgaoOrigem} onChange={e => setC('orgaoOrigem', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label">Órgão destino</label>
                <input className="input" placeholder="ex: SMS GUARABIRA"
                  value={cfg.orgaoDestino} onChange={e => setC('orgaoDestino', e.target.value)} />
              </div>
              <div>
                <label className="label">Versão do sistema</label>
                <input className="input" maxLength={10} placeholder="D05.00"
                  value={cfg.versao} onChange={e => setC('versao', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary" onClick={salvarConfig} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar configuração'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
