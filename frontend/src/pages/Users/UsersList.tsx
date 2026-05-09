import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';

export function UsersList() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const { data } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then((r) => r.data) });
  const [edit, setEdit] = useState<any>(null);

  async function excluir(u: any) {
    if (u.id === me?.id) { toast.error('Não é possível excluir a própria conta'); return; }
    if (!confirm(`Excluir o usuário "${u.nome}"?\n\nEle será desativado e não conseguirá mais acessar o sistema. O histórico (autorizações emitidas, etc.) é preservado.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success('Usuário excluído');
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Falha ao excluir');
    }
  }

  async function salvar() {
    const matricula = (edit.matricula || '').replace(/\D/g, '');
    if (matricula && matricula.length !== 7) {
      toast.error('Matrícula deve ter exatamente 7 dígitos');
      return;
    }
    try {
      const payload = { ...edit, matricula: matricula || null };
      if (edit.id) await api.patch(`/users/${edit.id}`, payload);
      else await api.post('/users', payload);
      toast.success('Salvo');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Erro'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Usuários</h1>
        <button className="btn-primary" onClick={() => setEdit({ matricula: '', nome: '', email: '', role: 'OPERADOR', ativo: true, senha: '' })}>+ Novo</button>
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>Matrícula</th><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Ativo</th><th></th></tr></thead>
          <tbody>
            {data?.map((u: any) => (
              <tr key={u.id}>
                <td className="font-mono text-xs">{u.matricula || '—'}</td>
                <td>{u.nome}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.ativo ? 'Sim' : 'Não'}</td>
                <td className="whitespace-nowrap">
                  <button
                    title="Editar"
                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-slate-100 text-slate-600 hover:text-brand"
                    onClick={() => setEdit({ ...u, senha: '' })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title={u.id === me?.id ? 'Não é possível excluir a própria conta' : 'Excluir'}
                    className="inline-flex items-center justify-center w-7 h-7 rounded ml-1 text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => excluir(u)}
                    disabled={u.id === me?.id}
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
          <div className="card w-full max-w-md space-y-2">
            <h2 className="font-semibold">{edit.id ? 'Editar usuário' : 'Novo usuário'}</h2>
            <div>
              <input
                className={`input font-mono ${edit.matricula && (edit.matricula.replace(/\D/g, '').length !== 7) ? 'border-red-500' : ''}`}
                placeholder="Matrícula (7 dígitos)"
                inputMode="numeric"
                maxLength={7}
                value={edit.matricula || ''}
                onChange={(e) => setEdit({ ...edit, matricula: e.target.value.replace(/\D/g, '').slice(0, 7) })}
              />
              {edit.matricula && edit.matricula.replace(/\D/g, '').length > 0 && edit.matricula.replace(/\D/g, '').length !== 7 && (
                <div className="text-xs text-red-600 mt-1">Matrícula deve ter exatamente 7 dígitos</div>
              )}
            </div>
            <input className="input" placeholder="Nome" value={edit.nome || ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
            <input className="input" placeholder="E-mail" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            <select className="input" value={edit.role || 'OPERADOR'} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              <option value="ADMIN">Admin</option><option value="GESTOR">Gestor</option><option value="OPERADOR">Operador</option>
            </select>
            <input className="input" type="password" placeholder={edit.id ? 'Nova senha (deixe vazio para manter)' : 'Senha'} value={edit.senha || ''} onChange={(e) => setEdit({ ...edit, senha: e.target.value })} />
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
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
