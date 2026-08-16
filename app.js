let selectedPlayerStrength = 3;
let isViewerMode = false;
let viewerSessionId = null;
let timerInterval = null;
let viewerPollInterval = null;
let metricsPollInterval = null;
let cachedClubs = [];

let pendingSwapCourtId = null;
let pendingSwapOldPlayerId = null;

let sessionData = {
  title: "",
  mode: "doubles",
  maxGames: null,
  isStarted: false, // Flag: set to true ONLY when Launch Match Game is clicked
  players: [],
  courts: [
    { id: 1, name: "Court 1", activeMatch: null }
  ]
};

const STORAGE_KEY = 'pb_session_store_v2';
const SESSION_ID_KEY = 'pb_session_id';
const USER_EMAIL_KEY = 'pb_user_email';
const CLUB_STORAGE_KEY = 'pb_clubs_store_v1';

const STRENGTH_LABELS = {
  1: "Novice",
  2: "Beginner",
  3: "Intermediate",
  4: "Advanced",
  5: "Pro"
};

async function getOrCreateSessionId() {
  let id = localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createSession: true })
      });
      const data = await res.json();
      if (data.sessionId) {
        id = data.sessionId;
        localStorage.setItem(SESSION_ID_KEY, id);
      } else {
        id = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        localStorage.setItem(SESSION_ID_KEY, id);
      }
    } catch (e) {
      console.error("Failed to create server session:", e);
      id = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem(SESSION_ID_KEY, id);
    }
  }
  return id;
}

function updateAuthUI() {
  const email = localStorage.getItem(USER_EMAIL_KEY);
  const authLoggedOut = document.getElementById('authLoggedOut');
  const authLoggedIn = document.getElementById('authLoggedIn');
  const userDisplayEmail = document.getElementById('userDisplayEmail');
  const headerAuthLabel = document.getElementById('headerAuthLabel');
  const btnOpenClubModal = document.getElementById('btnOpenClubModal');
  const clubAuthNotice = document.getElementById('clubAuthNotice');

  if (email) {
    if (authLoggedOut) authLoggedOut.style.display = 'none';
    if (authLoggedIn) authLoggedIn.style.display = 'block';
    if (userDisplayEmail) userDisplayEmail.textContent = email.toUpperCase();
    if (headerAuthLabel) headerAuthLabel.textContent = "Synced";
    if (btnOpenClubModal) btnOpenClubModal.style.display = 'inline-block';
    if (clubAuthNotice) clubAuthNotice.style.display = 'none';
  } else {
    if (authLoggedOut) authLoggedOut.style.display = 'block';
    if (authLoggedIn) authLoggedIn.style.display = 'none';
    if (headerAuthLabel) headerAuthLabel.textContent = "Cloud Login";
    if (btnOpenClubModal) btnOpenClubModal.style.display = 'none';
    if (clubAuthNotice) clubAuthNotice.style.display = 'block';
  }
}

/* ==========================================
   REAL-TIME METRICS & CLUBS SYNC
   ========================================== */

async function fetchMetricsAndClubs() {
  try {
    const res = await fetch('/api/session?getMetrics=true');
    if (!res.ok) return;
    const data = await res.json();

    if (data) {
      const elActive = document.getElementById('metricActiveSessions') || document.getElementById('activeSessionsCount');
      const elRun = document.getElementById('metricSessionsRun') || document.getElementById('totalSessionsRunCount');
      const elClubs = document.getElementById('metricTotalClubs') || document.getElementById('registeredClubsCount');

      if (elActive) elActive.textContent = data.activeSessions ?? 0;
      if (elRun) elRun.textContent = data.sessionsRun ?? 0;
      if (elClubs) elClubs.textContent = data.totalClubs ?? 0;

      if (data.clubs) {
        cachedClubs = Array.isArray(data.clubs) ? data.clubs : Object.values(data.clubs);
        localStorage.setItem(CLUB_STORAGE_KEY, JSON.stringify(cachedClubs));
        renderClubs();
      }
    }
  } catch (err) {
    console.error("Error pulling metrics from Firebase:", err);
  }
}

async function fetchCloudSession(uid) {
  if (!uid) return false;
  try {
    const res = await fetch(`/api/session?sessionId=${encodeURIComponent(uid)}`);
    if (!res.ok) return false;
    const data = await res.json();

    if (data && data.sessionData && data.sessionData.isStarted) {
      sessionData = data.sessionData;
      if (!sessionData.players) sessionData.players = [];
      if (!sessionData.courts) sessionData.courts = [{ id: 1, name: "Court 1", activeMatch: null }];
      if (!sessionData.mode) sessionData.mode = "doubles";

      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
      checkSavedSession();
      render();
      return true;
    }
  } catch (err) {
    console.error("Error pulling cloud session:", err);
  }
  return false;
}

