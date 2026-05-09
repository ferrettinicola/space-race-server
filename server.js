const express  = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const players    = {};
const loginLog   = [];

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

// CORS — permette fetch dal browser (Netlify → Railway)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', online: Object.keys(players).length });
});

// Chi è online adesso
app.get('/admin/online', (req, res) => {
  res.json(Object.values(players).map(p => p.username));
});

// Storico accessi
app.get('/admin/logins', (req, res) => {
  res.json(loginLog);
});

io.on('connection', (socket) => {
  const ip = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim()
             || socket.handshake.address;
  const ua = socket.handshake.headers['user-agent'] || '';

  socket.on('login_event', (data) => {
    const entry = {
      username:  data.username,
      timestamp: new Date().toISOString(),
      ip, browser: parseBrowser(ua), os: parseOS(ua),
    };
    loginLog.push(entry);
    if (loginLog.length > 500) loginLog.shift();
    console.log(`[login] ${entry.username} — ${entry.browser} su ${entry.os}`);
  });

  socket.on('join', (data) => {
    players[socket.id] = {
      id: socket.id, username: data.username, skin: data.skin,
      x: data.x, y: data.y, angle: data.angle, hp: data.hp, score: 0,
    };
    socket.emit('players', players);
    socket.broadcast.emit('player_joined', players[socket.id]);
    console.log(`[+] ${data.username} in partita. Online: ${Object.keys(players).length}`);
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
    if (players[socket.id]) {
      console.log(`[-] ${players[socket.id].username} uscito`);
      delete players[socket.id];
    }
    io.emit('player_left', socket.id);
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      console.log(`[-] ${players[socket.id].username} disconnesso`);
      delete players[socket.id];
    }
    io.emit('player_left', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Space Race server sulla porta ${PORT}`));
