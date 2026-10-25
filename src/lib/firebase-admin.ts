import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
export function getAdmin() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!projectId || !clientEmail || !privateKey || !storageBucket) throw new Error('Server account configuration is unavailable');
    const app = getApps().find(app => app.name === 'myscouter-server') ?? initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }), storageBucket,
    }, 'myscouter-server');
    return { db: getFirestore(app), auth: getAuth(app), bucket: getStorage(app).bucket() };
}
