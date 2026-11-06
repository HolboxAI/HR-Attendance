import { getApp, getApps, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth } from 'firebase/auth';

/**
 * Public Firebase web config. These values ship in the browser bundle.
 * The API is what decides who the token belongs to.
 *
 * Empty means Continue with Google stays disabled, so a deploy without
 * these keys does not break password login.
 */
export function firebaseReady(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    && process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    && process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  );
}

export function googleAuth() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  // hd asks Google to offer holbox.ai accounts. The API still refuses anything else.
  const domain = process.env.NEXT_PUBLIC_GOOGLE_HOSTED_DOMAIN || 'holbox.ai';
  provider.setCustomParameters({ hd: domain, prompt: 'select_account' });
  return { auth, provider };
}
