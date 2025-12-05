import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let _app: App | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function getFirebaseAdminApp(): App {
  if (_app) {
    return _app;
  }

  if (getApps().length > 0) {
    _app = getApps()[0];
    return _app;
  }

  // Parse service account from environment variable
  // Use SERVICE_ACCOUNT_KEY to avoid Firebase reserved prefix restriction
  const serviceAccountJson = process.env.SERVICE_ACCOUNT_KEY;

  if (!serviceAccountJson) {
    throw new Error('SERVICE_ACCOUNT_KEY environment variable is not set');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('SERVICE_ACCOUNT_KEY is not valid JSON');
  }

  _app = initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });

  return _app;
}

// Lazy getters
export function getAdminApp(): App {
  return getFirebaseAdminApp();
}

export function getAdminAuth(): Auth {
  if (!_auth) {
    _auth = getAuth(getFirebaseAdminApp());
  }
  return _auth;
}

export function getAdminDb(): Firestore {
  if (!_db) {
    _db = getFirestore(getFirebaseAdminApp());
  }
  return _db;
}

// For backward compatibility with existing code
export const adminApp = { get: getAdminApp };
export const adminAuth = new Proxy({} as Auth, {
  get(_, prop) {
    return getAdminAuth()[prop as keyof Auth];
  },
});
export const adminDb = new Proxy({} as Firestore, {
  get(_, prop) {
    return getAdminDb()[prop as keyof Firestore];
  },
});

// Helper to verify Firebase ID token
export async function verifyIdToken(token: string) {
  try {
    const auth = getAdminAuth();
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying ID token:', error);
    return null;
  }
}

// Extract bearer token from Authorization header
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
