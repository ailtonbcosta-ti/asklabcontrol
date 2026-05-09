import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import unzipper from 'unzipper';
import iconv from 'iconv-lite';

export interface SigtapData {
  procedimentos: any[];
  procCbos: any[];
  procServicos: any[];
  procCids: any[];
  procAtributos: any[];
  procRegras: any[];
  procHabilitacoes: any[];
  procRegistros: any[];
  erro?: string;
  aviso?: string;
}

async function extrairZip(arquivoZip: string, destino: string) {
  fs.mkdirSync(destino, { recursive: true });
  await fs
    .createReadStream(arquivoZip)
    .pipe(unzipper.Extract({ path: destino }))
    .promise();
}

function encontrarArquivo(dir: string, nome: string): string | null {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      const r = encontrarArquivo(full, nome);
      if (r) return r;
    } else if (f.toLowerCase() === nome.toLowerCase()) {
      return full;
    }
  }
  return null;
}

function parseSigtapInt(str: string): number | null {
  const n = parseInt(str.trim(), 10);
  if (isNaN(n) || n === 9999 || n === 0) return null;
  return n;
}

function parseTabelaCodigoDescricao(dirBase: string, nomeArquivo: string): Map<string, string> {
  const filePath = encontrarArquivo(dirBase, nomeArquivo);
  const mapa = new Map<string, string>();
  if (!filePath) return mapa;
  const lines = fs.readFileSync(filePath, 'latin1').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d{1,4})\s+(.+)$/);
    if (!m) continue;
    mapa.set(m[1].padStart(m[1].length <= 2 ? 2 : m[1].length, '0'), m[2].trim());
  }
  return mapa;
}

function aplicarMetadados(data: SigtapData) {
  const atributosPorProc = new Map<string, Set<string>>();
  const regrasPorProc = new Map<string, Set<string>>();
  for (const it of data.procAtributos) {
    const s = atributosPorProc.get(it.codigoProcedimento) || new Set();
    s.add(it.codigoAtributo);
    atributosPorProc.set(it.codigoProcedimento, s);
  }
  for (const it of data.procRegras) {
    const s = regrasPorProc.get(it.codigoProcedimento) || new Set();
    s.add(it.codigoRegra);
    regrasPorProc.set(it.codigoProcedimento, s);
  }
  data.procedimentos = data.procedimentos.map((p) => {
    const a = atributosPorProc.get(p.codigo) || new Set();
    const r = regrasPorProc.get(p.codigo) || new Set();
    return {
      ...p,
      admiteContinuidade: a.has('014'),
      exigeDadosComplementares: a.has('022'),
      exigeCpf: a.has('058'),
      exigeCidCausasAssoc: a.has('043'),
      apacValidade2Comp: a.has('054'),
      programaMaisAcesso: a.has('052') || a.has('053'),
      exigeTomografia: a.has('056'),
      exigeRessonancia: a.has('057'),
      verificaHabilitTerceiro: a.has('013'),
      exigeSecundarioCompativel: a.has('026'),
      possuiRegra0011: r.has('0011'),
    };
  });
}

