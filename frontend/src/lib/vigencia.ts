// Situação da vigência de um contrato (datas gravadas como meia-noite UTC).
export type SituacaoVigencia = 'inativo' | 'futuro' | 'vencido' | 'a_vencer' | 'vigente';

export function situacaoVigencia(c: { vigenciaInicio: string; vigenciaFim: string; ativo?: boolean }) {
  const hoje = new Date();
  const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const ini = new Date(c.vigenciaInicio).getTime();
  const fim = new Date(c.vigenciaFim).getTime();
  const dias = Math.round((fim - hojeUTC) / 86_400_000);
  let s: SituacaoVigencia;
  if (c.ativo === false) s = 'inativo';
  else if (fim < hojeUTC) s = 'vencido';
  else if (ini > hojeUTC) s = 'futuro';
  else if (dias <= 60) s = 'a_vencer';
  else s = 'vigente';
  return { situacao: s, dias };
}

export function rotuloVigencia(c: { vigenciaInicio: string; vigenciaFim: string; ativo?: boolean }) {
  const { situacao, dias } = situacaoVigencia(c);
  switch (situacao) {
    case 'inativo': return { texto: 'Inativo', classe: 'badge-slate' };
    case 'vencido': return { texto: 'Vencido', classe: 'badge-red' };
    case 'futuro': return { texto: 'A iniciar', classe: 'badge-brand' };
    case 'a_vencer': return { texto: dias === 0 ? 'Vence hoje' : `Vence em ${dias} dia${dias === 1 ? '' : 's'}`, classe: 'badge-amber' };
    default: return { texto: 'Vigente', classe: 'badge-green' };
  }
}
