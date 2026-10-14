import { hash, verify } from '@node-rs/argon2';

// Argon2id is the library default algorithm. Parameters follow OWASP minimums (19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, OPTS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// A real argon2id hash of a random string, used to equalise timing for unknown users.
let dummy: Promise<string> | null = null;
export function dummyVerify(password: string): Promise<boolean> {
  dummy ??= hash('timing-equalisation-' + Math.random(), OPTS);
  return dummy.then((h) => verifyPassword(h, password));
}
