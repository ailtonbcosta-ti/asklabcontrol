import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { maskCnpj, isValidCnpj, onlyDigits } from '../../lib/cnpj';
import { maskPhone, isValidPhone, onlyDigitsPhone } from '../../lib/phone';

export function LaboratoriesList() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['labs'], queryFn: () => api.get('/laboratories').then((r) => r.data) });
  const [edit, setEdit] = useState<any>(null);

  async function excluir(l: any) {
    if (!confirm(`Excluir o laboratório "${l.razaoSocial}"?\n\nIsso o marcará como inativo. Contratos e autorizações vinculados serão preservados.`)) return;
    try {
      await api.delete(`/laboratories/${l.id}`);
      toast.success('Laboratório excluído');
      qc.invalidateQueries({ queryKey: ['labs'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao excluir');
    }
  }

  async function salvar() {
    const cnpjDigits = onlyDigits(edit.cnpj);
    if (cnpjDigits && !isValidCnpj(cnpjDigits)) {
      toast.error('CNPJ inválido');
      return;
    }
    const telDigits = onlyDigitsPhone(edit.telefone);
    if (telDigits && !isValidPhone(telDigits)) {
      toast.error('Telefone inválido (10 ou 11 dígitos)');
      return;
    }
    try {
      const payload = { ...edit, cnpj: cnpjDigits || null, telefone: telDigits || null };
      if (edit.id) await api.patch(`/laboratories/${edit.id}`, payload);
      else await api.post('/laboratories', payload);
      toast.success('Salvo');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['labs'] });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Laboratórios</h1>
        <button className="btn-primary" onClick={() => setEdit({ razaoSocial: '', ativo: true })}>+ Novo</button>
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>Razão social</th><th>CNPJ</th><th>Telefone</th><th>Ativo</th><th></th></tr></thead>
          <tbody>
            {data?.map((l: any) => (
              <tr key={l.id}>
                <td>{l.razaoSocial}</td><td className="font-mono text-xs">{l.cnpjFormatado || maskCnpj(l.cnpj) || '—'}</td><td>{l.telefoneFormatado || maskPhone(l.telefone) || '—'}</td><td>{l.ativo ? 'Sim' : 'Não'}</td>
                <td className="whitespace-nowrap">
                  <button
                    title="Editar"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-brand"
                    onClick={() => setEdit({ ...l, cnpj: maskCnpj(l.cnpj), telefone: maskPhone(l.telefone) })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="Excluir"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 text-slate-600 hover:text-red-600 ml-1"
                    onClick={() => excluir(l)}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="card w-full max-w-lg space-y-2">
            <h2 className="font-semibold">{edit.id ? 'Editar laboratório' : 'Novo laboratório'}</h2>
            <input className="input" placeholder="Razão social" value={edit.razaoSocial || ''} onChange={(e) => setEdit({ ...edit, razaoSocial: e.target.value })} />
            <div>
              <input
                className={`input ${edit.cnpj && onlyDigits(edit.cnpj).length === 14 && !isValidCnpj(edit.cnpj) ? 'border-red-500' : ''}`}
                placeholder="CNPJ (00.000.000/0000-00)"
                inputMode="numeric"
                maxLength={18}
                value={edit.cnpj || ''}
                onChange={(e) => setEdit({ ...edit, cnpj: maskCnpj(e.target.value) })}
              />
              {edit.cnpj && onlyDigits(edit.cnpj).length === 14 && !isValidCnpj(edit.cnpj) && (
                <div className="text-xs text-red-600 mt-1">CNPJ inválido</div>
              )}
            </div>
            <input className="input" placeholder="Endereço" value={edit.endereco || ''} onChange={(e) => setEdit({ ...edit, endereco: e.target.value })} />
            <div>
              <input
                className={`input ${edit.telefone && [10, 11].indexOf(onlyDigitsPhone(edit.telefone).length) === -1 && onlyDigitsPhone(edit.telefone).length > 0 && onlyDigitsPhone(edit.telefone).length >= 10 ? 'border-red-500' : ''}`}
                placeholder="Telefone (00) 00000-0000"
                inputMode="numeric"
                maxLength={15}
                value={edit.telefone || ''}
                onChange={(e) => setEdit({ ...edit, telefone: maskPhone(e.target.value) })}
              />
              {edit.telefone && onlyDigitsPhone(edit.telefone).length > 0 && !isValidPhone(edit.telefone) && (
                <div className="text-xs text-red-600 mt-1">Telefone deve ter 10 ou 11 dígitos</div>
              )}
            </div>
            <input className="input" placeholder="E-mail" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
