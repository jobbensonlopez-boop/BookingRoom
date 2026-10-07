import { isValidTimeZone } from '@kelmer/shared';

export type AuthConfig =
  | { mode: 'entra'; tenantId: string; clientId: string; requiredScope: string }
  | { mode: 'dev'; userId: string; userName: string };

export interface Config {
  port: number;
  databaseUrl: string;
  timeZone: string;
  room: { name: string; capacity: number };
  auth: AuthConfig;
  staticDir: string | null;
}

function required(env: NodeJS.ProcessEnv, key: string) {
  const v = env[key]?.trim();
  if (!v) throw new Error(`Missing required environment variable ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const timeZone = required(env, 'OFFICE_TIMEZONE');
  if (!isValidTimeZone(timeZone)) throw new Error(`OFFICE_TIMEZONE "${timeZone}" is not a valid IANA timezone`);

  const capacity = Number(env.ROOM_CAPACITY ?? 8);
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('ROOM_CAPACITY must be a positive integer');

  const mode = env.AUTH_MODE ?? 'entra';
  let auth: AuthConfig;
  if (mode === 'entra') {
    auth = {
      mode,
      tenantId: required(env, 'ENTRA_TENANT_ID'),
      clientId: required(env, 'ENTRA_API_CLIENT_ID'),
      requiredScope: env.ENTRA_REQUIRED_SCOPE ?? 'access_as_user',
    };
  } else if (mode === 'dev') {
    if (env.NODE_ENV === 'production') throw new Error('AUTH_MODE=dev is not allowed when NODE_ENV=production');
    auth = { mode, userId: env.DEV_USER_ID ?? 'dev-alex', userName: env.DEV_USER_NAME ?? 'Alex Morgan' };
  } else {
    throw new Error(`AUTH_MODE must be "entra" or "dev", got "${mode}"`);
  }

  return {
    port: Number(env.PORT ?? 3001),
    databaseUrl: required(env, 'DATABASE_URL'),
    timeZone,
    room: { name: env.ROOM_NAME ?? 'Boardroom', capacity },
    auth,
    staticDir: env.STATIC_DIR ?? null,
  };
}
