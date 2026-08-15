import admin from 'firebase-admin';
import { NextResponse } from 'next/server';

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return undefined;
  // Trim whitespace first, remove surrounding quotes, then format escaped newlines
  return key.trim().replace(/^"(.*)"$/, '$1').replace(/\\n/g, '\n');
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin;

  const privateKey = getPrivateKey();
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  const missingVars = [
    !projectId && 'FIREBASE_PROJECT_ID',
    !privateKey && 'FIREBASE_PRIVATE_KEY',
    !clientEmail && 'FIREBASE_CLIENT_EMAIL',
    !databaseURL && 'FIREBASE_DATABASE_URL',
  ].filter(Boolean);

  if (missingVars.length > 0) {
    throw new Error(`Missing Firebase environment variables on Vercel: ${missingVars.join(', ')}`);
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    databaseURL,
  });

  return admin;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId parameter' }, { status: 400 });
    }

    const firebase = initFirebaseAdmin();
    const snapshot = await firebase.database().ref(`sessions/${sessionId}`).once('value');
    const val = snapshot.val();
    
    return NextResponse.json({ 
      sessionData: val?.sessionData || val || null 
    });
  } catch (error) {
    console.error("GET Session Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    // 1. Generate Session ID
    if (body.createSession) {
      try {
        const firebase = initFirebaseAdmin();
        const userRecord = await firebase.auth().createUser({});
        return NextResponse.json({ sessionId: userRecord.uid });
      } catch (err) {
        const fallbackId = 'sess_' + Math.random().toString(36).substring(2, 12);
        return NextResponse.json({ sessionId: fallbackId });
      }
    }

    // 2. Save Session
    const { sessionId, sessionData } = body;
    if (!sessionId || !sessionData) {
      return NextResponse.json({ error: 'Missing sessionId or sessionData' }, { status: 400 });
    }

    const firebase = initFirebaseAdmin();
    await firebase.database().ref(`sessions/${sessionId}`).set({ 
      sessionData,
      updatedAt: Date.now()
    });

    return NextResponse.json({ success: true, sessionId });
  } catch (error) {
    console.error("POST Session Error:", error.message);
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

    const firebase = initFirebaseAdmin();
    await firebase.database().ref(`sessions/${sessionId}`).remove();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE Session Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