async function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionParam = urlParams.get('session');

  startTimerLoop();
  setStrengthRating(3);
  updateAuthUI();

  // Initial fetch and start 4-second real-time polling loop for global metrics
  await fetchMetricsAndClubs();
  if (metricsPollInterval) clearInterval(metricsPollInterval);
  metricsPollInterval = setInterval(fetchMetricsAndClubs, 4000);

  if (sessionParam) {
    isViewerMode = true;
    viewerSessionId = sessionParam;
    setupViewerMode();
  } else {
    const sessionId = await getOrCreateSessionId();
    if (localStorage.getItem(USER_EMAIL_KEY)) {
      const hasCloudData = await fetchCloudSession(sessionId);
      if (hasCloudData) {
        resumeSession();
        return;
      }
    }
    checkSavedSession();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateMatchTimers, 1000);
}

function updateMatchTimers() {
  if (!sessionData || !sessionData.courts) return;
  sessionData.courts.forEach(court => {
    if (court.activeMatch && court.activeMatch.startTime) {
      const el = document.getElementById(`timer-court-${court.id}`);
      if (el) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - court.activeMatch.startTime) / 1000));
        const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
        const secs = (elapsedSec % 60).toString().padStart(2, '0');
        el.textContent = `⏱️ ${mins}:${secs}`;
      }
    }
  });
}

async function setupViewerMode() {
  document.body.classList.add('viewer-mode');

  const viewerBanner = document.getElementById('viewerBanner');
  if (viewerBanner) viewerBanner.style.display = 'block';
  
  const btnAuthHeader = document.getElementById('btnAuthHeader');
  if (btnAuthHeader) btnAuthHeader.style.display = 'none';

  const btnShareLiveTop = document.getElementById('btnShareLiveTop');
  if (btnShareLiveTop) btnShareLiveTop.style.display = 'none';
  
  const grid = document.getElementById('dashboardGrid');
  if (grid) grid.classList.add('viewer-grid');
  
  showView('viewApp');

  const titleEl = document.getElementById('displaySessionTitle');
  if (titleEl) titleEl.textContent = "Connecting to Session...";
  
  const formatEl = document.getElementById('displayMatchFormat');
  if (formatEl) formatEl.textContent = "Syncing...";

  async function fetchLiveSession() {
    try {
      const response = await fetch(`/api/session?sessionId=${encodeURIComponent(viewerSessionId)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server error ${response.status}`);
      }

      if (data && data.sessionData) {
        sessionData = data.sessionData;
        if (!sessionData.players) sessionData.players = [];
        if (!sessionData.courts) sessionData.courts = [{ id: 1, name: "Court 1", activeMatch: null }];
        if (!sessionData.mode) sessionData.mode = "doubles";
        
        if (titleEl) titleEl.textContent = sessionData.title || "Live Pickleball Play";
        if (formatEl) formatEl.textContent = (sessionData.mode === 'doubles' ? 'Doubles (2v2)' : 'Singles (1v1)') + " format";
        
        const capEl = document.getElementById('displayMaxCap');
        if (capEl) capEl.textContent = sessionData.maxGames ? `Max ${sessionData.maxGames} Games Cap` : 'No Cap';
        
        render();
      } else {
        if (titleEl) titleEl.textContent = "Host Session Not Found / Offline";
        if (formatEl) formatEl.textContent = "Waiting for host to broadcast";
        sessionData = { title: "", mode: "doubles", maxGames: null, isStarted: false, players: [], courts: [{ id: 1, name: "Court 1", activeMatch: null }] };
        render();
      }
    } catch (error) {
      console.error("API Viewer Sync Error Detail:", error.message);
      if (titleEl) titleEl.textContent = "Sync Connection Error";
    }
  }

  fetchLiveSession();
  if (viewerPollInterval) clearInterval(viewerPollInterval);
  viewerPollInterval = setInterval(fetchLiveSession, 3000);
}

