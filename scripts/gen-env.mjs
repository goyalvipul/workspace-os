// Creates .env from .env.example with fresh random secrets. Never overwrites an existing .env.
// Secrets are written to the file only; they are never printed.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.env');
if (existsSync(target)) {
  console.log('.env already exists; leaving it untouched.');
  process.exit(0);
}
let text = readFileSync(resolve(root, '.env.example'), 'utf8');
const set = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, () => `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
};
set('SESSION_SECRET', randomBytes(48).toString('base64url'));
set('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
try {
  const require = createRequire(resolve(root, 'apps/server/package.json'));
  const webpush = require('web-push');
  const keys = webpush.generateVAPIDKeys();
  set('VAPID_PUBLIC_KEY', keys.publicKey);
  set('VAPID_PRIVATE_KEY', keys.privateKey);
  set('VAPID_CONTACT_EMAIL', 'mailto:owner@localhost.invalid');
} catch {
  console.log('Skipped VAPID key generation (web-push not installed yet).');
}
writeFileSync(target, text, { mode: 0o600 });
console.log('.env created with generated secrets (not displayed).');
