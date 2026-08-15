import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Helper to decode Base64 strings at runtime
const _d = (str) => atob(str);

const firebaseConfig = {
  apiKey: _d("QUl6YVN5REF0cjJqMGlRa2FQdVlMY3FKaEl3MUlxZnN5Q0NMVVVZ"),
  authDomain: _d("cGlja2xlcWV1ZS5maXJlYmFzZWFwcC5jb20="),
  databaseURL: _d("aHR0cHM6Ly9waWNrbGVxdWUtZGVmYXVsdC1ydGRiLmFzaWEtc291dGhlYXN0MS5maXJlYmFzZWRhdGFiYXNlLmFwcA=="),
  projectId: _d("cGlja2xlcWV1ZQ=="),
  storageBucket: _d("cGlja2xlcWV1ZS5maXJlYmFzZXN0b3JhZ2UuYXBw"),
  messagingSenderId: _d("NjYzMzU1MTk3NTU3"),
  appId: _d("MTo2NjMzNTUxOTc1NTc6d2ViOjRjMmFiZDY5NGUyNmZkMmQ5MzlmM2M="),
  measurementId: _d("Ry04WVpDNVIwMDdN")
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app, firebaseConfig.databaseURL);

let currentUser = null;
let selectedPlayerStrength = 3;
let isViewerMode = false;
let viewerSessionId = null;
let timerInterval = null;

let pendingSwapCourtId = null;
let pendingSwapOldPlayerId = null;

let sessionData = {
  title: "",
  mode: "doubles",
  maxGames: null,
  players: [],
  courts: [
    { id: 1, name: "Court 1", activeMatch: null }
  ]
};

const STORAGE_KEY = 'pb_session_store_v2';

const STRENGTH_LABELS = {
  1: "Novice",
  2: "Beginner",
  3: "Intermediate",
  4: "Advanced",
  5: "Pro"
};

// Check query parameters for Spectator Live View link on load
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionParam = urlParams.get('session');

  startTimerLoop();

  if (sessionParam) {
    isViewerMode = true;
    viewerSessionId = sessionParam;
    setupViewerMode();
  } else {
    checkSavedSession();
  }
});

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

  document.getElementById('viewerBanner').style.display = 'block';
  document.getElementById('btnAuthHeader').style.display = 'none';
  document.getElementById('btnShareLiveTop').style.display = 'none';
  
  const grid = document.getElementById('dashboardGrid');
  grid.classList.add('viewer-grid');
  
  showView('viewApp');

  document.getElementById('displaySessionTitle').textContent = "Connecting to Host Live Session...";
  document.getElementById('displayMatchFormat').textContent = "Syncing...";

  // Listen to real-time session updates from host
  const sessionRef = ref(db, 'sessions/' + viewerSessionId);
  onValue(sessionRef, (snapshot) => {
    const val = snapshot.val();
    if (val) {
      sessionData = val;
      if (!sessionData.players) sessionData.players = [];
      if (!sessionData.courts) sessionData.courts = [{ id: 1, name: "Court 1", activeMatch: null }];
      if (!sessionData.mode) sessionData.mode = "doubles";
      
      document.getElementById('displaySessionTitle').textContent = sessionData.title || "Live Pickleball Play";
      document.getElementById('displayMatchFormat').textContent = (sessionData.mode === 'doubles' ? 'Doubles (2v2)' : 'Singles (1v1)') + " format";
      document.getElementById('displayMaxCap').textContent = sessionData.maxGames ? `Max ${sessionData.maxGames} Games Cap` : 'No Cap';
      
      render();
    } else {
      document.getElementById('displaySessionTitle').textContent = "Host Session Not Found / Offline";
      document.getElementById('displayMatchFormat').textContent = "Waiting for host to broadcast";
      sessionData = { title: "Host Offline", mode: "doubles", players: [], courts: [] };
      render();
    }
  }, (error) => {
    console.error("Firebase Viewer Sync Error:", error);
    document.getElementById('displaySessionTitle').textContent = "Sync Connection Error";
  });
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    try {
      await signInAnonymously(auth);
      return;
    } catch (e) {
      console.warn("Anonymous sign in notice:", e);
    }
  }

  if (isViewerMode) return;

  const banner = document.getElementById('storageBanner');
  const authLoggedOut = document.getElementById('authLoggedOut');
  const authLoggedIn = document.getElementById('authLoggedIn');
  const userDisplayEmail = document.getElementById('userDisplayEmail');
  const headerAuthLabel = document.getElementById('headerAuthLabel');

  if (user && !user.isAnonymous) {
    authLoggedOut.style.display = 'none';
    authLoggedIn.style.display = 'block';
    userDisplayEmail.textContent = user.email.toUpperCase();
    headerAuthLabel.textContent = "Synced";

    banner.style.borderColor = 'var(--accent)';
    banner.style.color = 'var(--accent)';
    banner.innerHTML = `☁️ Account Cloud Sync Active (${user.email})`;
  } else {
    authLoggedOut.style.display = 'block';
    authLoggedIn.style.display = 'none';
    headerAuthLabel.textContent = "Cloud Login";

    banner.style.borderColor = 'var(--accent)';
    banner.style.color = 'var(--accent)';
    banner.innerHTML = `☁️ Live Cloud Sync active! Shared QR links will update live for all spectators.`;
  }

  if (user) {
    saveToStorage();
  }
});

