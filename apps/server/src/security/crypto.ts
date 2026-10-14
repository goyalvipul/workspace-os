import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';

// AES-256-GCM, random 96-bit nonce per record, AAD binds ciphertext to its owner record and key version.
// Format: v1.<keyVersion>.<nonce b64url>.<ciphertext b64url>.<tag b64url>

export interface Keyring {
  currentVersion: number;
  keys: Map<number, Buffer>;
}

export function buildKeyring(env: Pick<Env, 'DATA_ENCRYPTION_KEY' | 'DATA_ENCRYPTION_KEY_VERSION' | 'DATA_ENCRYPTION_KEY_PREVIOUS'>): Keyring {
  const keys = new Map<number, Buffer>();
  const cur = Buffer.from(env.DATA_ENCRYPTION_KEY ?? '', 'base64');
  if (cur.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (base64)');
  keys.set(env.DATA_ENCRYPTION_KEY_VERSION, cur);
  if (env.DATA_ENCRYPTION_KEY_PREVIOUS) {
    const prev = Buffer.from(env.DATA_ENCRYPTION_KEY_PREVIOUS, 'base64');
    if (prev.length === 32) keys.set(env.DATA_ENCRYPTION_KEY_VERSION - 1, prev);
  }
  return { currentVersion: env.DATA_ENCRYPTION_KEY_VERSION, keys };
}

export function encryptString(ring: Keyring, plaintext: string, aad: string): { ciphertext: string; keyVersion: number } {
  const key = ring.keys.get(ring.currentVersion) as Buffer;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`${aad}:${ring.currentVersion}`));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ['v1', ring.currentVersion, nonce.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.'),
    keyVersion: ring.currentVersion,
  };
}

export function decryptString(ring: Keyring, payload: string, aad: string): string {
  const [v, ver, nonce, ct, tag] = payload.split('.');
  if (v !== 'v1' || !ver || !nonce || !ct || !tag) throw new Error('Malformed ciphertext');
  const version = Number(ver);
  const key = ring.keys.get(version);
  if (!key) throw new Error(`Encryption key version ${version} is not available (missing DATA_ENCRYPTION_KEY or *_PREVIOUS)`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(`${aad}:${version}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function keyVersionOf(payload: string): number {
  return Number(payload.split('.')[1] ?? 0);
}