async function openShareModal() {
  const hostUid = isViewerMode ? viewerSessionId : await getOrCreateSessionId();
  if (!hostUid) {
    alert("Session ID not ready yet. Please retry.");
    return;
  }

  const liveUrl = `${window.location.origin}${window.location.pathname}?session=${hostUid}`;
  
  const shareInput = document.getElementById('shareUrlInput');
  if (shareInput) shareInput.value = liveUrl;

  const qrImg = document.getElementById('qrCodeImage');
  if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(liveUrl)}`;

  const shareModal = document.getElementById('shareModal');
  if (shareModal) shareModal.classList.add('open');
}

function closeShareModal() {
  const shareModal = document.getElementById('shareModal');
  if (shareModal) shareModal.classList.remove('open');
}

function copyShareLink() {
  const input = document.getElementById('shareUrlInput');
  if (input) {
    input.select();
    navigator.clipboard.writeText(input.value);
    alert("Live View URL copied to clipboard!");
  }
}

function setStrengthRating(rating) {
  selectedPlayerStrength = rating;
  const stars = document.querySelectorAll('#starPicker .star');
  stars.forEach((star, idx) => {
    if (idx < rating) {
      star.classList.add('active');
    } else {
      star.classList.remove('active');
    }
  });

  const label = document.getElementById('strengthRatingLabel');
  if (label) {
    label.textContent = `${STRENGTH_LABELS[rating]} (${rating} ${rating === 1 ? 'Star' : 'Stars'})`;
  }
}

function toggleAuthDrawer() {
  const drawer = document.getElementById('authDrawer');
  if (drawer) drawer.classList.toggle('open');
}

async function loginOrRegister() {
  const email = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value.trim();
  const apiKey = "AIzaSyDAtr2j0iQk1PuYLcqJjIw1IqfsyCCLUUY";

  if (!email || !password) return alert("Please enter email and password.");

  try {
    let uid = null;
    let userEmail = null;

    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });

    const data = await res.json();

    if (data.error) {
      if (data.error.message === 'EMAIL_NOT_FOUND' || data.error.message === 'INVALID_LOGIN_CREDENTIALS') {
        const signUpRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        const signUpData = await signUpRes.json();
        if (signUpData.error) throw new Error(signUpData.error.message);

        uid = signUpData.localId;
        userEmail = signUpData.email;
      } else {
        throw new Error(data.error.message);
      }
    } else {
      uid = data.localId;
      userEmail = data.email;
    }

    localStorage.setItem(SESSION_ID_KEY, uid);
    localStorage.setItem(USER_EMAIL_KEY, userEmail);
    updateAuthUI();
    toggleAuthDrawer();

    const hasCloudSession = await fetchCloudSession(uid);

    if (hasCloudSession) {
      resumeSession();
    } else if (sessionData && sessionData.isStarted) {
      await saveToStorage();
      resumeSession();
    }

    alert("Logged in successfully! Cloud session activated.");
  } catch (error) {
    alert("Auth Error: " + error.message);
  }
}

async function logout() {
  localStorage.removeItem(SESSION_ID_KEY);
  localStorage.removeItem(USER_EMAIL_KEY);
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

/* ==========================================
   SAVE SESSION TO REALTIME DB (ACTIVE SESSIONS)
   ========================================== */

async function saveToStorage() {
  if (isViewerMode) return;
  
  // Only save to storage and cloud if game session was explicitly launched
  if (!sessionData.isStarted) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
  
  // Syncs active game to Firebase Realtime Database for BOTH guest and logged-in users
  const sessionId = await getOrCreateSessionId();
  if (sessionId) {
    try {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          sessionData: sessionData
        })
      });
    } catch (err) {
      console.error("API sync error:", err);
    }
  }
  await fetchMetricsAndClubs();
}

function checkSavedSession() {
  if (isViewerMode) return;
  const resumeCard = document.getElementById('resumeCard');
  const resumeDetails = document.getElementById('resumeDetails');

  if (sessionData && sessionData.isStarted && (sessionData.players?.length > 0 || sessionData.title)) {
    if (resumeCard) resumeCard.style.display = 'block';
    if (resumeDetails) resumeDetails.textContent = `Active Session: "${sessionData.title || 'Untitled Play'}" with ${sessionData.players.length} player(s).`;
  } else {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.isStarted && (parsed.players?.length > 0 || parsed.title)) {
          sessionData = parsed;
          if (!sessionData.mode) sessionData.mode = "doubles";
          if (resumeCard) resumeCard.style.display = 'block';
          if (resumeDetails) resumeDetails.textContent = `Saved Session: "${parsed.title || 'Untitled Play'}" with ${parsed.players.length} player(s).`;
        } else {
          if (resumeCard) resumeCard.style.display = 'none';
        }
      } catch(e) {
        if (resumeCard) resumeCard.style.display = 'none';
      }
    } else {
      if (resumeCard) resumeCard.style.display = 'none';
    }
  }
  fetchMetricsAndClubs();
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const targetView = document.getElementById(viewId);
  if (targetView) targetView.classList.add('active');
}

/* ==========================================
   LAUNCH MATCH GAME (INCREASES ACTIVE SESSIONS)
   ========================================== */

async function launchMatchGame(selectedMode) {
  const titleInput = document.getElementById('sessionTitleInput');
  const maxInput = document.getElementById('maxGamesInput');

  const titleVal = titleInput ? titleInput.value.trim() : '';
  const maxVal = maxInput ? parseInt(maxInput.value, 10) : NaN;

  sessionData.title = titleVal || `${selectedMode === 'singles' ? 'Singles' : 'Doubles'} Open Play`;
  sessionData.mode = selectedMode;
  sessionData.maxGames = !isNaN(maxVal) && maxVal > 0 ? maxVal : null;
  sessionData.isStarted = true; // ACTIVATES THE GAME SESSION IN REALTIME DB

  await saveToStorage();
  startSessionUI();
}

function resumeSession() {
  if (!sessionData.players) sessionData.players = [];
  if (!sessionData.courts) sessionData.courts = [{ id: 1, name: "Court 1", activeMatch: null }];
  if (!sessionData.mode) sessionData.mode = "doubles";
  startSessionUI();
}

function startSessionUI() {
  const titleEl = document.getElementById('displaySessionTitle');
  if (titleEl) titleEl.textContent = sessionData.title;

  const formatEl = document.getElementById('displayMatchFormat');
  if (formatEl) formatEl.textContent = (sessionData.mode === 'doubles' ? 'Doubles (2v2)' : 'Singles (1v1)') + " format";

  const capEl = document.getElementById('displayMaxCap');
  if (capEl) capEl.textContent = sessionData.maxGames ? `Max ${sessionData.maxGames} Games Cap` : 'No Cap';

  showView('viewApp');
  setStrengthRating(3);
  render();
}

function goHome() {
  saveToStorage();
  checkSavedSession();
  fetchMetricsAndClubs();
  showView('viewHome');
}

async function clearSavedData() {
  if (confirm("Delete current session and data?")) {
    const sessionId = localStorage.getItem(SESSION_ID_KEY);
    localStorage.removeItem(STORAGE_KEY);
    
    if (!localStorage.getItem(USER_EMAIL_KEY)) {
      localStorage.removeItem(SESSION_ID_KEY);
    }

    if (sessionId) {
      try {
        await fetch(`/api/session?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'DELETE'
        });
      } catch (err) {
        console.error("Error clearing session:", err);
      }
    }
    sessionData = { title: "", mode: "doubles", maxGames: null, isStarted: false, players: [], courts: [{ id: 1, name: "Court 1", activeMatch: null }] };
    
    const resumeCard = document.getElementById('resumeCard');
    if (resumeCard) resumeCard.style.display = 'none';
    
    render();
    await fetchMetricsAndClubs();
  }
}

