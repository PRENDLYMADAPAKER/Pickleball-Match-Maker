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

// Fetch session data from Firebase
export async function GET() {
  try {
    const snapshot = await admin.database().ref('sessions/current').once('value');
    return NextResponse.json(snapshot.val() || {});
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Save session data to Firebase
export async function POST(request) {
  try {
    const data = await request.json();
    await admin.database().ref('sessions/current').set(data);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
