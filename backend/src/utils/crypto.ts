import crypto from 'crypto';
import { env } from '../config/env';

// Deriva chave 32 bytes a partir do JWT_ACCESS_SECRET (já obrigatório em prod).
// Trocar a secret invalida senhas existentes — aceitável para uso interno.
const KEY = crypto.createHash('sha256').update(env.JWT_ACCESS_SECRET).digest();
const ALG = 'aes-256-gcm';

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [ivB, tagB, encB] = payload.split(':');
  const iv = Buffer.from(ivB, 'base64');
  const tag = Buffer.from(tagB, 'base64');
  const enc = Buffer.from(encB, 'base64');
  const decipher = crypto.createDecipheriv(ALG, KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