async function openShareModal() {
  if (!auth.currentUser && !isViewerMode) {
    try {
      await signInAnonymously(auth);
    } catch (e) {
      alert("Unable to establish sync connection. Please try again.");
      return;
    }
  }

  const hostUid = isViewerMode ? viewerSessionId : (auth.currentUser ? auth.currentUser.uid : null);
  if (!hostUid) {
    alert("Session ID not ready yet. Please retry.");
    return;
  }

  const liveUrl = `${window.location.origin}${window.location.pathname}?session=${hostUid}`;
  
  document.getElementById('shareUrlInput').value = liveUrl;
  document.getElementById('qrCodeImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(liveUrl)}`;
  document.getElementById('shareModal').classList.add('open');
}

function closeShareModal() {
  document.getElementById('shareModal').classList.remove('open');
}

function copyShareLink() {
  const input = document.getElementById('shareUrlInput');
  input.select();
  navigator.clipboard.writeText(input.value);
  alert("Live View URL copied to clipboard! Share it with your players.");
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
  document.getElementById('strengthRatingLabel').textContent = `${STRENGTH_LABELS[rating]} (${rating} ${rating === 1 ? 'Star' : 'Stars'})`;
}

function toggleAuthDrawer() {
  document.getElementById('authDrawer').classList.toggle('open');
}

async function loginOrRegister() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!email || !password) return alert("Please enter email and password.");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    toggleAuthDrawer();
  } catch (error) {
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        await createUserWithEmailAndPassword(auth, email, password);
        alert("New account created!");
        toggleAuthDrawer();
      } catch (createErr) { alert("Error signing up: " + createErr.message); }
    } else { alert("Auth Error: " + error.message); }
  }
}

async function logout() {
  await signOut(auth);
  location.reload();
}

function saveToStorage() {
  if (isViewerMode) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
  
  const activeUser = auth.currentUser;
  if (activeUser) {
    set(ref(db, 'sessions/' + activeUser.uid), sessionData).catch(err => console.error("Firebase sync error:", err));
  }
}

function checkSavedSession() {
  if (isViewerMode) return;
  if (sessionData && (sessionData.players.length > 0 || sessionData.title)) {
    document.getElementById('resumeCard').style.display = 'block';
    document.getElementById('resumeDetails').textContent = `Active Session: "${sessionData.title || 'Untitled Play'}" with ${sessionData.players.length} player(s).`;
  } else {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.players.length > 0 || parsed.title)) {
          sessionData = parsed;
          if (!sessionData.mode) sessionData.mode = "doubles";
          document.getElementById('resumeCard').style.display = 'block';
          document.getElementById('resumeDetails').textContent = `Saved Session: "${parsed.title || 'Untitled Play'}" with ${parsed.players.length} player(s).`;
        }
      } catch(e) {}
    }
  }
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

