import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if Firebase can be initialized (valid API key present)
const canInitialize = (): boolean => {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  // Skip initialization during build/SSR with missing or test API keys
  if (!apiKey || apiKey === 'test-key' || apiKey.length < 10) {
    if (typeof window !== 'undefined') {
      console.warn(
        '[Firebase] Cannot initialize: NEXT_PUBLIC_FIREBASE_API_KEY is missing or invalid.\n' +
        'This variable is inlined at BUILD TIME by Next.js.\n' +
        'Fix: 1) Ensure .env.local has valid Firebase config\n' +
        '     2) Clear cache: rm -rf .next\n' +
        '     3) Restart dev server: npm run dev'
      );
    }
    return false;
  }
  return true;
};

// Initialize Firebase only if valid config is available
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let storage: FirebaseStorage | undefined;
let db: Firestore | undefined;

if (canInitialize()) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    storage = getStorage(app);
    db = getFirestore(app);
  } catch (error) {
    console.warn('Firebase initialization failed:', error);
  }
}

// Export with type assertions for backward compatibility
// Consumers should handle undefined cases in client components
export { app, auth, storage, db };
