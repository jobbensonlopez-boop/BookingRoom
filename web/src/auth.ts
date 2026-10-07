import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';

/**
 * Microsoft Entra ID single sign-on. Sign-in is restricted to the company
 * tenant by using a tenant-specific authority (and enforced again by the API).
 * The settings come from the server (GET /api/client-config), so they are
 * configured with environment variables at runtime rather than baked into the
 * build. When the server runs with AUTH_MODE=dev, sign-in is skipped.
 */
type ClientConfig =
  | { authMode: 'entra'; tenantId: string; clientId: string; apiScope: string }
  | { authMode: 'dev' };

let devAuth = false;
let scopes: string[] = [];
let pca: PublicClientApplication | null = null;
let account: AccountInfo | null = null;

async function loadClientConfig(): Promise<ClientConfig> {
  const res = await fetch('/api/client-config');
  if (!res.ok) throw new Error(`Could not load sign-in settings (HTTP ${res.status})`);
  return res.json();
}

/** Resolves once the user is signed in. May navigate away to the sign-in page. */
export async function initAuth(): Promise<boolean> {
  const cfg = await loadClientConfig();
  if (cfg.authMode === 'dev') {
    devAuth = true;
    return true;
  }
  scopes = [cfg.apiScope];
  pca = new PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  const result = await pca.handleRedirectPromise();
  account = result?.account ?? pca.getAllAccounts()[0] ?? null;
  if (!account) {
    await pca.loginRedirect({ scopes });
    return false;
  }
  pca.setActiveAccount(account);
  return true;
}

export async function getAccessToken(): Promise<string | null> {
  if (devAuth || !pca || !account) return null;
  try {
    return (await pca.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) await pca.acquireTokenRedirect({ scopes, account });
    throw e;
  }
}
