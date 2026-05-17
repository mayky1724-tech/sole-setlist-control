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
      state.currentTime = args[0];
      updateActiveSong();
      broadcastState();
      break;

    case '/live/song/get/tempo':
      state.tempo = Math.round(args[0]);
      broadcastState();
      break;

    case '/live/song/get/cue_points': {
      // AbletonOSC returns cue points as flat [time1, name1, time2, name2, ...]
      const cues = [];
      for (let i = 0; i < args.length; i += 2) {
        const time = args[i];
        const name = args[i + 1];
        if (typeof time === 'number' && typeof name === 'string') {
          cues.push({ time, name, index: cues.length });
        }
      }
      cues.sort((a, b) => a.time - b.time);
      // Re-index after sort
      cues.forEach((c, i) => c.index = i);
      state.songs = cues;

      // Build default setlist order if empty or stale
      const knownCount = state.setlistOrder.length;
      const newCount   = cues.length;
      if (knownCount === 0 || knownCount !== newCount) {
        state.setlistOrder = cues.map((_, i) => i);
        saveSetlist();
      }
      broadcastState();
      break;
    }

    default:
      break;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function updateActiveSong() {
  const t = state.currentTime;
  let active = -1;
  for (let i = state.songs.length - 1; i >= 0; i--) {
    if (t >= state.songs[i].time) {
      active = i;
      break;
    }
  }
  state.activeSong = active;
}

function pollAbleton() {
  sendOSC('/live/song/get/is_playing');
  sendOSC('/live/song/get/current_song_time');
  sendOSC('/live/song/get/tempo');
  sendOSC('/live/song/get/cue_points');
}

// ── Express + Socket.io ───────────────────────────────────────────────────────
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

  // ── Jump to song by its index in state.songs[]
  socket.on('jump', (songIndex) => {
    const song = state.songs[songIndex];
    if (!song) return;
    sendOSC('/live/song/set/current_song_time', song.time);
    // Small delay then auto-play if not already playing
    setTimeout(() => {
      if (!state.isPlaying) sendOSC('/live/song/start_playing');
    }, 100);
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
      socket.emit('triggerJump', nextIdx);
      sendOSC('/live/song/set/current_song_time', state.songs[nextIdx].time);
      setTimeout(() => {
        if (!state.isPlaying) sendOSC('/live/song/start_playing');
      }, 100);
    }
  });

  socket.on('prev', () => {
    const pos = state.setlistOrder.indexOf(state.activeSong);
    // If >4 seconds in, restart current; else go to previous
    const threshold = 4;
    if (state.currentTime - (state.songs[state.activeSong]?.time || 0) > threshold) {
      sendOSC('/live/song/set/current_song_time', state.songs[state.activeSong]?.time || 0);
    } else {
      const prevPos = pos - 1;
      if (prevPos >= 0) {
        const prevIdx = state.setlistOrder[prevPos];
        sendOSC('/live/song/set/current_song_time', state.songs[prevIdx].time);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// ── Start polling ─────────────────────────────────────────────────────────────
setInterval(pollAbleton, POLL_INTERVAL);
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
