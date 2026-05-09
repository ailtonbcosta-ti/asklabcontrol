import { Client } from 'basic-ftp';
import fs from 'fs';
import { env } from '../../config/env';

const PADRAO = /^TabelaUnificada_(\d{6})(?:_v(\d{10}))?\.zip$/i;

export interface FtpEntry {
  nome: string;
  competencia: string;
  versao: string | null;
  tamanho: number;
}

export async function obterTabelaMaisRecente(): Promise<FtpEntry | null> {
  const client = new Client(30_000);
  client.ftp.verbose = false;
  try {
    await client.access({ host: env.SIGTAP_FTP_HOST, secure: false });
    await client.cd(env.SIGTAP_FTP_DIR);
    const lista = await client.list();
    const candidatos: FtpEntry[] = [];
    for (const item of lista) {
      const m = item.name.match(PADRAO);
      if (!m) continue;
      candidatos.push({ nome: item.name, competencia: m[1], versao: m[2] || null, tamanho: item.size });
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) =>
      a.competencia !== b.competencia
        ? b.competencia.localeCompare(a.competencia)
        : (b.versao || '').localeCompare(a.versao || ''),
    );
    return candidatos[0];
  } finally {
    client.close();
  }
}

export async function baixarArquivo(nome: string, destino: string) {
  const client = new Client(120_000);
  client.ftp.verbose = false;
  try {
    await client.access({ host: env.SIGTAP_FTP_HOST, secure: false });
    await client.cd(env.SIGTAP_FTP_DIR);
    await client.downloadTo(destino, nome);
    return { caminho: destino, tamanho: fs.statSync(destino).size };
  } finally {
    client.close();
  }
}
