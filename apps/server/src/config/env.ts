import { z } from 'zod';
import { isValidTimezone } from '@wos/shared';

const PLACEHOLDER = /^(GENERATE_|REPLACE_|CHANGE_ME)/i;

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const num = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_PORT: num(3000, 1),
  APP_HOST: z.string().default('0.0.0.0'),
  HOST_PUBLISHED_PORT: num(4390, 1),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4390'),
  TRUSTED_ORIGINS: z.string().default(''),
  DATABASE_PATH: z.string().default('./.data/workspace.sqlite'),
  BACKUP_DIR: z.string().default('./.data/backups'),
  WEB_DIST_DIR: optionalString,
  OWNER_TIMEZONE: z.string().default('America/Vancouver'),
  SESSION_SECRET: optionalString,
  DATA_ENCRYPTION_KEY: optionalString,
  DATA_ENCRYPTION_KEY_VERSION: num(1, 1),
  DATA_ENCRYPTION_KEY_PREVIOUS: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:4390/api/v1/calendar/oauth/google/callback'),
  MS_CLIENT_ID: optionalString,
  MS_CLIENT_SECRET: optionalString,
  MS_TENANT: z.string().default('common'),
  MS_REDIRECT_URI: z.string().default('http://localhost:4390/api/v1/calendar/oauth/microsoft/callback'),
  GOOGLE_API_BASE: z.string().url().default('https://www.googleapis.com'),
  GOOGLE_AUTH_BASE: z.string().url().default('https://accounts.google.com'),
  GOOGLE_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  MS_GRAPH_BASE: z.string().url().default('https://graph.microsoft.com/v1.0'),
  MS_LOGIN_BASE: z.string().url().default('https://login.microsoftonline.com'),
  ACTIVE_SYNC_SECONDS: num(60, 10),
  IDLE_SYNC_SECONDS: num(300, 30),
  BACKUP_RETENTION_DAILY: num(7, 1),
  BACKUP_RETENTION_WEEKLY: num(4, 0),
  BACKUP_RETENTION_MONTHLY: num(3, 0),
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_CONTACT_EMAIL: optionalString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DISABLE_SCHEDULER: z.coerce.boolean().default(false),
  GIT_SHA: z.string().default('dev'),
  BUILD_TIME: z.string().default(''),
  /** Test only: disable HTTP rate limits */
  DISABLE_RATE_LIMIT: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof schema> & {
  trustedOrigins: string[];
  isProd: boolean;
  secureCookies: boolean;
};

export class ConfigError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      'Invalid configuration:\n' + parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  const e = parsed.data;
  const problems: string[] = [];
  if (!isValidTimezone(e.OWNER_TIMEZONE)) problems.push('OWNER_TIMEZONE is not a valid IANA timezone');
  const isProd = e.NODE_ENV === 'production';

  if (isProd) {
    if (!e.SESSION_SECRET || e.SESSION_SECRET.length < 32 || PLACEHOLDER.test(e.SESSION_SECRET)) {
      problems.push('SESSION_SECRET must be set to a random value of at least 32 characters (see .env.example)');
    }
    if (!e.DATA_ENCRYPTION_KEY || PLACEHOLDER.test(e.DATA_ENCRYPTION_KEY)) {
      problems.push('DATA_ENCRYPTION_KEY must be set to 32 random bytes, base64 encoded (see .env.example)');
    }
    if (PLACEHOLDER.test(e.PUBLIC_BASE_URL) || /REPLACE_WITH/.test(e.PUBLIC_BASE_URL)) {
      problems.push('PUBLIC_BASE_URL still contains the placeholder from .env.example');
    }
  }
  if (e.DATA_ENCRYPTION_KEY && !PLACEHOLDER.test(e.DATA_ENCRYPTION_KEY)) {
    if (Buffer.from(e.DATA_ENCRYPTION_KEY, 'base64').length !== 32) problems.push('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  if (problems.length) throw new ConfigError('Invalid configuration:\n' + problems.map((p) => `  - ${p}`).join('\n'));

  const origin = (u: string) => {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  };
  const trusted = new Set<string>();
  const pub = origin(e.PUBLIC_BASE_URL);
  if (pub) trusted.add(pub);
  trusted.add(`http://localhost:${e.HOST_PUBLISHED_PORT}`);
  trusted.add(`http://127.0.0.1:${e.HOST_PUBLISHED_PORT}`);
  if (!isProd) {
    trusted.add('http://localhost:5173');
    trusted.add('http://127.0.0.1:5173');
  }
  for (const o of e.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)) {
    const x = origin(o);
    if (x) trusted.add(x);
  }

  // Development / test fallbacks only. Never used in production (validated above).
  const devSecret = 'dev-only-session-secret-change-me-0123456789abcdef';
  const devKey = Buffer.alloc(32, 7).toString('base64');
  return {
    ...e,
    SESSION_SECRET: e.SESSION_SECRET && !PLACEHOLDER.test(e.SESSION_SECRET) ? e.SESSION_SECRET : devSecret,
    DATA_ENCRYPTION_KEY: e.DATA_ENCRYPTION_KEY && !PLACEHOLDER.test(e.DATA_ENCRYPTION_KEY) ? e.DATA_ENCRYPTION_KEY : devKey,
    trustedOrigins: [...trusted],
    isProd,
    secureCookies: e.PUBLIC_BASE_URL.startsWith('https://'),
  };
}