export async function processarTabelaUnificada(arquivoZip: string, competencia: string): Promise<SigtapData> {
  const tmpDir = path.join(os.tmpdir(), `sigtap_${competencia}_${Date.now()}`);
  try {
    await extrairZip(arquivoZip, tmpDir);
  } catch (e: any) {
    return blankResult({ erro: `Falha ao extrair ZIP: ${e.message}` });
  }

  const data: SigtapData = blankResult();
  const obrig = ['tb_procedimento.txt', 'rl_procedimento_ocupacao.txt', 'rl_procedimento_servico.txt', 'rl_procedimento_cid.txt'];
  const faltando: string[] = [];

  const descAtributos = parseTabelaCodigoDescricao(tmpDir, 'tb_atributo_complementar.txt');
  const descRegras = parseTabelaCodigoDescricao(tmpDir, 'tb_regra_condicionada.txt');
  const descHab = parseTabelaCodigoDescricao(tmpDir, 'tb_habilitacao.txt');
  const descReg = parseTabelaCodigoDescricao(tmpDir, 'tb_registro.txt');

  async function readLines(nomeArq: string, cb: (line: string) => void) {
    const filePath = encontrarArquivo(tmpDir, nomeArq);
    if (!filePath) {
      if (obrig.includes(nomeArq)) faltando.push(nomeArq);
      return;
    }
    const stream = fs.createReadStream(filePath).pipe(iconv.decodeStream('latin1'));
    const rl = readline.createInterface({ input: stream as any, crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim()) cb(line);
    }
  }

  // tb_procedimento.txt
  await readLines('tb_procedimento.txt', (line) => {
    if (line.substring(330, 336).trim() !== competencia) return;
    const codigo = line.substring(0, 10).trim();
    const descricao = line.substring(10, 260).trim();
    if (!codigo) return;
    const tpSexo = line.substring(261, 262).trim() || null;
    data.procedimentos.push({
      codigo,
      descricao,
      complexidade: line.substring(260, 261).trim() || null,
      tpSexo: tpSexo && tpSexo !== 'N' ? tpSexo : null,
      qtMaximaExecucao: parseSigtapInt(line.substring(262, 266)),
      vlIdadeMinima: parseSigtapInt(line.substring(274, 278)),
      vlIdadeMaxima: parseSigtapInt(line.substring(278, 282)),
      codigoFinanciamento: line.substring(318, 320).trim() || null,
    });
  });

  const procsComServico = new Set<string>();
  const procsComCid = new Set<string>();

  await readLines('rl_procedimento_ocupacao.txt', (line) => {
    if (line.substring(16, 22).trim() !== competencia) return;
    const proc = line.substring(0, 10).trim();
    const cbo = line.substring(10, 16).trim();
    if (proc && cbo) data.procCbos.push({ codigoProcedimento: proc, cbo });
  });

  await readLines('rl_procedimento_servico.txt', (line) => {
    if (line.substring(16, 22).trim() !== competencia) return;
    const proc = line.substring(0, 10).trim();
    const srv = line.substring(10, 13).trim();
    const clf = line.substring(13, 16).trim();
    if (proc && srv) {
      procsComServico.add(proc);
      data.procServicos.push({
        codigoProcedimento: proc,
        codigoServico: srv.padStart(3, '0'),
        codigoClassificacao: clf.padStart(3, '0'),
      });
    }
  });

  await readLines('rl_procedimento_cid.txt', (line) => {
    if (line.substring(15, 21).trim() !== competencia) return;
    const proc = line.substring(0, 10).trim();
    const cid = line.substring(10, 14).trim();
    const stPrincipal = line.substring(14, 15).trim() || 'S';
    if (proc && cid) {
      procsComCid.add(proc);
      data.procCids.push({ codigoProcedimento: proc, cid, stPrincipal });
    }
  });

  await readLines('rl_procedimento_atributo_complementar.txt', (line) => {
    if (line.substring(13, 19).trim() !== competencia) return;
    const proc = line.substring(0, 10).trim();
    const codigoAtributo = line.substring(10, 13).trim().padStart(3, '0');
    if (proc && codigoAtributo) {
      data.procAtributos.push({
        codigoProcedimento: proc,
        codigoAtributo,
        descricaoAtributo: descAtributos.get(codigoAtributo) || null,
      });
    }
  });

  await readLines('rl_procedimento_regra_condicionada.txt', (line) => {
    if (line.substring(14, 20).trim() !== competencia) return;
    const proc = line.substring(0, 10).trim();
    const codigoRegra = line.substring(10, 14).trim().padStart(4, '0');
    if (proc && codigoRegra) {
      data.procRegras.push({
        codigoProcedimento: proc,
        codigoRegra,
        descricaoRegra: descRegras.get(codigoRegra) || null,
      });
    }
  });

  await readLines('rl_procedimento_habilitacao.txt', (line) => {
    if (line.substring(14, 20).trim() !== competencia) return;
    const proc = line.substring(0, 10).trim();
    const codigoHabilitacao = line.substring(10, 14).trim().padStart(4, '0');
    if (proc && codigoHabilitacao) {
      data.procHabilitacoes.push({
        codigoProcedimento: proc,
        codigoHabilitacao,
        descricaoHabilitacao: descHab.get(codigoHabilitacao) || null,
      });
    }
  });

  await readLines('rl_procedimento_registro.txt', (line) => {
    if (line.substring(14, 20).trim() !== competencia) return;
    const proc = line.substring(0, 10).trim();
    const codigoRegistro = line.substring(10, 14).trim().padStart(2, '0');
    if (proc && codigoRegistro) {
      data.procRegistros.push({
        codigoProcedimento: proc,
        codigoRegistro,
        descricaoRegistro: descReg.get(codigoRegistro) || null,
      });
    }
  });

  data.procedimentos = data.procedimentos.map((p) => ({
    ...p,
    exigeServico: procsComServico.has(p.codigo),
    exigeCid: procsComCid.has(p.codigo),
  }));
  aplicarMetadados(data);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  if (faltando.length || data.procedimentos.length === 0) {
    return blankResult({
      erro: faltando.length
        ? `ZIP inválido. Faltam: ${faltando.join(', ')}`
        : `Nenhum procedimento da competência ${competencia} encontrado.`,
    });
  }
  return data;
}

function blankResult(extra?: Partial<SigtapData>): SigtapData {
  return {
    procedimentos: [],
    procCbos: [],
    procServicos: [],
    procCids: [],
    procAtributos: [],
    procRegras: [],
    procHabilitacoes: [],
    procRegistros: [],
    ...extra,
  };
}