function addCourt() {
  if (isViewerMode) return;
  const newCourtId = sessionData.courts.length > 0 ? Math.max(...sessionData.courts.map(c => c.id)) + 1 : 1;
  sessionData.courts.push({
    id: newCourtId,
    name: `Court ${newCourtId}`,
    activeMatch: null
  });
  saveToStorage();
  render();
}

function removeCourt(courtId) {
  if (isViewerMode) return;
  const targetCourt = sessionData.courts.find(c => c.id == courtId);
  if (targetCourt && targetCourt.activeMatch) {
    alert("Cannot remove a court with an active match in progress.");
    return;
  }
  if (sessionData.courts.length <= 1) {
    alert("You must keep at least 1 court.");
    return;
  }
  sessionData.courts = sessionData.courts.filter(c => c.id != courtId);
  saveToStorage();
  render();
}

function addPlayer() {
  if (isViewerMode) return;
  const input = document.getElementById('playerNameInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;

  sessionData.players.push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    name,
    strength: selectedPlayerStrength,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    playing: false
  });

  input.value = '';
  saveToStorage();
  render();
}

function addMultiplePlayers() {
  if (isViewerMode) return;
  const input = document.getElementById('bulkPlayerInput');
  if (!input) return;

  const rawText = input.value;
  if (!rawText.trim()) return;

  const lines = rawText.split(/\r?\n/);
  let addedCount = 0;

  lines.forEach((line) => {
    const cleanName = line.replace(/^[\d\s\.\)\-]+/, '').trim();

    if (cleanName) {
      sessionData.players.push({
        id: Date.now() + Math.floor(Math.random() * 10000),
        name: cleanName,
        strength: selectedPlayerStrength,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        playing: false
      });
      addedCount++;
    }
  });

  input.value = '';
  saveToStorage();
  render();
  alert(`Successfully added ${addedCount} player(s)!`);
}

function removePlayer(id) {
  if (isViewerMode) return;
  const isPlaying = sessionData.courts.some(c => c.activeMatch && c.activeMatch.players.some(p => p.id == id));
  if (isPlaying) {
    alert("Cannot remove a player who is currently in an active match.");
    return;
  }
  sessionData.players = sessionData.players.filter(p => p.id != id);
  saveToStorage();
  render();
}

