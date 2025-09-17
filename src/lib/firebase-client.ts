/**
 * Safe client-only Firebase initializer.
 * Use getFirebaseClientApp() in client components/hooks only.
 */
import { getApps, initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function getFirebaseClientApp() {
  if (typeof window === "undefined") return null;
  try {
    if (getApps().length === 0 && firebaseConfig.apiKey) {
      return initializeApp(firebaseConfig);
    }
    return getApps()[0] || null;
  } catch (e) {
    // return null on failure to avoid build-time crash
    // console.warn("Firebase client init failed:", e);
    return null;
  }
}
