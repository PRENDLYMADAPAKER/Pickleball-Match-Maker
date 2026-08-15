import admin from 'firebase-admin';
import { NextResponse } from 'next/server';

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n').replace(/^"(.*)"$/, '$1');
}

if (!admin.apps.length) {
  try {
    const privateKey = getPrivateKey();
    if (process.env.FIREBASE_PROJECT_ID && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
    }
  } catch (e) {
    console.error("Firebase Admin initialization error:", e.message);
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId parameter' }, { status: 400 });
    }

    if (!admin.apps.length) {
      return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 500 });
    }

    const snapshot = await admin.database().ref(`sessions/${sessionId}`).once('value');
    const val = snapshot.val();
    
    return NextResponse.json({ 
      sessionData: val?.sessionData || val || null 
    });
  } catch (error) {
    console.error("GET Session Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    if (body.action === 'login') {
      const { email, password } = body;
      const apiKey = process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
      
      if (!apiKey) {
        return NextResponse.json({ error: 'FIREBASE_API_KEY is missing in environment variables' }, { status: 500 });
      }

      const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });

      const authData = await authRes.json();

      if (authData.error) {
        if (authData.error.message === 'EMAIL_NOT_FOUND' || authData.error.message === 'INVALID_LOGIN_CREDENTIALS') {
          const signUpRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
          });
          const signUpData = await signUpRes.json();
          if (signUpData.error) {
            return NextResponse.json({ error: signUpData.error.message }, { status: 400 });
          }
          return NextResponse.json({ sessionId: signUpData.localId, email: signUpData.email, isNew: true });
        }
        return NextResponse.json({ error: authData.error.message }, { status: 400 });
      }

      return NextResponse.json({ sessionId: authData.localId, email: authData.email });
    }

    if (body.createSession) {
      if (!admin.apps.length) {
        const fallbackId = 'sess_' + Math.random().toString(36).substring(2, 15);
        return NextResponse.json({ sessionId: fallbackId });
      }
      const userRecord = await admin.auth().createUser({});
      return NextResponse.json({ sessionId: userRecord.uid });
    }

    const { sessionId, sessionData } = body;
    if (!sessionId || !sessionData) {
      return NextResponse.json({ error: 'Missing sessionId or sessionData payload' }, { status: 400 });
    }

    if (admin.apps.length) {
      await admin.database().ref(`sessions/${sessionId}`).set({ 
        sessionData,
        updatedAt: Date.now()
      });
    }

    return NextResponse.json({ success: true, sessionId });
  } catch (error) {
    console.error("POST Session Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
