import type { RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthConfig } from './config';

export interface User {
  id: string;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

/**
 * Resolves the signed-in user. In production this validates a Microsoft Entra ID
 * access token (restricted to the company tenant). The organizer of a booking
 * always comes from here, never from the request body.
 */
export function authenticate(cfg: AuthConfig): RequestHandler {
  if (cfg.mode === 'dev') {
    // Local development only. `X-Dev-User: Some Name` impersonates another user.
    return (req, _res, next) => {
      const name = req.header('x-dev-user')?.trim();
      req.user = name ? { id: 'dev-' + name.toLowerCase().replace(/\W+/g, '-'), name } : { id: cfg.userId, name: cfg.userName };
      next();
    };
  }

  const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${cfg.tenantId}/discovery/v2.0/keys`));
  const issuer = [`https://login.microsoftonline.com/${cfg.tenantId}/v2.0`, `https://sts.windows.net/${cfg.tenantId}/`];
  const audience = [cfg.clientId, `api://${cfg.clientId}`];

  return async (req, res, next) => {
    const m = /^Bearer (.+)$/i.exec(req.header('authorization') ?? '');
    if (!m) return res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in required.' } });
    try {
      const { payload } = await jwtVerify(m[1], jwks, { issuer, audience });
      const scopes = String(payload.scp ?? '').split(' ');
      if (payload.tid !== cfg.tenantId || !scopes.includes(cfg.requiredScope) || typeof payload.oid !== 'string')
        return res.status(403).json({ error: { code: 'forbidden', message: 'This account cannot use room booking.' } });
      const name = (payload.name ?? payload.preferred_username ?? payload.upn ?? 'Unknown user') as string;
      req.user = { id: payload.oid, name };
      next();
    } catch {
      res.status(401).json({ error: { code: 'unauthenticated', message: 'Your session has expired. Sign in again.' } });
    }
  };
}
