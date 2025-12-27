// Firebase Admin SDK with dynamic imports to avoid Turbopack bundling issues
import type { App } from 'firebase-admin/app';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

let _app: App | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _initialized = false;

async function initializeFirebaseAdmin(): Promise<App> {
  if (_app) {
    return _app;
  }

  // Dynamic import to avoid bundling issues with Turbopack
  const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app');

  if (getApps().length > 0) {
    _app = getApps()[0];
    return _app;
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'vox-aicontact-fe0e3';
  const serviceAccountJson = process.env.SERVICE_ACCOUNT_KEY;

  // Always try to use the service account key first if available
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      console.log('Using Service Account Key');
      _app = initializeApp({
        credential: cert(serviceAccount),
        projectId,
      });
      _initialized = true;
      return _app;
    } catch (e) {
      console.error('Failed to parse SERVICE_ACCOUNT_KEY:', e);
    }
  }

  // Fallback to application default credentials
  console.log('Using Application Default Credentials');
  _app = initializeApp({
    credential: applicationDefault(),
    projectId,
    serviceAccountId: 'firebase-adminsdk-fbsvc@vox-aicontact-fe0e3.iam.gserviceaccount.com',
  });

  _initialized = true;
  return _app;
}

// Lazy async getters
export async function getAdminApp(): Promise<App> {
  return initializeFirebaseAdmin();
}

export async function getAdminAuth(): Promise<Auth> {
  if (!_auth) {
    const app = await initializeFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    _auth = getAuth(app);
  }
  return _auth;
}

export async function getAdminDb(): Promise<Firestore> {
  if (!_db) {
    const app = await initializeFirebaseAdmin();
    const { getFirestore } = await import('firebase-admin/firestore');
    _db = getFirestore(app);
  }
  return _db;
}

// Helper to verify Firebase ID token
export async function verifyIdToken(token: string): Promise<DecodedIdToken | null> {
  try {
    const auth = await getAdminAuth();
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
