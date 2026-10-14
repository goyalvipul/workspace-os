import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const nowIso = (): string => new Date().toISOString();
export const sha256 = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function addMs(iso: string | Date, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
