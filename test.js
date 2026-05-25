const osc = require('node-osc');
const c = new osc.Client('127.0.0.1', 11000);
const s = new osc.Server(11001, '0.0.0.0');

s.on('message', (m) => {
  console.log('Beat:', m[1]);
});

setInterval(() => {
  c.send('/live/song/get/current_song_time');
}, 500);

console.log('Mueve el cabezal en Ableton...');