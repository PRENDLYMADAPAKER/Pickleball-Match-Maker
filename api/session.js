import admin from 'firebase-admin';

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return undefined;
  return key.trim().replace(/^"(.*)"$/, '$1').replace(/\\n/g, '\n');
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin;
  const privateKey = getPrivateKey();
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!projectId || !privateKey || !clientEmail || !databaseURL) {
    throw new Error('Missing Firebase environment variables on Vercel');
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    databaseURL,
  });
  return admin;
}

export default async function handler(req, res) {
  try {
    const firebase = initFirebaseAdmin();
    const sessionId = req.query.sessionId;

    if (req.method === 'GET') {
      if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
      const snapshot = await firebase.database().ref(`sessions/${sessionId}`).once('value');
      const val = snapshot.val();
      return res.status(200).json({ sessionData: val?.sessionData || val || null });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (body?.createSession) {
        try {
          const userRecord = await firebase.auth().createUser({});
          return res.status(200).json({ sessionId: userRecord.uid });
        } catch {
          return res.status(200).json({ sessionId: 'sess_' + Math.random().toString(36).substring(2, 12) });
        }
      }
      if (!body?.sessionId || !body?.sessionData) {
        return res.status(400).json({ error: 'Missing sessionId or sessionData' });
      }
      await firebase.database().ref(`sessions/${body.sessionId}`).set({
        sessionData: body.sessionData,
        updatedAt: Date.now()
      });
      return res.status(200).json({ success: true, sessionId: body.sessionId });
    }

    if (req.method === 'DELETE') {
      if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
      await firebase.database().ref(`sessions/${sessionId}`).remove();
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