function launchMatchGame(selectedMode) {
  const titleInput = document.getElementById('sessionTitleInput').value.trim();
  const maxInput = parseInt(document.getElementById('maxGamesInput').value, 10);

  sessionData.title = titleInput || `${selectedMode === 'singles' ? 'Singles' : 'Doubles'} Open Play`;
  sessionData.mode = selectedMode;
  sessionData.maxGames = !isNaN(maxInput) && maxInput > 0 ? maxInput : null;

  saveToStorage();
  startSessionUI();
}

function resumeSession() {
  if (!sessionData.players) sessionData.players = [];
  if (!sessionData.courts) sessionData.courts = [{ id: 1, name: "Court 1", activeMatch: null }];
  if (!sessionData.mode) sessionData.mode = "doubles";
  startSessionUI();
}

function startSessionUI() {
  document.getElementById('displaySessionTitle').textContent = sessionData.title;
  document.getElementById('displayMatchFormat').textContent = (sessionData.mode === 'doubles' ? 'Doubles (2v2)' : 'Singles (1v1)') + " format";
  document.getElementById('displayMaxCap').textContent = sessionData.maxGames ? `Max ${sessionData.maxGames} Games Cap` : 'No Cap';
  showView('viewApp');
  setStrengthRating(3);
  render();
}

function goHome() {
  saveToStorage();
  checkSavedSession();
  showView('viewHome');
}

