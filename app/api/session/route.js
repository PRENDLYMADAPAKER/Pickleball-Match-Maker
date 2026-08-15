import admin from 'firebase-admin';
import { NextResponse } from 'next/server';

// Fix multi-line private key parsing for Vercel deployment
function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n').replace(/^"(.*)"$/, '$1');
}

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: getPrivateKey(),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
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

    // 1. Handle User Login / Registration via Firebase REST API (Server-Side)
    if (body.action === 'login') {
      const { email, password } = body;
      const apiKey = process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
      
      const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });
      const authData = await authRes.json();

      if (authData.error) {
        // Attempt registration if user not found
        if (authData.error.message === 'EMAIL_NOT_FOUND' || authData.error.message === 'INVALID_LOGIN_CREDENTIALS') {
          const signUpRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
          });
          const signUpData = await signUpRes.json();
          if (signUpData.error) throw new Error(signUpData.error.message);
          return NextResponse.json({ sessionId: signUpData.localId, email: signUpData.email, isNew: true });
        }
        throw new Error(authData.error.message);
      }

      return NextResponse.json({ sessionId: authData.localId, email: authData.email });
    }

    // 2. Generate anonymous session ID server-side
    if (body.createSession) {
      const userRecord = await admin.auth().createUser({});
      return NextResponse.json({ sessionId: userRecord.uid });
    }

    // 3. Save session data
    const { sessionId, sessionData } = body;
    if (!sessionId || !sessionData) {
      return NextResponse.json({ error: 'Missing sessionId or sessionData payload' }, { status: 400 });
    }

    await admin.database().ref(`sessions/${sessionId}`).set({ 
      sessionData,
      updatedAt: Date.now()
    });

    return NextResponse.json({ success: true, sessionId });
  } catch (error) {
    console.error("POST Session Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId parameter' }, { status: 400 });
    }

    await admin.database().ref(`sessions/${sessionId}`).remove();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE Session Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
