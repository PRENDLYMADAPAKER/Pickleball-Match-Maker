
import admin from 'firebase-admin';
import { NextResponse } from 'next/server';

// Initialize Firebase Admin SDK safely
if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
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

    // Generate anonymous session server-side if requested
    if (body.createSession) {
      const userRecord = await admin.auth().createUser({});
      return NextResponse.json({ sessionId: userRecord.uid });
    }

    const { sessionId, sessionData } = body;
    if (!sessionId || !sessionData) {
      return NextResponse.json({ error: 'Missing sessionId or sessionData payload' }, { status: 400 });
    }

    // Write session data to Realtime Database
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