function clearSavedData() {
  if (confirm("Delete current session and data?")) {
    localStorage.removeItem(STORAGE_KEY);
    const activeUser = auth.currentUser;
    if (activeUser) set(ref(db, 'sessions/' + activeUser.uid), null);
    sessionData = { title: "", mode: "doubles", maxGames: null, players: [], courts: [{ id: 1, name: "Court 1", activeMatch: null }] };
    document.getElementById('resumeCard').style.display = 'none';
    render();
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
  const targetCourt = sessionData.courts.find(c => c.id === courtId);
  if (targetCourt && targetCourt.activeMatch) {
    alert("Cannot remove a court with an active match in progress.");
    return;
  }
  if (sessionData.courts.length <= 1) {
    alert("You must keep at least 1 court.");
    return;
  }
  sessionData.courts = sessionData.courts.filter(c => c.id !== courtId);
  saveToStorage();
  render();
}

function addPlayer() {
  if (isViewerMode) return;
  const input = document.getElementById('playerNameInput');
  const name = input.value.trim();
  if (!name) return;

  sessionData.players.push({
    id: Date.now(),
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

function removePlayer(id) {
  if (isViewerMode) return;
  const isPlaying = sessionData.courts.some(c => c.activeMatch && c.activeMatch.players.some(p => p.id === id));
  if (isPlaying) {
    alert("Cannot remove a player who is currently in an active match.");
    return;
  }
  sessionData.players = sessionData.players.filter(p => p.id !== id);
  saveToStorage();
  render();
}

function generateMatchForCourt(courtId) {
  if (isViewerMode) return;
  const court = sessionData.courts.find(c => c.id === courtId);
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
  const court = sessionData.courts.find(c => c.id === courtId);
  if (!court || !court.activeMatch) return;

  const winners = winningTeamNum === 1 ? court.activeMatch.team1 : court.activeMatch.team2;
  const losers = winningTeamNum === 1 ? court.activeMatch.team2 : court.activeMatch.team1;

  winners.forEach(w => {
    const p = sessionData.players.find(x => x.id === w.id);
    if (p) { p.wins++; p.matchesPlayed++; p.playing = false; }
  });

  losers.forEach(l => {
    const p = sessionData.players.find(x => x.id === l.id);
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

  const oldPlayer = sessionData.players.find(p => p.id === oldPlayerId);
  document.getElementById('swapOldPlayerName').textContent = oldPlayer ? oldPlayer.name : 'Selected Player';

  const select = document.getElementById('swapNewPlayerSelect');
  select.innerHTML = '<option value="">-- Choose Replacement Player --</option>';

  const available = sessionData.players.filter(p => !p.playing);
  available.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${STRENGTH_LABELS[p.strength] || 'Intermediate'} - ${p.matchesPlayed} games)`;
    select.appendChild(opt);
  });

  document.getElementById('swapModal').classList.add('open');
}

function closeSwapModal() {
  document.getElementById('swapModal').classList.remove('open');
  pendingSwapCourtId = null;
  pendingSwapOldPlayerId = null;
}

function confirmPlayerSwap() {
  if (isViewerMode) return;
  const select = document.getElementById('swapNewPlayerSelect');
  const newPlayerId = parseInt(select.value, 10);
  if (!newPlayerId) return alert("Please select a replacement player.");

  const court = sessionData.courts.find(c => c.id === pendingSwapCourtId);
  if (!court || !court.activeMatch) return;

  const oldPlayer = sessionData.players.find(p => p.id === pendingSwapOldPlayerId);
  const newPlayer = sessionData.players.find(p => p.id === newPlayerId);

  if (oldPlayer) oldPlayer.playing = false;
  if (newPlayer) newPlayer.playing = true;

  court.activeMatch.players = court.activeMatch.players.map(p => p.id === pendingSwapOldPlayerId ? newPlayer : p);
  court.activeMatch.team1 = court.activeMatch.team1.map(p => p.id === pendingSwapOldPlayerId ? newPlayer : p);
  court.activeMatch.team2 = court.activeMatch.team2.map(p => p.id === pendingSwapOldPlayerId ? newPlayer : p);

  saveToStorage();
  closeSwapModal();
  render();
}

function render() {
  renderCourts();
  renderQueue();
  renderStandings();
  updateMatchTimers();
}

function renderCourts() {
  const grid = document.getElementById('courtsGrid');
  document.getElementById('courtCountDisplay').textContent = sessionData.courts.length;
  grid.innerHTML = '';

  sessionData.courts.forEach(court => {
    const div = document.createElement('div');
    div.className = `court-card ${court.activeMatch ? 'has-match' : ''}`;

    if (!court.activeMatch) {
      div.innerHTML = `
        <div class="court-title">
          <span>${court.name}</span>
          ${sessionData.courts.length > 1 ? `<button class="btn-danger host-only-control" style="padding: 2px 6px;" onclick="removeCourt(${court.id})">✕ Remove</button>` : ''}
        </div>
        <p style="text-align: center; color: var(--text-muted); font-size: 0.78rem; margin: 12px 0;">Court Available</p>
        <button class="btn-outline host-only-control" style="width: 100%; font-size: 0.72rem;" onclick="generateMatchForCourt(${court.id})">Assign Match Here</button>
      `;
    } else {
      const renderTeamHtml = (team) => {
        return team.map(p => `
          <div style="display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 0.8rem; font-weight: 700;">
            <span>${p.name}</span>
            <button class="btn-secondary btn-compact host-only-control" style="padding: 1px 4px !important; font-size: 0.6rem !important;" title="Emergency Swap Player" onclick="openSwapModal(${court.id}, ${p.id})">✏️</button>
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
            <button class="btn-primary host-only-control" style="width: 100%; font-size: 0.68rem; padding: 5px; margin-top: 6px;" onclick="recordWinner(${court.id}, 1)">Team 1 Win</button>
          </div>
          <div class="vs">VS</div>
          <div class="team">
            <div class="team-players">${t2Html}</div>
            <button class="btn-primary host-only-control" style="width: 100%; font-size: 0.68rem; padding: 5px; margin-top: 6px;" onclick="recordWinner(${court.id}, 2)">Team 2 Win</button>
          </div>
        </div>
      `;
    }
    grid.appendChild(div);
  });
}

function renderQueue() {
  const queueList = document.getElementById('playerQueue');
  const queueCount = document.getElementById('queueCount');
  
  const available = sessionData.players.filter(p => !p.playing);
  available.sort((a, b) => {
    if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed - b.matchesPlayed;
    const winRateA = a.matchesPlayed > 0 ? (a.wins / a.matchesPlayed) : 0;
    const winRateB = b.matchesPlayed > 0 ? (b.wins / b.matchesPlayed) : 0;
    return winRateB - winRateA;
  });

  queueCount.textContent = available.length;
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
        <button class="btn-danger host-only-control" onclick="removePlayer(${p.id})">✕</button>
      </div>
    `;
    queueList.appendChild(li);
  });
}

function renderStandings() {
  const tbody = document.getElementById('standingsTable');
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
      <td style="text-align: right;" class="host-only-control"><button class="btn-danger" onclick="removePlayer(${p.id})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// Globals mapping
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