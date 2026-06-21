const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

let io;

// Track voice rooms: { channelId: { userId: { socketId, muted, deafened, videoOn, name, photo } } }
const voiceRooms = {};

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token diperlukan'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userName = decoded.namaLengkap || '';
      socket.userPhoto = socket.handshake.auth?.photo || null;
      next();
    } catch {
      next(new Error('Token tidak valid'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);

    // ── Channel text room ─────────────────────────────────────────────────────
    socket.on('ch:join', ({ channelId }) => {
      if (channelId) socket.join(`ch:${channelId}`);
    });
    socket.on('ch:leave', ({ channelId }) => {
      if (channelId) socket.leave(`ch:${channelId}`);
    });

    // ── Task chat room ────────────────────────────────────────────────────────
    socket.on('task:join', ({ taskId }) => {
      if (taskId) socket.join(`task:${taskId}`);
    });
    socket.on('task:leave', ({ taskId }) => {
      if (taskId) socket.leave(`task:${taskId}`);
    });

    // ── Voice: join room ──────────────────────────────────────────────────────
    socket.on('voice:join', ({ channelId, name, photo }) => {
      if (!channelId) return;

      // Tinggalkan voice room sebelumnya jika ada
      leaveAllVoiceRooms(socket);

      socket.voiceChannel = channelId;
      socket.join(`voice:${channelId}`);

      if (!voiceRooms[channelId]) voiceRooms[channelId] = {};
      voiceRooms[channelId][socket.userId] = {
        socketId: socket.id,
        muted: false, deafened: false, videoOn: false,
        name: name || socket.userName,
        photo: photo || socket.userPhoto,
        userId: socket.userId,
      };

      // Kirim daftar peserta yang sudah ada ke user baru
      socket.emit('voice:participants', getParticipants(channelId));

      // Beritahu peserta lain ada yang join
      socket.to(`voice:${channelId}`).emit('voice:user-joined', {
        userId: socket.userId, socketId: socket.id,
        name: name || socket.userName, photo: photo || socket.userPhoto,
        muted: false, deafened: false, videoOn: false,
      });

      // Broadcast presence ke semua (agar yang belum join pun lihat isi voice)
      broadcastPresence(channelId);
    });

    // ── Voice: peek — lihat siapa di voice tanpa join ─────────────────────────
    socket.on('voice:peek', ({ channelId }) => {
      if (!channelId) return;
      socket.emit('voice:presence', { channelId, participants: getParticipants(channelId) });
    });

    // ── Voice: leave room ────────────────────────────────────────────────────
    socket.on('voice:leave', () => leaveAllVoiceRooms(socket));

    // ── Voice: WebRTC signaling ───────────────────────────────────────────────
    socket.on('voice:offer', ({ targetSocketId, offer }) => {
      io.to(targetSocketId).emit('voice:offer', {
        fromSocketId: socket.id,
        fromUserId: socket.userId,
        offer,
      });
    });

    socket.on('voice:answer', ({ targetSocketId, answer }) => {
      io.to(targetSocketId).emit('voice:answer', {
        fromSocketId: socket.id,
        answer,
      });
    });

    socket.on('voice:ice', ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit('voice:ice', {
        fromSocketId: socket.id,
        candidate,
      });
    });

    // ── Voice: speaking indicator ─────────────────────────────────────────────
    socket.on('voice:speaking', ({ speaking }) => {
      const channelId = socket.voiceChannel;
      if (!channelId) return;
      socket.to(`voice:${channelId}`).emit('voice:speaking', {
        userId: socket.userId, speaking: !!speaking,
      });
    });

    // ── Voice: status update (mute/deafen/video) ──────────────────────────────
    socket.on('voice:status', ({ muted, deafened, videoOn }) => {
      const channelId = socket.voiceChannel;
      if (!channelId || !voiceRooms[channelId]?.[socket.userId]) return;

      const p = voiceRooms[channelId][socket.userId];
      if (muted     !== undefined) p.muted     = muted;
      if (deafened  !== undefined) p.deafened  = deafened;
      if (videoOn   !== undefined) p.videoOn   = videoOn;

      io.to(`voice:${channelId}`).emit('voice:user-status', {
        userId: socket.userId, muted: p.muted, deafened: p.deafened, videoOn: p.videoOn,
      });

      broadcastPresence(channelId);
    });

    socket.on('disconnect', () => {
      leaveAllVoiceRooms(socket);
    });
  });

  return io;
}

function leaveAllVoiceRooms(socket) {
  const channelId = socket.voiceChannel;
  if (!channelId) return;

  socket.leave(`voice:${channelId}`);
  if (voiceRooms[channelId]) {
    delete voiceRooms[channelId][socket.userId];
    if (!Object.keys(voiceRooms[channelId]).length) delete voiceRooms[channelId];
  }

  socket.to(`voice:${channelId}`).emit('voice:user-left', {
    userId: socket.userId, socketId: socket.id,
  });
  socket.voiceChannel = null;

  broadcastPresence(channelId);
}

function getParticipants(channelId) {
  return Object.values(voiceRooms[channelId] || {});
}

// Broadcast daftar peserta voice ke SEMUA client (termasuk yang belum join),
// agar roster "siapa di voice" terlihat sebelum masuk.
function broadcastPresence(channelId) {
  if (io) io.emit('voice:presence', { channelId, participants: getParticipants(channelId) });
}

function emitToUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

function getIO() { return io; }

module.exports = { initSocket, emitToUser, getIO };
