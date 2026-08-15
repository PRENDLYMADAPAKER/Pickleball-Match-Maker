import admin from 'firebase-admin';
import { NextResponse } from 'next/server';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

// Helper to verify ID Token from Authorization header
async function verifyUser(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split('Bearer ')[1];
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

    const snapshot = await admin.database().ref(`sessions/${sessionId}`).once('value');
    const val = snapshot.val();
    return NextResponse.json({ sessionData: val?.sessionData || val || null });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const decodedToken = await verifyUser(request);
    if (!decodedToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { sessionData } = await request.json();
    await admin.database().ref(`sessions/${decodedToken.uid}`).set({ sessionData });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const decodedToken = await verifyUser(request);
    if (!decodedToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await admin.database().ref(`sessions/${decodedToken.uid}`).remove();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
                                                            }
    
