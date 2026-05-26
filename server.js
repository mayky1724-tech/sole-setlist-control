/**
 * SOLÉ SetlistControl – Server
 * ────────────────────────────
 * Requires AbletonOSC running in Ableton Live.
 * Install: https://github.com/ideoforms/AbletonOSC
 *
 * Usage:
 *   npm install
 *   node server.js
 *
 * Then open http://<your-local-ip>:3000 on any device on the same WiFi.
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const osc        = require('node-osc');
const path       = require('path');
const fs         = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const WEB_PORT        = 3000;
const OSC_LISTEN_PORT = 11001;   // Port this server listens for replies from Ableton
const OSC_SEND_PORT   = 11000;   // AbletonOSC default receive port
const OSC_HOST        = '127.0.0.1';
const POLL_INTERVAL   = 500;     // ms – how often to ask Ableton for state

// ── State ─────────────────────────────────────────────────────────────────────
let jumpLock = false;
let state = {
  isPlaying:    false,
  currentTime:  0,       // seconds
  tempo:        120,
  songs:        [],      // [{ name, time, index }]
  activeSong:   -1,
  setlistOrder: [],      // array of indices into songs[]
  connected:    false,
};

let setlistPath = path.join(__dirname, 'setlist.json');

function loadSetlist() {
  if (fs.existsSync(setlistPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(setlistPath, 'utf8'));
      state.setlistOrder = data.order || [];
    } catch(e) {}
  }
}

function saveSetlist() {
  fs.writeFileSync(setlistPath, JSON.stringify({ order: state.setlistOrder }, null, 2));
}

loadSetlist();

// ── OSC Client (sends to Ableton) ─────────────────────────────────────────────
const oscClient = new osc.Client(OSC_HOST, OSC_SEND_PORT);

function sendOSC(address, ...args) {
  oscClient.send(address, ...args, (err) => {
    if (err) console.error('[OSC send error]', address, err.message);
  });
}

// ── OSC Server (receives from Ableton) ────────────────────────────────────────
const oscServer = new osc.Server(OSC_LISTEN_PORT, OSC_HOST);

oscServer.on('message', (msg) => {
  const [address, ...args] = msg;
  handleOSCMessage(address, args);
});

oscServer.on('error', (err) => {
  console.error('[OSC server error]', err.message);
});

function handleOSCMessage(address, args) {
  switch (address) {
    case '/live/song/get/is_playing':
      state.isPlaying = args[0] === 1;
      state.connected = true;
      broadcastState();
      break;

    case '/live/song/get/current_song_time':
      if (!jumpLock) {
        state.currentTime = args[0];
        updateActiveSong();
        broadcastState();
      }
      break;

    case '/live/song/get/tempo':
      state.tempo = Math.round(args[0]);
      broadcastState();
      break;



    default:
      break;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Track cue index by listening to jump_to_next/prev_cue results
// We detect position by comparing currentTime to known cue beat positions
// Once we learn real beat positions, we store them
let cueBeats = {}; // { songIndex: beatValue }

function updateActiveSong() {
  const t = state.currentTime;
  if (t === undefined || t === null) return;

  // Store current time against the closest song if within 8 beats
  // This self-calibrates over time
  for (let i = 0; i < state.songs.length; i++) {
    const expected = state.songs[i].time;
    if (Math.abs(t - expected) < 8) {
      if (!cueBeats[i] || Math.abs(t - expected) < Math.abs(cueBeats[i] - expected)) {
        cueBeats[i] = t;
        state.songs[i].time = Math.round(t);
      }
    }
  }

  // Find active song by closest known beat position
  let active = -1;
  let closest = Infinity;
  for (let i = 0; i < state.songs.length; i++) {
    const beat = state.songs[i].time;
    if (t >= beat - 2) {
      const dist = t - beat;
      const nextBeat = i < state.songs.length - 1 ? state.songs[i+1].time : Infinity;
      if (t < nextBeat && dist < closest) {
        closest = dist;
        active = i;
      }
    }
  }
  state.activeSong = active;
}

function loadSongsFile() {
  const songsPath = path.join(__dirname, 'songs.json');
  if (!fs.existsSync(songsPath)) { console.log('[Songs] songs.json no encontrado.'); return; }
  try {
    const songs = JSON.parse(fs.readFileSync(songsPath, 'utf8'));
    state.songs = songs.map((s, i) => ({ ...s, index: i }));
    if (state.setlistOrder.length !== songs.length) {
      state.setlistOrder = songs.map((_, i) => i);
      saveSetlist();
    }
    console.log('[Songs] ' + songs.length + ' canciones cargadas desde songs.json');
    broadcastState();
  } catch(e) { console.error('[Songs] Error:', e.message); }
}

function pollAbleton() {
  sendOSC('/live/song/get/is_playing');
  if (!jumpLock) sendOSC('/live/song/get/current_song_time');
  sendOSC('/live/song/get/tempo');
}


const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// REST fallback for initial state
app.get('/api/state', (req, res) => res.json(state));

// Calibration page
app.get('/calibrate', (req, res) => {
  const songNames = JSON.stringify(state.songs.map(s => s.name));
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Calibrar</title>
<style>
body{background:#0a0a0b;color:#c8ff3e;font-family:monospace;padding:30px;}
#beat{font-size:72px;font-weight:bold;margin:16px 0;color:#fff;}
.row{display:flex;align-items:center;gap:10px;margin:6px 0;padding:10px;background:#111;border:1px solid #222;}
.name{width:160px;color:#c8ff3e;}
.val{background:#000;color:#fff;border:1px solid #444;padding:6px;width:100px;font-size:16px;}
.btn{background:#c8ff3e;color:#000;border:none;padding:8px 14px;cursor:pointer;font-weight:bold;}
</style></head><body>
<h2>Beat actual:</h2>
<div id="beat">—</div>
<p>Mueve el cabezal en Ableton a cada cancion y presiona SET</p>
<div id="songs"></div>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const songs = ${songNames};
let beat = 0;
socket.on('state', s => { beat = s.currentTime; document.getElementById('beat').textContent = beat.toFixed(1); });
const c = document.getElementById('songs');
songs.forEach((n,i) => {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = '<span class="name">'+n+'</span><input class="val" id="v'+i+'" /><button class="btn" onclick="document.getElementById('v'+i+"').value=beat.toFixed(1)">SET</button>";
  c.appendChild(d);
});
</script></body></html>`);
});

// ── Socket.io events ──────────────────────────────────────────────────────────
function broadcastState() {
  io.emit('state', state);
}

io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);
  socket.emit('state', state);

  // ── Playback controls
  socket.on('play',  () => sendOSC('/live/song/start_playing'));
  socket.on('stop',  () => sendOSC('/live/song/stop_playing'));
  socket.on('pause', () => sendOSC('/live/song/stop_playing'));

  // ── Jump to song by beat position
  socket.on('jump', (songIndex) => {
    const song = state.songs[songIndex];
    if (!song) return;
    stopPolling();
    jumpLock = true;
    // Set position → stop → play
    const beatTime = parseFloat(song.time);
    sendOSC('/live/song/set/current_song_time', beatTime);
    setTimeout(() => {
      sendOSC('/live/song/stop_playing');
      setTimeout(() => {
        sendOSC('/live/song/set/current_song_time', beatTime);
        setTimeout(() => {
          sendOSC('/live/song/start_playing');
        }, 150);
      }, 150);
    }, 100);
    state.activeSong = songIndex;
    state.currentTime = beatTime;
    broadcastState();
    setTimeout(() => {
      jumpLock = false;
      startPolling();
    }, 3000);
  });

  // ── Reorder setlist
  socket.on('reorder', (newOrder) => {
    state.setlistOrder = newOrder;
    saveSetlist();
    broadcastState();
  });

  // ── Next / previous song in setlist
  socket.on('next', () => {
    const pos = state.setlistOrder.indexOf(state.activeSong);
    const nextPos = pos + 1;
    if (nextPos < state.setlistOrder.length) {
      const nextIdx = state.setlistOrder[nextPos];
      const song = state.songs[nextIdx];
      if (song) {
        jumpLock = true;
        sendOSC('/live/song/set/current_song_time', parseFloat(song.time));
        if (!state.isPlaying) setTimeout(() => sendOSC('/live/song/start_playing'), 200);
        state.activeSong = nextIdx;
        broadcastState();
        setTimeout(() => { jumpLock = false; }, 1500);
      }
    }
  });

  socket.on('prev', () => {
    const pos = state.setlistOrder.indexOf(state.activeSong);
    const prevPos = pos - 1;
    if (prevPos >= 0) {
      const prevIdx = state.setlistOrder[prevPos];
      const song = state.songs[prevIdx];
      if (song) {
        jumpLock = true;
        sendOSC('/live/song/set/current_song_time', parseFloat(song.time));
        if (!state.isPlaying) setTimeout(() => sendOSC('/live/song/start_playing'), 200);
        state.activeSong = prevIdx;
        broadcastState();
        setTimeout(() => { jumpLock = false; }, 1500);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// ── Start polling ─────────────────────────────────────────────────────────────
loadSongsFile();
let pollInterval = setInterval(pollAbleton, POLL_INTERVAL);

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}
function startPolling() {
  if (!pollInterval) { pollInterval = setInterval(pollAbleton, POLL_INTERVAL); }
}

startPolling();
pollAbleton();

// ── Start server ──────────────────────────────────────────────────────────────
server.listen(WEB_PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        localIP = addr.address;
        break;
      }
    }
  }
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       SOLÉ SetlistControl – Servidor      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Local:    http://localhost:${WEB_PORT}          ║`);
  console.log(`║  Red WiFi: http://${localIP}:${WEB_PORT}    ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Abre la URL de Red en tu celular         ║');
  console.log('║  (misma WiFi que el PC con Ableton)       ║');
  console.log('╚══════════════════════════════════════════╝\n');
});