function generateMatchForCourt(courtId) {
  if (isViewerMode) return;
  const court = sessionData.courts.find(c => c.id == courtId);
  if (!court) return;
  if (court.activeMatch) return alert(`${court.name} is currently occupied.`);

  const currentMode = sessionData.mode || 'doubles';
  const requiredCount = currentMode === 'doubles' ? 4 : 2;

  const available = sessionData.players.filter(p => {
    if (p.playing) return false;
    if (sessionData.maxGames !== null && p.matchesPlayed >= sessionData.maxGames) return false;
    return true;
  });

  if (available.length < requiredCount) {
    alert(`Need at least ${requiredCount} eligible players available for ${court.name} (${currentMode.toUpperCase()}).`);
    return;
  }

  available.sort((a, b) => {
    if (a.matchesPlayed !== b.matchesPlayed) {
      return a.matchesPlayed - b.matchesPlayed;
    }
    const winRateA = a.matchesPlayed > 0 ? (a.wins / a.matchesPlayed) : 0;
    const winRateB = b.matchesPlayed > 0 ? (b.wins / b.matchesPlayed) : 0;
    if (winRateB !== winRateA) {
      return winRateB - winRateA;
    }
    return (b.wins - a.wins);
  });

  const selected = available.slice(0, requiredCount);
  selected.forEach(p => p.playing = true);

  let team1, team2;
  if (currentMode === 'doubles') {
    team1 = [selected[0], selected[3]];
    team2 = [selected[1], selected[2]];
  } else {
    team1 = [selected[0]];
    team2 = [selected[1]];
  }

  court.activeMatch = { team1, team2, players: selected, startTime: Date.now() };
  saveToStorage();
  render();
}

function generateAutoMatch() {
  if (isViewerMode) return;
  const emptyCourt = sessionData.courts.find(c => !c.activeMatch);
  if (!emptyCourt) {
    alert("All courts are currently busy! Finish a match or add a new court.");
    return;
  }
  generateMatchForCourt(emptyCourt.id);
}

function recordWinner(courtId, winningTeamNum) {
  if (isViewerMode) return;
  const court = sessionData.courts.find(c => c.id == courtId);
  if (!court || !court.activeMatch) return;

  const winners = winningTeamNum === 1 ? court.activeMatch.team1 : court.activeMatch.team2;
  const losers = winningTeamNum === 1 ? court.activeMatch.team2 : court.activeMatch.team1;

  winners.forEach(w => {
    const p = sessionData.players.find(x => x.id == w.id);
    if (p) { p.wins++; p.matchesPlayed++; p.playing = false; }
  });

  losers.forEach(l => {
    const p = sessionData.players.find(x => x.id == l.id);
    if (p) { p.losses++; p.matchesPlayed++; p.playing = false; }
  });

  court.activeMatch = null;
  saveToStorage();
  render();
}

