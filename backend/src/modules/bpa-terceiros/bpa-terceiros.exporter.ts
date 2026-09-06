import iconv from 'iconv-lite';

// ─── Helpers de formatação (portados do MaltrapilhoCP/bpa.exporter.js) ────────

function f(val: any, len: number, numeric = false): string {
  const s = String(val ?? '').trim();
  if (s === '') return ''.padEnd(len, ' ');
  if (numeric) return s.padStart(len, '0').substring(0, len);
  return s.padEnd(len, ' ').substring(0, len);
}

function f0(val: any, len: number): string {
  return String(val ?? '').trim().padStart(len, '0').substring(0, len);
}

function simNaoBpa(val: any): string {
  const x = String(val ?? '').trim().toUpperCase();
  if (x === 'S') return 'S';
  if (x === '') return ' ';
  return 'N';
}

const COMPETENCIA_SEM_CPF = '202607';
function competenciaAceitaSemCpf(c: string) {
  const s = String(c ?? '').replace(/\D/g, '');
  return s.length === 6 && s >= COMPETENCIA_SEM_CPF;
}

function formatarDataBpa(val: any): string {
  if (!val) return '00000000';
  const raw = String(val).trim();
  const digits = raw.replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) {
    const aaaa = Number(digits.slice(0, 4));
    const mm = Number(digits.slice(4, 6));
    const dd = Number(digits.slice(6, 8));
    if (aaaa >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return digits;
    const dd2 = Number(digits.slice(0, 2)), mm2 = Number(digits.slice(2, 4)), aaaa2 = Number(digits.slice(4, 8));
    if (aaaa2 >= 1900 && mm2 >= 1 && mm2 <= 12 && dd2 >= 1 && dd2 <= 31)
      return `${digits.slice(4, 8)}${digits.slice(2, 4)}${digits.slice(0, 2)}`;
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return `${String(parsed.getFullYear()).padStart(4, '0')}${String(parsed.getMonth() + 1).padStart(2, '0')}${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return f0(digits, 8);
}

function extrairPartes(val: any): { ano: number; mes: number } | null {
  if (!val) return null;
  const raw = String(val).trim();
  const d = raw.replace(/\D/g, '');
  if (/^\d{8}$/.test(d)) {
    const aaaa = Number(d.slice(0, 4)), mm = Number(d.slice(4, 6)), dd = Number(d.slice(6, 8));
    if (aaaa >= 1900 && mm >= 1 && mm <= 12) return { ano: aaaa, mes: mm };
    const dd2 = Number(d.slice(0, 2)), mm2 = Number(d.slice(2, 4)), aaaa2 = Number(d.slice(4, 8));
    if (aaaa2 >= 1900 && mm2 >= 1 && mm2 <= 12) return { ano: aaaa2, mes: mm2 };
  }
  const p = new Date(raw);
  if (!isNaN(p.getTime())) return { ano: p.getFullYear(), mes: p.getMonth() + 1 };
  return null;
}

function formatarIdadeBpa(dataNascimento: any, dataAtendimento: any): string {
  const nasc = extrairPartes(dataNascimento);
  const atend = extrairPartes(dataAtendimento);
  if (nasc && atend) {
    let anos = atend.ano - nasc.ano;
    if (atend.mes < nasc.mes) anos -= 1;
    if (anos < 0) anos = 0;
    if (anos > 999) anos = 999;
    return String(anos).padStart(3, '0');
  }
  return '000';
}

function calcularCampoControle(linhas: string[]): number {
  let soma = 0;
  for (const l of linhas) {
    const tipo = l.substring(0, 2);
    const proc = tipo === '02' ? l.substring(26, 36) : l.substring(49, 59);
    const qtd  = tipo === '02' ? l.substring(39, 45) : l.substring(88, 94);
    soma += (/^\d+$/.test(proc) ? parseInt(proc, 10) : 0)
          + (/^\d+$/.test(qtd)  ? parseInt(qtd,  10) : 0);
  }
  return 1111 + (soma % 1111);
}

const MESES_EXT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
export function extensaoCompetencia(c: string) { return MESES_EXT[parseInt(c.substring(4, 6), 10) - 1] ?? 'JAN'; }
export function nomeArquivoBpa(cnes: string, competencia: string) {
  return `PA${cnes.padStart(7, '0')}${competencia.substring(2, 4)}${competencia.substring(4, 6)}.${extensaoCompetencia(competencia)}`;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface BpaFolhaCfg {
  cnes: string; competencia: string; cnsProfissional: string;
  cbo: string; ine?: string; indicadorDestino?: string;
}
export interface InfoHeader {
  competencia: string; orgaoOrigem: string; sigla: string; cgcCpf: string;
  orgaoDestino: string; indicadorDestino: string; versao: string;
}
export interface ViewRow {
  protocolo: string; nome: string; dataNascimento: string; sexo: string;
  cpf: string; cns: string; dataAtendimento: string; sigla: string;
  examenome: string; codTabela: string; quantidade: number | string;
  covnome: string; logradouro?: string; bairro?: string; complemento?: string;
  numero?: string; cep?: string; nomecid?: string; uf?: string;
}
export interface ExportStats {
  total: number; incluidos: number; excluidos_sem_id: number;
  excluidos_sem_codigo: number; excluidos_qtd_zero: number; protocolos: number;
}

// ─── Exportador principal ──────────────────────────────────────────────────────

export function gerarBpaTerceiros(
  rows: ViewRow[], folhaCfg: BpaFolhaCfg, infoHeader: InfoHeader
): { buffer: Buffer | null; invalidos: any[]; stats: ExportStats } {
  const total = rows.length;
  const semId = rows.filter(r => !r.cpf?.trim() && !r.cns?.trim()).length;
  const semCod = rows.filter(r => !r.codTabela?.trim()).length;
  const qtdZero = rows.filter(r => Number(r.quantidade) === 0).length;

  const incluidos = rows.filter(r =>
    (r.cpf?.trim() || r.cns?.trim()) &&
    r.codTabela?.trim() &&
    Number(r.quantidade) > 0
  );

  const protocolos = new Set(incluidos.map(r => r.protocolo)).size;
  const stats: ExportStats = {
    total, incluidos: incluidos.length, excluidos_sem_id: semId,
    excluidos_sem_codigo: semCod, excluidos_qtd_zero: qtdZero, protocolos,
  };

  if (incluidos.length === 0) return { buffer: null, invalidos: [], stats };

  const invalidos: any[] = [];
  const linhasTexto: string[] = [];
  let numFolha = 1, numSeq = 1;

  for (const row of incluidos) {
    if (numSeq > 99) { numFolha++; numSeq = 1; }

    const cpf = (row.cpf ?? '').trim();
    const cns = cpf ? '' : (row.cns ?? '').trim();
    const semCpfFlag = !cpf && cns ? 'S' : (cpf ? 'N' : ' ');
    const cepLimpo = (row.cep ?? '').replace(/\D/g, '').padStart(8, '0').substring(0, 8);

    const cod = (row.codTabela ?? '').trim();
    if (!/^\d{10}$/.test(cod)) {
      invalidos.push({ protocolo: row.protocolo, sigla: row.sigla, codTabela: cod, motivo: 'codTabela não tem 10 dígitos numéricos' });
      continue;
    }

    let l = '';
    l += '03';
    l += f0(folhaCfg.cnes, 7);
    l += f0(folhaCfg.competencia, 6);
    l += f(folhaCfg.cnsProfissional, 15, true);
    l += f(folhaCfg.cbo, 6, true);
    l += formatarDataBpa(row.dataAtendimento);
    l += f0(numFolha, 3);
    l += f0(numSeq, 2);
    l += f0(cod, 10);
    l += f(cns, 15, true);
    l += f(row.sexo || ' ', 1);
    l += f0((folhaCfg as any).ibgeMunicipio || '', 6);
    l += f('', 4);                                             // CID (vazio)
    l += formatarIdadeBpa(row.dataNascimento, row.dataAtendimento);
    l += f0(row.quantidade, 6);
    l += f0('1', 2);                                           // caráter: eletivo
    l += f('', 13);                                            // numAutorizacao
    l += f('BPA', 3);                                         // origem
    l += f(row.nome, 30);                                      // nomePaciente
    l += formatarDataBpa(row.dataNascimento);
    l += f0('01', 2);                                          // raça: branca
    l += f('', 4);                                             // etnia
    l += f0('010', 3);                                         // nacionalidade: brasileiro
    l += f('', 3, true);                                       // serviço
    l += f('', 3, true);                                       // classificação
    l += f(folhaCfg.ine ? folhaCfg.ine.substring(0, 8) : '', 8);
    l += f('', 4);                                             // equipeArea
    l += f('', 14, true);                                      // CNPJ
    l += f(cepLimpo, 8, true);
    l += f('', 3, true);                                       // cód logradouro
    l += f(row.logradouro, 30);
    l += f(row.complemento, 10);
    l += f(row.numero, 5);
    l += f(row.bairro, 30);
    l += f('', 11, true);                                      // telefone
    l += f('', 40);                                            // email
    l += f(folhaCfg.ine || '', 10);
    l += f(cpf, 11, true);
    l += simNaoBpa('N');                                       // situacaoRua
    l += f(competenciaAceitaSemCpf(folhaCfg.competencia) ? simNaoBpa(semCpfFlag) : ' ', 1);

    if (l.length !== 351) {
      invalidos.push({ protocolo: row.protocolo, sigla: row.sigla, motivo: `linha com ${l.length} chars (esperado 351)` });
      continue;
    }

    linhasTexto.push(l);
    numSeq++;
  }

  if (linhasTexto.length === 0) return { buffer: null, invalidos, stats };

  const totalLinhas = linhasTexto.length + 1;
  const totalFolhas = numFolha;
  const campoControle = calcularCampoControle(linhasTexto);

  const sigla = (infoHeader.orgaoOrigem || '').split(/\s+/)[0].substring(0, 6);

  let header = '01';
  header += '#BPA#';
  header += f0(folhaCfg.competencia, 6);
  header += f0(totalLinhas, 6);
  header += f0(totalFolhas, 6);
  header += f0(campoControle, 4);
  header += f(infoHeader.orgaoOrigem || '', 30);
  header += f(infoHeader.sigla || sigla, 6);
  header += f(infoHeader.cgcCpf || '', 14, true);
  header += f(infoHeader.orgaoDestino || '', 40);
  header += infoHeader.indicadorDestino === 'E' ? 'E' : 'M';
  header += f(infoHeader.versao || 'D05.00', 10);

  const conteudo = [header, ...linhasTexto].join('\r\n') + '\r\n';
  return { buffer: iconv.encode(conteudo, 'latin1'), invalidos, stats };
}
