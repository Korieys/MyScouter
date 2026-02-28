import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

export async function GET() {
    let initError = "none";

    try {
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
                }),
                storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
            });
        }
    } catch (e: any) {
        initError = e.message || e.toString();
    }

    return NextResponse.json({
        initError
    });
}
