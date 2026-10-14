// Client-generatable ULIDs (Crockford base32, 26 chars). Works in browser and Node.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

let lastTime = 0;
let lastRandom: number[] = [];

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

function encodeTime(time: number): string {
  let out = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = ENCODING[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/** Monotonic ULID generator (ids created in the same millisecond still sort in order). */
export function newId(now: number = Date.now()): string {
  if (now === lastTime && lastRandom.length === 16) {
    for (let i = 15; i >= 0; i--) {
      if (lastRandom[i] === 31) lastRandom[i] = 0;
      else {
        lastRandom[i] = (lastRandom[i] as number) + 1;
        break;
      }
    }
  } else {
    lastTime = now;
    lastRandom = Array.from(randomBytes(16), (b) => b % 32);
  }
  return encodeTime(now) + lastRandom.map((i) => ENCODING[i]).join('');
}

export function isUlid(v: unknown): v is string {
  return typeof v === 'string' && ULID_REGEX.test(v);
}
