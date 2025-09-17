// Import the functions you need from the SDKs you need
import { getFirebaseClientApp } from 'src/lib/firebase-client';
import { getAuth } from 'firebase/auth';
import { getFirestore, setDoc } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Initialize Firebase
const app = getFirebaseClientApp();
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage, setDoc };
