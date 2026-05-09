const express  = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const players    = {};      // giocatori online in questo momento
const loginLog   = [];      // storico accessi (max 500, persiste finché server è acceso)

// ── Utility: estrae browser e OS dallo User-Agent ─────────────────
function parseBrowser(ua) {
  if (!ua) return 'Sconosciuto';
  if (ua.includes('Edg/'))     return 'Edge';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
  if (ua.includes('Chrome'))   return 'Chrome';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Firefox'))  return 'Firefox';
  return 'Altro';
}
function parseOS(ua) {
  if (!ua) return 'Sconosciuto';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Android'))  return 'Android';
  if (ua.includes('Windows'))  return 'Windows';
  if (ua.includes('Mac OS X')) return 'macOS';
  if (ua.includes('Linux'))    return 'Linux';
  return 'Altro';
}

// ── Health check ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', online: Object.keys(players).length });
});

// ── Endpoint admin: storico accessi ──────────────────────────────
// Nessuna autenticazione (solo voi tre conoscete il link)
app.get('/admin/logins', (req, res) => {
  res.json(loginLog);
});

// ── WebSocket ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const ip = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim()
             || socket.handshake.address;
  const ua = socket.handshake.headers['user-agent'] || '';

  // Evento login: registra accesso
  socket.on('login_event', (data) => {
    const entry = {
      username:  data.username,
      timestamp: new Date().toISOString(),
      ip:        ip,
      browser:   parseBrowser(ua),
      os:        parseOS(ua),
    };
    loginLog.push(entry);
    if (loginLog.length > 500) loginLog.shift(); // tieni solo gli ultimi 500
    console.log(`[login] ${entry.username} — ${entry.browser} su ${entry.os} — IP ${entry.ip}`);
  });

  // Giocatore entra in partita
  socket.on('join', (data) => {
    players[socket.id] = {
      id: socket.id, username: data.username, skin: data.skin,
      x: data.x, y: data.y, angle: data.angle, hp: data.hp, score: 0,
    };
    socket.emit('players', players);
    socket.broadcast.emit('player_joined', players[socket.id]);
  });

  socket.on('update', (data) => {
    if (!players[socket.id]) return;
    Object.assign(players[socket.id], data);
    socket.broadcast.emit('player_update', { id: socket.id, ...data });
  });

  socket.on('bullet', (data) => {
    socket.broadcast.emit('bullet', { shooterId: socket.id, ...data });
  });

  socket.on('hit', (data) => {
    const target = players[data.targetId];
    if (!target) return;
    target.hp = Math.max(0, target.hp - (data.damage || 3));
    io.to(data.targetId).emit('take_damage', {
      from: socket.id, fromUsername: players[socket.id]?.username || '?',
      damage: data.damage || 3, hp: target.hp,
    });
    io.emit('player_update', { id: data.targetId, hp: target.hp });
  });

  socket.on('leave_game', () => {
    delete players[socket.id];
    io.emit('player_left', socket.id);
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) delete players[socket.id];
    io.emit('player_left', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Space Race server sulla porta ${PORT}`));
