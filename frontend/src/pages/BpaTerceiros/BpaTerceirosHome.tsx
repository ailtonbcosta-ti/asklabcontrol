import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

// ─── tipos ────────────────────────────────────────────────────────────────────
interface IgnoradoSemId {
  protocolo: string; nome: string; cpf: string; cns: string;
  dataAtendimento: string; examenome: string;
}
interface IgnoradoSemCod {
  protocolo: string; nome: string; codTabela: string;
  examenome: string; quantidade: number;
}
interface RelatorioIgnorados {
  competencia: string;
  semId: IgnoradoSemId[];
  semCodigo: IgnoradoSemCod[];
  qtdZero: IgnoradoSemCod[];
}

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
  const [loadingIgnorados, setLoadingIgnorados] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioIgnorados | null>(null);

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

  // ── relatório ignorados: abrir modal ──────────────────────────────────────
  async function abrirRelatorio() {
    setLoadingIgnorados(true);
    try {
      const r = await api.get(`/bpa-terceiros/ignorados?competencia=${competencia}`);
      setRelatorio(r.data);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Erro ao carregar relatório');
    } finally {
      setLoadingIgnorados(false);
    }
  }

  // ── relatório ignorados: imprimir / PDF ────────────────────────────────────
  function imprimirRelatorio(rel: RelatorioIgnorados, label: string) {
    const e = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const th = (cols: string[]) => cols.map(c => `<th>${e(c)}</th>`).join('');
    const td = (cols: unknown[]) => cols.map(c => `<td>${e(c)}</td>`).join('');

    const tabelaSemId = rel.semId.length
      ? `<table><thead><tr>${th(['#','Protocolo','Paciente','Data Atend.','Procedimento','CPF','CNS'])}</tr></thead><tbody>
          ${rel.semId.map((r, i) => `<tr class="${i%2?'alt':''}"><td>${i+1}</td>${td([r.protocolo,r.nome,r.dataAtendimento,r.examenome,r.cpf||'—',r.cns||'—'])}</tr>`).join('')}
         </tbody></table>`
      : '<p class="vazio">Nenhum registro nesta categoria.</p>';

    const tabelaSemCod = rel.semCodigo.length
      ? `<table><thead><tr>${th(['#','Protocolo','Paciente','Procedimento','Código','Qtd.'])}</tr></thead><tbody>
          ${rel.semCodigo.map((r, i) => `<tr class="${i%2?'alt':''}"><td>${i+1}</td>${td([r.protocolo,r.nome,r.examenome,r.codTabela||'—',r.quantidade])}</tr>`).join('')}
         </tbody></table>`
      : '<p class="vazio">Nenhum registro nesta categoria.</p>';

    const tabelaQtdZero = rel.qtdZero.length
      ? `<table><thead><tr>${th(['#','Protocolo','Paciente','Procedimento','Código SIGTAP','Qtd.'])}</tr></thead><tbody>
          ${rel.qtdZero.map((r, i) => `<tr class="${i%2?'alt':''}"><td>${i+1}</td>${td([r.protocolo,r.nome,r.examenome,r.codTabela||'—',r.quantidade])}</tr>`).join('')}
         </tbody></table>`
      : '<p class="vazio">Nenhum registro nesta categoria.</p>';

    const total = rel.semId.length + rel.semCodigo.length + rel.qtdZero.length;
    const agora = new Date().toLocaleString('pt-BR');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Ignorados — ${e(label)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #2563eb}
  .header h1{font-size:16px;color:#1e40af;font-weight:700}
  .header .meta{font-size:10px;color:#64748b;margin-top:4px}
  .header .badge{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:6px 12px;text-align:right;font-size:10px}
  .badge strong{font-size:14px;color:#dc2626;display:block}
  .section{margin-bottom:20px}
  .section-title{display:flex;align-items:center;gap:8px;background:#f8fafc;border-left:4px solid #2563eb;padding:6px 10px;margin-bottom:8px;border-radius:0 4px 4px 0}
  .section-title span{font-size:12px;font-weight:700;color:#1e3a8a;text-transform:uppercase;letter-spacing:.04em}
  .section-title .count{margin-left:auto;background:#ef4444;color:#fff;border-radius:999px;padding:1px 8px;font-size:10px;font-weight:700}
  .section-title.green{border-left-color:#16a34a}.section-title.green span{color:#14532d}.section-title.green .count{background:#16a34a}
  .section-title.orange{border-left-color:#d97706}.section-title.orange span{color:#92400e}.section-title.orange .count{background:#d97706}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#e2e8f0;color:#334155;text-align:left;padding:4px 6px;border:1px solid #cbd5e1;font-weight:700;white-space:nowrap}
  td{padding:3px 6px;border:1px solid #e2e8f0;vertical-align:top}
  tr.alt td{background:#f8fafc}
  .vazio{color:#94a3b8;font-style:italic;padding:8px 0;font-size:10px}
  .print-btn{display:inline-block;margin-bottom:16px;padding:6px 14px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600}
  @media print{.print-btn{display:none}@page{margin:1.5cm;size:A4 landscape}body{padding:0}table{page-break-inside:auto}tr{page-break-inside:avoid}}
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨️ Imprimir / Exportar PDF</button>
<div class="header">
  <div>
    <h1>Relatório de Itens Ignorados</h1>
    <div class="meta">Competência: <strong>${e(label)}</strong> &nbsp;|&nbsp; Gerado em: ${e(agora)}</div>
  </div>
  <div class="badge">Total ignorados<strong>${total.toLocaleString('pt-BR')}</strong></div>
</div>

<div class="section">
  <div class="section-title"><span>Sem CPF nem CNS</span><span class="count">${rel.semId.length.toLocaleString('pt-BR')}</span></div>
  ${tabelaSemId}
</div>

<div class="section">
  <div class="section-title orange"><span>Sem código de tabela (codTabela vazio)</span><span class="count">${rel.semCodigo.length.toLocaleString('pt-BR')}</span></div>
  ${tabelaSemCod}
</div>

<div class="section">
  <div class="section-title green"><span>Quantidade = 0 (cancelados)</span><span class="count">${rel.qtdZero.length.toLocaleString('pt-BR')}</span></div>
  ${tabelaQtdZero}
</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=1280,height=900');
    if (!w) { toast.error('Permita pop-ups para imprimir.'); return; }
    w.document.write(html);
    w.document.close();
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

              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn-primary" onClick={exportar}
                  disabled={exporting || preview.incluidos === 0 || !cfg.cnes || !cfg.cnsProfissional || !cfg.cbo}>
                  {exporting ? 'Gerando arquivo...' : `Gerar arquivo BPA — ${labelComp}`}
                </button>
                {(preview.excluidos_sem_id > 0 || preview.excluidos_sem_codigo > 0 || preview.excluidos_qtd_zero > 0) && (
                  <button className="btn-outline" onClick={abrirRelatorio} disabled={loadingIgnorados}>
                    {loadingIgnorados ? 'Carregando...' : 'Relatório Ignorados'}
                  </button>
                )}
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

      {/* ── Modal: Relatório Ignorados ───────────────────────────────────────── */}
      {relatorio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={e => { if (e.target === e.currentTarget) setRelatorio(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl max-h-[90vh]">

            {/* Header do modal */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Relatório de Itens Ignorados</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Competência: <span className="font-medium text-slate-700">{labelComp}</span>
                  &nbsp;·&nbsp;
                  {(relatorio.semId.length + relatorio.semCodigo.length + relatorio.qtdZero.length).toLocaleString('pt-BR')} itens ignorados no total
                </p>
              </div>
              <div className="flex gap-2 ml-4 shrink-0">
                <button className="btn-outline text-sm" onClick={() => imprimirRelatorio(relatorio, labelComp)}>
                  🖨️ Imprimir / PDF
                </button>
                <button className="btn-outline text-sm" onClick={() => setRelatorio(null)}>✕ Fechar</button>
              </div>
            </div>

            {/* Corpo scrollável */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">

              {/* Seção: sem CPF nem CNS */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-1 self-stretch bg-red-500 rounded-full shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-800">Sem CPF nem CNS</div>
                    <div className="text-xs text-slate-500">Pacientes sem identificação — não entrarão no arquivo BPA</div>
                  </div>
                  <span className="ml-auto bg-red-100 text-red-700 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {relatorio.semId.length.toLocaleString('pt-BR')}
                  </span>
                </div>
                {relatorio.semId.length === 0
                  ? <p className="text-sm text-slate-400 italic">Nenhum registro nesta categoria.</p>
                  : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 text-slate-600">
                            {['#','Protocolo','Paciente','Data Atend.','Procedimento','CPF','CNS'].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-semibold border-b border-slate-200 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {relatorio.semId.map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                              <td className="px-3 py-1.5 text-slate-400 border-b border-slate-100">{i+1}</td>
                              <td className="px-3 py-1.5 font-mono border-b border-slate-100">{r.protocolo}</td>
                              <td className="px-3 py-1.5 font-medium border-b border-slate-100">{r.nome}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100">{r.dataAtendimento}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100">{r.examenome}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100 text-slate-400">{r.cpf || '—'}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100 text-slate-400">{r.cns || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

              {/* Seção: sem código de tabela */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-1 self-stretch bg-amber-500 rounded-full shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-800">Sem código de tabela (codTabela vazio)</div>
                    <div className="text-xs text-slate-500">Procedimentos sem código SIGTAP cadastrado na view</div>
                  </div>
                  <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {relatorio.semCodigo.length.toLocaleString('pt-BR')}
                  </span>
                </div>
                {relatorio.semCodigo.length === 0
                  ? <p className="text-sm text-slate-400 italic">Nenhum registro nesta categoria.</p>
                  : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 text-slate-600">
                            {['#','Protocolo','Paciente','Procedimento','Código','Qtd.'].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-semibold border-b border-slate-200 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {relatorio.semCodigo.map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                              <td className="px-3 py-1.5 text-slate-400 border-b border-slate-100">{i+1}</td>
                              <td className="px-3 py-1.5 font-mono border-b border-slate-100">{r.protocolo}</td>
                              <td className="px-3 py-1.5 font-medium border-b border-slate-100">{r.nome}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100">{r.examenome}</td>
                              <td className="px-3 py-1.5 text-slate-400 border-b border-slate-100">{r.codTabela || '—'}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100">{r.quantidade}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

              {/* Seção: quantidade zero */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-1 self-stretch bg-slate-400 rounded-full shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-800">Quantidade = 0 (cancelados)</div>
                    <div className="text-xs text-slate-500">Atendimentos cancelados ou zerados — excluídos do arquivo</div>
                  </div>
                  <span className="ml-auto bg-slate-100 text-slate-600 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {relatorio.qtdZero.length.toLocaleString('pt-BR')}
                  </span>
                </div>
                {relatorio.qtdZero.length === 0
                  ? <p className="text-sm text-slate-400 italic">Nenhum registro nesta categoria.</p>
                  : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 text-slate-600">
                            {['#','Protocolo','Paciente','Procedimento','Código SIGTAP','Qtd.'].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-semibold border-b border-slate-200 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {relatorio.qtdZero.map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                              <td className="px-3 py-1.5 text-slate-400 border-b border-slate-100">{i+1}</td>
                              <td className="px-3 py-1.5 font-mono border-b border-slate-100">{r.protocolo}</td>
                              <td className="px-3 py-1.5 font-medium border-b border-slate-100">{r.nome}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100">{r.examenome}</td>
                              <td className="px-3 py-1.5 font-mono border-b border-slate-100">{r.codTabela || '—'}</td>
                              <td className="px-3 py-1.5 border-b border-slate-100">{r.quantidade}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl shrink-0 flex justify-between items-center">
              <p className="text-xs text-slate-400">
                Gerado em {new Date().toLocaleString('pt-BR')}
              </p>
              <div className="flex gap-2">
                <button className="btn-outline text-sm" onClick={() => imprimirRelatorio(relatorio, labelComp)}>
                  🖨️ Imprimir / Exportar PDF
                </button>
                <button className="btn-outline text-sm" onClick={() => setRelatorio(null)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
