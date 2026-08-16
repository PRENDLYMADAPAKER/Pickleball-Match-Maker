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
    throw new Error('Missing Firebase environment variables');
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

    // Set CORS headers for seamless API access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    /* ==========================================
       1. GET METRICS & LIVE SESSIONS
       ========================================== */
    if (req.method === 'GET') {
      if (req.query.getMetrics === 'true') {
        const [sessionsSnap, statsSnap, clubsSnap] = await Promise.all([
          db.ref('sessions').once('value'),
          db.ref('stats/sessionsRun').once('value'),
          db.ref('clubs').once('value')
        ]);

        const sessionsVal = sessionsSnap.val() || {};
        
        // Filter active sessions to include only valid, active sessions
        const activeSessionsCount = Object.values(sessionsVal).filter((session) => {
          if (!session) return false;
          const data = session.sessionData || session;
          return data && data.isStarted === true;
        }).length;

        // Total completed sessions from stats node
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

    /* ==========================================
       2. POST / SAVE / END GAME SESSION
       ========================================== */
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // Guest/User ID Generation
      if (body?.createSession) {
        try {
          const userRecord = await firebase.auth().createUser({});
          return res.status(200).json({ sessionId: userRecord.uid });
        } catch {
          return res.status(200).json({ sessionId: 'sess_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36) });
        }
      }

      // Save Pickleball Club Registration
      if (body?.action === 'saveClub' && body?.club) {
        await db.ref(`clubs/${body.club.id}`).set(body.club);
        return res.status(200).json({ success: true });
      }

      // END MATCH GAME SESSION
      // Removes active live game from sessions/ and increments stats/sessionsRun by +1
      if (body?.action === 'endSession' && body?.sessionId) {
        await Promise.all([
          db.ref(`sessions/${body.sessionId}`).remove(),
          db.ref('stats/sessionsRun').transaction((current) => (current || 0) + 1)
        ]);
        return res.status(200).json({ success: true });
      }

      // Reset active sessions if needed
      if (body?.action === 'resetActiveSessions') {
        await db.ref('sessions').remove();
        return res.status(200).json({ success: true });
      }

      if (!body?.sessionId || !body?.sessionData) {
        return res.status(400).json({ error: 'Missing sessionId or sessionData' });
      }

      // SAVE/UPDATE ACTIVE SESSION
      await db.ref(`sessions/${body.sessionId}`).set({
        sessionData: body.sessionData,
        updatedAt: Date.now()
      });

      return res.status(200).json({ success: true, sessionId: body.sessionId });
    }

    /* ==========================================
       3. DELETE SESSION
       ========================================== */
    if (req.method === 'DELETE') {
      if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
      await db.ref(`sessions/${sessionId}`).remove();
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error("Firebase API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
