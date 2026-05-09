import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { maskCnpj } from '../../lib/cnpj';

interface SigtapHit { codigo: string; descricao: string; complexidade?: string | null; tpSexo?: string | null; }

function SigtapCodeInput({
  value,
  matched,
  onPick,
  onChangeCodigo,
}: {
  value: string;
  matched?: boolean;
  onPick: (hit: SigtapHit) => void;
  onChangeCodigo: (v: string) => void;
}) {
  const [opts, setOpts] = useState<SigtapHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const blurRef = useRef<number | null>(null);

  function search(q: string) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.length < 3) { setOpts([]); return; }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await api.get<SigtapHit[]>('/sigtap/procedimentos', { params: { q } });
        setOpts(r.data);
        setOpen(true);
      } catch { setOpts([]); }
      finally { setLoading(false); }
    }, 250);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <input
          className="input font-mono text-xs w-24"
          value={value}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); onChangeCodigo(v); search(v); }}
          onFocus={() => { if (value.length >= 3) search(value); }}
          onBlur={() => { blurRef.current = window.setTimeout(() => setOpen(false), 200); }}
          placeholder="código"
        />
        {matched === true && <span title="Encontrado na SIGTAP" className="text-green-600 text-xs">✓</span>}
        {matched === false && <span title="Não encontrado — busque na SIGTAP" className="text-amber-600 text-xs">!</span>}
      </div>
      {open && (loading || opts.length > 0) && (
        <div className="absolute z-20 mt-1 left-0 w-[480px] max-h-60 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
          {loading && <div className="px-2 py-1 text-xs text-slate-500">buscando…</div>}
          {opts.map((s) => (
            <button
              key={s.codigo}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); if (blurRef.current) window.clearTimeout(blurRef.current); }}
              onClick={() => { onPick(s); setOpen(false); setOpts([]); }}
              className="block w-full text-left px-2 py-1 text-xs hover:bg-slate-100 border-b border-slate-100 last:border-0"
            >
              <span className="font-mono text-slate-700">{s.codigo}</span> · {s.descricao}
              {s.tpSexo && <span className="ml-1 text-[10px] bg-slate-100 px-1 rounded">{s.tpSexo}</span>}
            </button>
          ))}
          {!loading && opts.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">Nada encontrado</div>}
        </div>
      )}
    </div>
  );
}

interface ProcedimentoExtraido {
  _key: string;
  codigo: string;
  codigoOriginal?: string;
  descricao: string;
  descricaoOriginal?: string;
  quantidadeAnual: number;
  qtdMensal: number;
  valorUnitario: number;
  valorTotal: number | null;
  sigtapMatch?: boolean;
}

interface ParseResult {
  usadoOcr: boolean;
  numeroContrato: string | null;
  numeroCredenciamento: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  procedimentos: ProcedimentoExtraido[];
  totalProcedimentos: number;
  laboratorio: { id: number; razaoSocial: string } | null;
  sigtapCompetencia: string | null;
  sigtapMatched: number;
  sigtapMissing: number;
}

interface Props { onClose: () => void; onCreated: () => void; }

