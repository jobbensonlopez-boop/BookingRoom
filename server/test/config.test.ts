// Runtime configuration: what the browser is told, and which settings are required.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Db } from '../src/db';

const base = { DATABASE_URL: 'postgres://unused', OFFICE_TIMEZONE: 'Asia/Dubai' };
const entra = {
  ...base,
  ENTRA_TENANT_ID: 'tenant-id',
  ENTRA_API_CLIENT_ID: 'api-client-id',
  ENTRA_SPA_CLIENT_ID: 'spa-client-id',
};
const appFor = (env: NodeJS.ProcessEnv) => createApp({ config: loadConfig(env), db: {} as Db });

describe('GET /api/client-config', () => {
  it('gives the browser the SPA client id, tenant and API scope (no auth needed)', async () => {
    const res = await request(appFor(entra)).get('/api/client-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      authMode: 'entra', tenantId: 'tenant-id', clientId: 'spa-client-id', apiScope: 'api://api-client-id/access_as_user',
    });
  });

  it('honours an explicit ENTRA_API_SCOPE', async () => {
    const res = await request(appFor({ ...entra, ENTRA_API_SCOPE: 'api://custom/scope' })).get('/api/client-config');
    expect(res.body.apiScope).toBe('api://custom/scope');
  });

  it('reports dev mode so the browser skips sign-in', async () => {
    const res = await request(appFor({ ...base, AUTH_MODE: 'dev' })).get('/api/client-config');
    expect(res.body).toEqual({ authMode: 'dev' });
  });

  it('still protects the API in entra mode', async () => {
    expect((await request(appFor(entra)).get('/api/me')).status).toBe(401);
  });
});

describe('loadConfig', () => {
  it('requires the SPA client id in entra mode', () => {
    const { ENTRA_SPA_CLIENT_ID: _, ...missing } = entra;
    expect(() => loadConfig(missing)).toThrow('ENTRA_SPA_CLIENT_ID');
  });

  it('refuses dev auth in production', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'dev', NODE_ENV: 'production' })).toThrow('not allowed');
  });

  it('rejects an invalid timezone', () => {
    expect(() => loadConfig({ ...entra, OFFICE_TIMEZONE: 'Mars/Olympus' })).toThrow('not a valid IANA timezone');
  });
});
