// ══════════════════════════════════════════════════════════════════
// SPACE RACE — Server multiplayer
// Node.js + Socket.io — deploy su Railway
// ══════════════════════════════════════════════════════════════════
const express  = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Stato globale: tutti i giocatori connessi
// { socketId → { id, username, skin, x, y, angle, hp, score } }
const players = {};

// Health check — Railway lo usa per sapere che il server è vivo
app.get('/', (req, res) => {
  res.json({ status: 'ok', players: Object.keys(players).length });
});

io.on('connection', (socket) => {
  console.log(`[+] Connesso: ${socket.id}`);

  // ── Giocatore entra in partita ─────────────────────────────────
  socket.on('join', (data) => {
    players[socket.id] = {
      id:       socket.id,
      username: data.username || 'Sconosciuto',
      skin:     data.skin    || 0,
      x:        data.x       || 0,
      y:        data.y       || 0,
      angle:    data.angle   || 0,
      hp:       data.hp      || 20,
      score:    0,
    };
    // Manda al nuovo giocatore la lista di chi c'è già
    socket.emit('players', players);
    // Avvisa tutti gli altri che è arrivato qualcuno
    socket.broadcast.emit('player_joined', players[socket.id]);
    console.log(`  → ${data.username} entrato. Totale: ${Object.keys(players).length}`);
  });

  // ── Aggiornamento posizione (20x al secondo dal client) ────────
  socket.on('update', (data) => {
    if (!players[socket.id]) return;
    Object.assign(players[socket.id], data);
    socket.broadcast.emit('player_update', { id: socket.id, ...data });
  });

  // ── Proiettile sparato ─────────────────────────────────────────
  socket.on('bullet', (data) => {
    socket.broadcast.emit('bullet', { shooterId: socket.id, ...data });
  });

  // ── Colpo su un altro giocatore ────────────────────────────────
  socket.on('hit', (data) => {
    const target = players[data.targetId];
    if (!target) return;
    const dmg = data.damage || 3;
    target.hp = Math.max(0, target.hp - dmg);
    // Avvisa il bersaglio che ha subito danno
    io.to(data.targetId).emit('take_damage', {
      from:         socket.id,
      fromUsername: players[socket.id]?.username || '?',
      damage:       dmg,
      hp:           target.hp,
    });
    // Aggiorna l'HP del bersaglio per tutti
    io.emit('player_update', { id: data.targetId, hp: target.hp });
  });

  // ── HP ripristinato (power-up) ────────────────────────────────
  socket.on('hp_update', (data) => {
    if (!players[socket.id]) return;
    players[socket.id].hp = data.hp;
    socket.broadcast.emit('player_update', { id: socket.id, hp: data.hp });
  });

  // ── Giocatore esce ────────────────────────────────────────────
  socket.on('leave_game', () => {
    if (players[socket.id]) {
      console.log(`  ← ${players[socket.id].username} uscito dalla partita`);
      delete players[socket.id];
    }
    io.emit('player_left', socket.id);
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      console.log(`[-] Disconnesso: ${players[socket.id].username}`);
      delete players[socket.id];
    }
    io.emit('player_left', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Space Race server attivo sulla porta ${PORT}`);
});
