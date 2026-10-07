import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';

/**
 * Microsoft Entra ID single sign-on. Sign-in is restricted to the company
 * tenant by using a tenant-specific authority (and enforced again by the API).
 * Set VITE_AUTH_MODE=dev to skip sign-in during local development.
 */
const env = import.meta.env;
export const devAuth = env.VITE_AUTH_MODE === 'dev';
const scopes = [env.VITE_ENTRA_API_SCOPE as string];

let pca: PublicClientApplication | null = null;
let account: AccountInfo | null = null;

/** Resolves once the user is signed in. May navigate away to the sign-in page. */
export async function initAuth(): Promise<boolean> {
  if (devAuth) return true;
  pca = new PublicClientApplication({
    auth: {
      clientId: env.VITE_ENTRA_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${env.VITE_ENTRA_TENANT_ID}`,
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