function openSwapModal(courtId, oldPlayerId) {
  if (isViewerMode) return;
  pendingSwapCourtId = courtId;
  pendingSwapOldPlayerId = oldPlayerId;

  const oldPlayer = sessionData.players.find(p => p.id == oldPlayerId);
  const oldNameEl = document.getElementById('swapOldPlayerName');
  if (oldNameEl) oldNameEl.textContent = oldPlayer ? oldPlayer.name : 'Selected Player';

  const select = document.getElementById('swapNewPlayerSelect');
  if (select) {
    select.innerHTML = '<option value="">-- Choose Replacement Player --</option>';

    const available = sessionData.players.filter(p => !p.playing);
    available.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${STRENGTH_LABELS[p.strength] || 'Intermediate'} - ${p.matchesPlayed} games)`;
      select.appendChild(opt);
    });
  }

  const swapModal = document.getElementById('swapModal');
  if (swapModal) swapModal.classList.add('open');
}

function closeSwapModal() {
  const swapModal = document.getElementById('swapModal');
  if (swapModal) swapModal.classList.remove('open');
  pendingSwapCourtId = null;
  pendingSwapOldPlayerId = null;
}

function confirmPlayerSwap() {
  if (isViewerMode) return;
  const select = document.getElementById('swapNewPlayerSelect');
  if (!select) return;
  const newPlayerId = parseInt(select.value, 10);
  if (!newPlayerId) return alert("Please select a replacement player.");

  const court = sessionData.courts.find(c => c.id == pendingSwapCourtId);
  if (!court || !court.activeMatch) return;

  const oldPlayer = sessionData.players.find(p => p.id == pendingSwapOldPlayerId);
  const newPlayer = sessionData.players.find(p => p.id == newPlayerId);

  if (oldPlayer) oldPlayer.playing = false;
  if (newPlayer) newPlayer.playing = true;

  court.activeMatch.players = court.activeMatch.players.map(p => p.id == pendingSwapOldPlayerId ? newPlayer : p);
  court.activeMatch.team1 = court.activeMatch.team1.map(p => p.id == pendingSwapOldPlayerId ? newPlayer : p);
  court.activeMatch.team2 = court.activeMatch.team2.map(p => p.id == pendingSwapOldPlayerId ? newPlayer : p);

  saveToStorage();
  closeSwapModal();
  render();
}

/* ==========================================
   CLUB CREATION SYSTEM
   ========================================== */

function getClubs() {
  if (cachedClubs && cachedClubs.length > 0) return cachedClubs;
  try {
    return JSON.parse(localStorage.getItem(CLUB_STORAGE_KEY) || '[]');
  } catch(e) {
    return [];
  }
}

function openClubModal() {
  const email = localStorage.getItem(USER_EMAIL_KEY);
  if (!email) {
    alert("You must be logged in to create a club.");
    toggleAuthDrawer();
    return;
  }
  const modal = document.getElementById('clubModal');
  if (modal) modal.classList.add('open');
}

function closeClubModal() {
  const modal = document.getElementById('clubModal');
  if (modal) modal.classList.remove('open');
}

async function saveClub() {
  const userEmail = localStorage.getItem(USER_EMAIL_KEY);
  if (!userEmail) {
    alert("Logged in user required to create a club.");
    return;
  }

  const name = document.getElementById('clubNameInput')?.value.trim();
  const started = document.getElementById('clubStartedInput')?.value;
  const organizer = document.getElementById('clubOrganizerNameInput')?.value.trim();
  const organizerDetails = document.getElementById('clubOrganizerDetailsInput')?.value.trim();
  const socialLink = document.getElementById('clubSocialLinkInput')?.value.trim();
  const contact = document.getElementById('clubContactDetailsInput')?.value.trim();
  const scope = document.getElementById('clubAreaScopeInput')?.value.trim();
  const rawMembers = document.getElementById('clubMembersInput')?.value || '';

  if (!name || !organizer) {
    alert("Please fill in at least Club Name and Organizer Name.");
    return;
  }

  const members = rawMembers
    .split(/\r?\n/)
    .map(m => m.replace(/^[\d\s\.\)\-]+/, '').trim())
    .filter(Boolean);

  if (members.length > 50) {
    alert("A maximum of 50 members is allowed per club.");
    return;
  }

  const newClub = {
    id: 'club_' + Date.now(),
    name,
    started: started || 'N/A',
    organizer,
    organizerDetails: organizerDetails || 'Organizer',
    socialLink: socialLink || '#',
    contact: contact || 'N/A',
    scope: scope || 'General',
    members,
    createdBy: userEmail
  };

  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveClub',
        club: newClub
      })
    });
  } catch (err) {
    console.error("Failed to save club to cloud:", err);
  }

  closeClubModal();
  await fetchMetricsAndClubs();
  alert("Pickleball Club registered successfully!");
}

function renderClubs() {
  const container = document.getElementById('clubListingContainer');
  if (!container) return;

  const clubs = getClubs();
  container.innerHTML = '';

  if (clubs.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); font-size: 0.8rem; padding: 10px 0;">No pickleball clubs registered yet. Create one today!</p>';
    return;
  }

  clubs.forEach(club => {
    const card = document.createElement('div');
    card.className = 'club-card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 6px;">
        <strong style="font-size: 0.95rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px;">${club.name}</strong>
        <span class="tag">${club.scope}</span>
      </div>
      <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom: 4px;"><strong>Founded:</strong> ${club.started}</p>
      <p style="font-size:0.75rem; color:var(--text-main); margin-bottom: 4px;"><strong>Organizer:</strong> ${club.organizer} (${club.organizerDetails})</p>
      <p style="font-size:0.75rem; color:var(--text-main); margin-bottom: 4px;"><strong>Contact:</strong> ${club.contact}</p>
      ${club.socialLink && club.socialLink !== '#' ? `<p style="font-size:0.75rem; margin-bottom: 6px;"><a href="${club.socialLink}" target="_blank" style="color:var(--info);">🔗 Official Social Media Page</a></p>` : ''}
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
        <p style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted);">MEMBERS (${club.members.length}/50):</p>
        <p style="font-size: 0.75rem; color: var(--text-main);">${club.members.length > 0 ? club.members.join(', ') : 'No members added yet.'}</p>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ==========================================
   END MATCH GAME SESSION (INCREASES TOTAL SESSIONS RUN)
   ========================================== */

async function endSession() {
  if (isViewerMode) return;
  if (!confirm("Are you sure you want to end this game session and view final standings?")) return;

  renderFinalLeaderboard();
  showView('viewLeaderboard');

  const sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (sessionId) {
    try {
      // Works for BOTH guest and logged-in users:
      // Removes from active sessions in Firebase and increments stats/sessionsRun (+1)
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'endSession',
          sessionId: sessionId
        })
      });
    } catch (err) {
      console.error("Error ending cloud session:", err);
    }
  }

  localStorage.removeItem(STORAGE_KEY);
  sessionData = { 
    title: "", 
    mode: "doubles", 
    maxGames: null, 
    isStarted: false,
    players: [], 
    courts: [{ id: 1, name: "Court 1", activeMatch: null }] 
  };

  const resumeCard = document.getElementById('resumeCard');
  if (resumeCard) resumeCard.style.display = 'none';

  await fetchMetricsAndClubs();
}

function renderFinalLeaderboard() {
  const titleEl = document.getElementById('leaderboardSessionTitle');
  if (titleEl) titleEl.textContent = sessionData.title || "Final Leaderboard";

  const sorted = [...sessionData.players].sort((a, b) => {
    const winRateA = a.matchesPlayed > 0 ? (a.wins / a.matchesPlayed) : 0;
    const winRateB = b.matchesPlayed > 0 ? (b.wins / b.matchesPlayed) : 0;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return winRateB - winRateA;
  });

  const podiumContainer = document.getElementById('podiumContainer');
  if (podiumContainer) {
    podiumContainer.innerHTML = '';

    const first = sorted[0];
    const second = sorted[1];
    const third = sorted[2];

    const createPodiumCard = (p, rank, label, cls) => {
      if (!p) return '';
      const winRate = p.matchesPlayed > 0 ? ((p.wins / p.matchesPlayed) * 100).toFixed(0) : 0;
      return `
        <div class="podium-card ${cls}">
          <div class="podium-rank">${label}</div>
          <div class="podium-name">${p.name}</div>
          <div class="podium-stats">${p.wins} Wins - ${winRate}%</div>
        </div>
      `;
    };

    podiumContainer.innerHTML = `
      ${second ? createPodiumCard(second, 2, '🥈 2nd', 'second') : ''}
      ${first ? createPodiumCard(first, 1, '🥇 1st', 'first') : ''}
      ${third ? createPodiumCard(third, 3, '🥉 3rd', 'third') : ''}
    `;
  }

  const tbody = document.getElementById('finalStandingsTable');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 15px;">No players participated in this session.</td></tr>`;
    return;
  }

  sorted.forEach((p, index) => {
    const winRate = p.matchesPlayed > 0 ? ((p.wins / p.matchesPlayed) * 100).toFixed(0) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${index + 1}</strong></td>
      <td><strong>${p.name}</strong></td>
      <td>${p.matchesPlayed}</td>
      <td>${p.wins} - ${p.losses}</td>
      <td class="win-rate">${winRate}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function render() {
  renderCourts();
  renderQueue();
  renderStandings();
  updateMatchTimers();
}

function renderCourts() {
  const grid = document.getElementById('courtsGrid');
  if (!grid) return;
  
  const countEl = document.getElementById('courtCountDisplay');
  if (countEl) countEl.textContent = sessionData.courts.length;
  grid.innerHTML = '';

  sessionData.courts.forEach(court => {
    const div = document.createElement('div');
    div.className = `court-card ${court.activeMatch ? 'has-match' : ''}`;

    if (!court.activeMatch) {
      div.innerHTML = `
        <div class="court-title">
          <span>${court.name}</span>
          ${sessionData.courts.length > 1 ? `<button type="button" class="btn-danger host-only-control" style="padding: 2px 6px;" onclick="removeCourt(${court.id})">✕ Remove</button>` : ''}
        </div>
        <p style="text-align: center; color: var(--text-muted); font-size: 0.78rem; margin: 12px 0;">Court Available</p>
        <button type="button" class="btn-outline host-only-control" style="width: 100%; font-size: 0.72rem;" onclick="generateMatchForCourt(${court.id})">Assign Match Here</button>
      `;
    } else {
      const renderTeamHtml = (team) => {
        return team.map(p => `
          <div style="display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 0.8rem; font-weight: 700;">
            <span>${p.name}</span>
            <button type="button" class="btn-secondary btn-compact host-only-control" style="padding: 1px 4px !important; font-size: 0.6rem !important;" title="Emergency Swap Player" onclick="openSwapModal(${court.id}, ${p.id})">✏️</button>
          </div>
        `).join('');
      };

      const t1Html = renderTeamHtml(court.activeMatch.team1);
      const t2Html = renderTeamHtml(court.activeMatch.team2);

      div.innerHTML = `
        <div class="court-title">
          <span>${court.name}</span>
          <span class="tag tag-timer" id="timer-court-${court.id}">⏱️ 00:00</span>
        </div>
        <div class="match-teams">
          <div class="team">
            <div class="team-players">${t1Html}</div>
            <button type="button" class="btn-primary host-only-control" style="width: 100%; font-size: 0.68rem; padding: 5px; margin-top: 6px;" onclick="recordWinner(${court.id}, 1)">Team 1 Win</button>
          </div>
          <div class="vs">VS</div>
          <div class="team">
            <div class="team-players">${t2Html}</div>
            <button type="button" class="btn-primary host-only-control" style="width: 100%; font-size: 0.68rem; padding: 5px; margin-top: 6px;" onclick="recordWinner(${court.id}, 2)">Team 2 Win</button>
          </div>
        </div>
      `;
    }
    grid.appendChild(div);
  });
}

function renderQueue() {
  const queueList = document.getElementById('playerQueue');
  if (!queueList) return;
  const queueCount = document.getElementById('queueCount');
  
  const available = sessionData.players.filter(p => !p.playing);
  available.sort((a, b) => {
    if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed - b.matchesPlayed;
    const winRateA = a.matchesPlayed > 0 ? (a.wins / a.matchesPlayed) : 0;
    const winRateB = b.matchesPlayed > 0 ? (b.wins / b.matchesPlayed) : 0;
    return winRateB - winRateA;
  });

  if (queueCount) queueCount.textContent = available.length;
  queueList.innerHTML = '';

  if (available.length === 0) {
    queueList.innerHTML = `<li style="color: var(--text-muted); text-align: center; padding: 12px; font-size: 0.8rem;">Queue is empty.</li>`;
    return;
  }

  available.forEach(p => {
    const hasReachedCap = sessionData.maxGames !== null && p.matchesPlayed >= sessionData.maxGames;
    const playerStrength = p.strength || 3;
    const strengthName = STRENGTH_LABELS[playerStrength] || "Intermediate";

    const li = document.createElement('li');
    li.className = 'player-item';
    li.innerHTML = `
      <div>
        <strong>${p.name}</strong>
        <span class="tag tag-strength" style="margin-left: 6px;">${strengthName} (${playerStrength}★)</span>
        ${hasReachedCap ? `<span class="tag tag-danger" style="margin-left: 4px;">MAX REACHED (${p.matchesPlayed}/${sessionData.maxGames})</span>` : ''}
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="tag">${p.matchesPlayed} games</span>
        <button type="button" class="btn-danger host-only-control" onclick="removePlayer(${p.id})">✕</button>
      </div>
    `;
    queueList.appendChild(li);
  });
}

function renderStandings() {
  const tbody = document.getElementById('standingsTable');
  if (!tbody) return;
  tbody.innerHTML = '';

  const sorted = [...sessionData.players].sort((a, b) => {
    const winRateA = a.matchesPlayed > 0 ? (a.wins / a.matchesPlayed) : 0;
    const winRateB = b.matchesPlayed > 0 ? (b.wins / b.matchesPlayed) : 0;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return winRateB - winRateA;
  });

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 15px;">No players registered.</td></tr>`;
    return;
  }

  sorted.forEach((p, index) => {
    const winRate = p.matchesPlayed > 0 ? ((p.wins / p.matchesPlayed) * 100).toFixed(0) : 0;
    const playerStrength = p.strength || 3;
    const strengthName = STRENGTH_LABELS[playerStrength] || "Intermediate";

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-muted);">${index + 1}</td>
      <td><strong>${p.name}</strong> ${p.playing ? '🎾' : ''} <div style="font-size: 0.65rem; color: var(--gold);">${strengthName} (${playerStrength}★)</div></td>
      <td>${p.matchesPlayed}${sessionData.maxGames ? `/${sessionData.maxGames}` : ''}</td>
      <td>${p.wins}-${p.losses}</td>
      <td class="win-rate">${winRate}%</td>
      <td style="text-align: right;" class="host-only-control"><button type="button" class="btn-danger" onclick="removePlayer(${p.id})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// Window Global Attachments
window.toggleAuthDrawer = toggleAuthDrawer;
window.loginOrRegister = loginOrRegister;
window.logout = logout;
window.launchMatchGame = launchMatchGame;
window.resumeSession = resumeSession;
window.clearSavedData = clearSavedData;
window.goHome = goHome;
window.addCourt = addCourt;
window.removeCourt = removeCourt;
window.addPlayer = addPlayer;
window.addMultiplePlayers = addMultiplePlayers;
window.removePlayer = removePlayer;
window.setStrengthRating = setStrengthRating;
window.generateMatchForCourt = generateMatchForCourt;
window.generateAutoMatch = generateAutoMatch;
window.recordWinner = recordWinner;
window.openShareModal = openShareModal;
window.closeShareModal = closeShareModal;
window.copyShareLink = copyShareLink;
window.openSwapModal = openSwapModal;
window.closeSwapModal = closeSwapModal;
window.confirmPlayerSwap = confirmPlayerSwap;
window.openClubModal = openClubModal;
window.closeClubModal = closeClubModal;
window.saveClub = saveClub;
window.endSession = endSession;
