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
    const db = firebase.database();
    const sessionId = req.query.sessionId;

    if (req.method === 'GET') {
      // Real-time Metrics & Registered Clubs Sync
      if (req.query.getMetrics === 'true') {
        const [sessionsSnap, statsSnap, clubsSnap] = await Promise.all([
          db.ref('sessions').once('value'),
          db.ref('stats/sessionsRun').once('value'),
          db.ref('clubs').once('value')
        ]);

        const sessionsVal = sessionsSnap.val() || {};
        // Filter active sessions that have an active title or players
        const activeSessionsCount = Object.values(sessionsVal).filter(s => {
          const data = s.sessionData || s;
          return data && (data.title || (data.players && data.players.length > 0));
        }).length;

        const sessionsRunCount = statsSnap.val() || 0;
        const clubsVal = clubsSnap.val() || {};
        const clubsList = Object.values(clubsVal);

        return res.status(200).json({
          activeSessions: activeSessionsCount,
          sessionsRun: sessionsRunCount,
          totalClubs: clubsList.length,
          clubs: clubsList
        });
      }

      if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
      const snapshot = await db.ref(`sessions/${sessionId}`).once('value');
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

      // Save Registered Club to Firebase DB
      if (body?.action === 'saveClub' && body?.club) {
        await db.ref(`clubs/${body.club.id}`).set(body.club);
        return res.status(200).json({ success: true });
      }

      // End Session: Increment global counter & remove active session
      if (body?.action === 'endSession' && body?.sessionId) {
        await Promise.all([
          db.ref(`sessions/${body.sessionId}`).remove(),
          db.ref('stats/sessionsRun').transaction((current) => (current || 0) + 1)
        ]);
        return res.status(200).json({ success: true });
      }

      if (!body?.sessionId || !body?.sessionData) {
        return res.status(400).json({ error: 'Missing sessionId or sessionData' });
      }

      await db.ref(`sessions/${body.sessionId}`).set({
        sessionData: body.sessionData,
        updatedAt: Date.now()
      });
      return res.status(200).json({ success: true, sessionId: body.sessionId });
    }

    if (req.method === 'DELETE') {
      if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
      await db.ref(`sessions/${sessionId}`).remove();
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