export function ContractPdfImport({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [parsing, setParsing] = useState(false);
  const [data, setData] = useState<ParseResult | null>(null);
  const [labs, setLabs] = useState<any[]>([]);
  const [form, setForm] = useState({
    numero: '',
    numeroCredenciamento: '',
    laboratoryId: 0,
    vigenciaInicio: '',
    vigenciaFim: '',
  });
  const [items, setItems] = useState<ProcedimentoExtraido[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/laboratories').then((r) => setLabs(r.data)); }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { toast.error('Envie um PDF'); return; }
    const fd = new FormData();
    fd.append('arquivo', file);
    setParsing(true);
    try {
      const r = await api.post<ParseResult>('/contracts/import-pdf/parse', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const today = new Date();
      const y = today.toISOString().slice(0, 10);
      const next = new Date(today); next.setFullYear(next.getFullYear() + 1);
      setData(r.data);
      setItems(r.data.procedimentos.map((p, idx) => ({ ...p, _key: `${idx}-${p.codigo}-${Date.now()}` })));
      setForm({
        numero: r.data.numeroContrato || '',
        numeroCredenciamento: r.data.numeroCredenciamento || '',
        laboratoryId: r.data.laboratorio?.id || 0,
        vigenciaInicio: y,
        vigenciaFim: next.toISOString().slice(0, 10),
      });
      setStep('review');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Falha ao analisar PDF');
    } finally {
      setParsing(false); e.target.value = '';
    }
  }

  function updateItem(i: number, patch: Partial<ProcedimentoExtraido>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  async function confirmar() {
    if (!form.numero) return toast.error('Informe o número do contrato');
    if (!form.laboratoryId) return toast.error('Selecione o laboratório');
    if (items.length === 0) return toast.error('Nenhum procedimento para importar');
    setSaving(true);
    try {
      const r = await api.post('/contracts/import-pdf/confirm', {
        ...form,
        procedimentos: items.map((p) => ({
          sigtapCodigo: p.codigo,
          descricao: p.descricao,
          quantidadeAnual: p.quantidadeAnual,
          qtdMensal: p.qtdMensal,
          valorUnitario: p.valorUnitario,
        })),
      });
      const dup = r.data?.duplicadosAgregados || 0;
      toast.success(
        dup > 0
          ? `Contrato criado. ${items.length - dup} procedimentos (${dup} duplicado${dup > 1 ? 's' : ''} agregado${dup > 1 ? 's' : ''}).`
          : `Contrato criado com ${items.length} procedimentos`,
      );
      onCreated();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao criar contrato');
    } finally { setSaving(false); }
  }

  const totalAnual = items.reduce((s, p) => s + p.quantidadeAnual * p.valorUnitario, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="card w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold">Importar contrato (PDF)</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>

        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Envie o PDF do contrato. O sistema extrai cabeçalho (número, credenciamento, CNPJ),
              identifica o laboratório pelo CNPJ e converte a quantidade anual em cota mensal (÷12).
            </p>
            <label className="btn-primary inline-flex items-center cursor-pointer">
              {parsing ? 'Analisando PDF...' : '📁 Selecionar PDF'}
              <input type="file" accept=".pdf,application/pdf" hidden onChange={upload} disabled={parsing} />
            </label>
          </div>
        )}

        {step === 'review' && data && (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-xs text-slate-500">
                {data.usadoOcr ? '⚠ Texto extraído via OCR (revise atentamente).' : '✓ Texto extraído da camada de texto do PDF.'}
              </div>
              {data.sigtapCompetencia ? (
                <div className="text-xs">
                  <span className="text-slate-500">SIGTAP {data.sigtapCompetencia}: </span>
                  <span className="text-green-700 font-medium">{data.sigtapMatched} cruzados</span>
                  {data.sigtapMissing > 0 && <span className="text-amber-700"> · {data.sigtapMissing} não encontrados</span>}
                </div>
              ) : (
                <div className="text-xs text-amber-700">⚠ Sem competência SIGTAP importada — descrições do PDF mantidas (ative em Configurações → Tabela SIGTAP).</div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Número do contrato</label>
                <input className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
              </div>
              <div>
                <label className="label">Nº do credenciamento</label>
                <input className="input" value={form.numeroCredenciamento} onChange={(e) => setForm({ ...form, numeroCredenciamento: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="label">
                  Laboratório
                  {data.cnpj && <span className="text-xs text-slate-500 ml-2">CNPJ no PDF: {maskCnpj(data.cnpj)} {data.razaoSocial ? `· ${data.razaoSocial}` : ''}</span>}
                </label>
                <select className="input" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: Number(e.target.value) })}>
                  <option value={0}>— selecione —</option>
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>{l.razaoSocial}{l.cnpj ? ` (${maskCnpj(l.cnpj)})` : ''}</option>
                  ))}
                </select>
                {data.cnpj && !data.laboratorio && (
                  <div className="text-xs text-amber-600 mt-1">
                    Nenhum laboratório cadastrado com este CNPJ. Cadastre antes em Laboratórios, ou selecione um existente.
                  </div>
                )}
              </div>
              <div>
                <label className="label">Vigência início</label>
                <input type="date" className="input" value={form.vigenciaInicio} onChange={(e) => setForm({ ...form, vigenciaInicio: e.target.value })} />
              </div>
              <div>
                <label className="label">Vigência fim</label>
                <input type="date" className="input" value={form.vigenciaFim} onChange={(e) => setForm({ ...form, vigenciaFim: e.target.value })} />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-semibold">Procedimentos extraídos ({items.length})</h3>
                <div className="text-sm text-slate-600">Total anual: <strong>R$ {totalAnual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
              </div>
              <div className="border border-slate-200 rounded max-h-96 overflow-y-auto">
                <table className="table">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th>Qtd anual</th>
                      <th>Qtd mensal (÷12)</th>
                      <th>Valor unit. (R$)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p, i) => (
                      <tr key={p._key} className={p.sigtapMatch === false ? 'bg-amber-50' : ''}>
                        <td>
                          <SigtapCodeInput
                            value={p.codigo}
                            matched={p.sigtapMatch}
                            onChangeCodigo={(v) => updateItem(i, { codigo: v, sigtapMatch: undefined })}
                            onPick={(hit) => updateItem(i, {
                              codigo: hit.codigo,
                              descricao: hit.descricao,
                              sigtapMatch: true,
                            })}
                          />
                        </td>
                        <td>
                          <input className="input text-xs" value={p.descricao} onChange={(e) => updateItem(i, { descricao: e.target.value })} />
                          {p.descricaoOriginal && p.descricaoOriginal !== p.descricao && (
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate">PDF: {p.descricaoOriginal}</div>
                          )}
                        </td>
                        <td>
                          <input type="number" min={1} className="input w-20" value={p.quantidadeAnual}
                                 onChange={(e) => {
                                   const q = Number(e.target.value) || 0;
                                   updateItem(i, { quantidadeAnual: q, qtdMensal: Math.max(1, Math.round(q / 12)) });
                                 }} />
                        </td>
                        <td>
                          <input type="number" min={1} className="input w-20" value={p.qtdMensal} onChange={(e) => updateItem(i, { qtdMensal: Number(e.target.value) || 1 })} />
                        </td>
                        <td>
                          <input type="number" step="0.01" min={0} className="input w-24" value={p.valorUnitario} onChange={(e) => updateItem(i, { valorUnitario: Number(e.target.value) || 0 })} />
                        </td>
                        <td>
                          <button title="Remover" className="text-red-600 hover:bg-red-50 rounded p-1" onClick={() => removeItem(i)}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {items.length === 0 && <tr><td colSpan={6} className="text-center py-4 text-slate-500">Nenhum procedimento</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
              <button className="btn-outline" onClick={() => setStep('upload')}>Voltar</button>
              <button className="btn-outline" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" onClick={confirmar} disabled={saving}>
                {saving ? 'Criando...' : `Criar contrato com ${items.length} procedimentos`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
