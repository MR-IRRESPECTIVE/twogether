import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { RoomManager } from './roomManager.js';
import { SessionManager } from './sessionManager.js';
import { RateLimiter } from './utils/rateLimiter.js';
import { registerSignalingHandlers } from './signaling.js';
import { registerPhotoRelayHandlers } from './photoRelay.js';
import { startCleanupTimers } from './cleanup.js';
import { RECONNECT_GRACE_MS, STAGES } from '../../shared/constants.js';
import { initDb } from './db.js';
import { initStorage } from './storage.js';

const app = express();
// Trust Render's reverse proxy for correct client IP / protocol detection
app.set('trust proxy', 1);

// CORS — support FRONTEND_ORIGIN (preferred) or CLIENT_ORIGIN (legacy)
const allowedOriginsRaw = process.env.FRONTEND_ORIGIN || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const allowedOrigins = allowedOriginsRaw.split(',').map(o => o.trim()).filter(Boolean);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e7 // 10MB to allow large strip PNG uploads
});

const serializeRoom = (room) => {
  if (!room) return null;
  return {
    ...room,
    participants: Array.from(room.participants.values())
  };
};

const roomManager = new RoomManager();
const sessionManager = new SessionManager();
const rateLimiter = new RateLimiter();
const cleanup = startCleanupTimers(roomManager, sessionManager);

// Health check — used by Render to verify the service is alive
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

io.on('connection', (socket) => {
  const ip = socket.handshake.address;

  registerSignalingHandlers(io, socket);
  registerPhotoRelayHandlers(io, socket, sessionManager, roomManager);

  socket.on('room:create', ({ name, color, expectedCount }, callback) => {
    if (rateLimiter.isRateLimited(ip)) {
      return callback({ error: 'Too many join attempts. Please try again later.' });
    }

    try {
      const room = roomManager.createRoom(socket.id, name, color, expectedCount);
      socket.join(room.code);
      callback({ roomCode: room.code, participantId: socket.id, room: serializeRoom(room) });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  socket.on('room:join', ({ roomCode, name, color, previousId }, callback) => {
    const ip = socket.handshake.address;
    if (rateLimiter.isRateLimited(ip)) {
      return callback({ error: 'Too many join attempts. Please try again later.' });
    }

    try {
      const { room, isRejoin, oldId } = roomManager.joinRoom(roomCode, socket.id, name, color, previousId);
      socket.join(roomCode);
      const serializedRoom = serializeRoom(room);
      
      if (isRejoin) {
        socket.to(roomCode).emit('room:participant-reconnected', serializedRoom.participants.find(p => p.id === socket.id));
      } else {
        const newParticipant = serializedRoom.participants.find(p => p.id === socket.id);
        socket.to(roomCode).emit('room:participant-joined', { participant: newParticipant, room: serializedRoom });
      }
      io.to(roomCode).emit('room:update', { room: serializedRoom });
      
      let currentSession = null;
      if (room.currentSessionId) {
        currentSession = sessionManager.getSession(room.currentSessionId);
      }
      
      callback({ roomCode, participantId: socket.id, room: serializedRoom, session: currentSession });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  socket.on('room:leave', ({ roomCode }) => {
    try {
      socket.leave(roomCode);
      roomManager.leaveRoom(roomCode, socket.id);
      const room = roomManager.getRoom(roomCode);
      if (room) {
        const serializedRoom = serializeRoom(room);
        io.to(roomCode).emit('room:participant-left', { participantId: socket.id, room: serializedRoom });
        io.to(roomCode).emit('room:update', { room: serializedRoom });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('room:camera-ready', ({ roomCode, ready }) => {
    try {
      roomManager.setCameraReady(roomCode, socket.id, ready);
      const room = roomManager.getRoom(roomCode);
      if (room) {
        const serializedRoom = serializeRoom(room);
        io.to(roomCode).emit('room:camera-ready', { participantId: socket.id, ready, room: serializedRoom });
        io.to(roomCode).emit('room:update', { room: serializedRoom });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('room:filter-change', ({ roomCode, filterCss }) => {
    try {
      roomManager.setFilter(roomCode, socket.id, filterCss);
      const room = roomManager.getRoom(roomCode);
      if (room) {
        const serializedRoom = serializeRoom(room);
        io.to(roomCode).emit('room:update', { room: serializedRoom });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('session:start', ({ roomCode }) => {
    try {
      const room = roomManager.getRoom(roomCode);
      if (!room || room.hostId !== socket.id) {
        return socket.emit('error', { message: 'Only the host can perform this action' });
      }
      const session = sessionManager.createSession(roomCode);
      room.currentSessionId = session.id;
      io.to(roomCode).emit('session:stage-changed', { stage: STAGES.FORMAT_SELECT, session });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('session:set-layout', ({ roomCode, sessionId, layoutId }) => {
    try {
      const room = roomManager.getRoom(roomCode);
      if (!room || room.hostId !== socket.id) {
        return socket.emit('error', { message: 'Only the host can perform this action' });
      }
      sessionManager.setLayout(sessionId, layoutId);
      io.to(roomCode).emit('session:layout-changed', { layoutId });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('session:to-booth', ({ roomCode, sessionId }) => {
    try {
      const room = roomManager.getRoom(roomCode);
      if (!room || room.hostId !== socket.id) {
        return socket.emit('error', { message: 'Only the host can perform this action' });
      }
      sessionManager.setStage(sessionId, STAGES.BOOTH);
      io.to(roomCode).emit('session:stage-changed', { stage: STAGES.BOOTH });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('photo:trigger', ({ roomCode }) => {
    try {
      const room = roomCode ? roomManager.getRoom(roomCode) : roomManager.getRoomBySocketId(socket.id);
      if (!room) {
        return socket.emit('error', { message: 'Room not found' });
      }
      io.to(room.code).emit('countdown:start');
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('session:end-booth', ({ roomCode, sessionId }) => {
    try {
      const room = roomManager.getRoom(roomCode);
      if (!room || room.hostId !== socket.id) {
        return socket.emit('error', { message: 'Only the host can perform this action' });
      }
      sessionManager.setStage(sessionId, STAGES.SELECTION);
      io.to(roomCode).emit('session:stage-changed', { stage: STAGES.SELECTION });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('selection:confirm', ({ roomCode, sessionId, photoIds }, callback) => {
    try {
      sessionManager.setSelection(sessionId, socket.id, photoIds);
      sessionManager.setParticipantStage(sessionId, socket.id, STAGES.CUSTOMIZE);
      
      const session = sessionManager.getSession(sessionId);
      if (session && session.stage === STAGES.SELECTION) {
        try {
          sessionManager.setStage(sessionId, STAGES.CUSTOMIZE);
        } catch (e) {
          // ignore
        }
      }
      
      io.to(roomCode).emit('selection:confirmed', { participantId: socket.id, photoIds });
      if (typeof callback === 'function') {
        callback({ success: true, stage: STAGES.CUSTOMIZE });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('customize:done', ({ roomCode, sessionId }, callback) => {
    try {
      sessionManager.setParticipantStage(sessionId, socket.id, STAGES.REVEAL);
      const session = sessionManager.getSession(sessionId);
      if (session && session.stage === STAGES.CUSTOMIZE) {
        try {
          sessionManager.setStage(sessionId, STAGES.REVEAL);
        } catch (e) {
          // ignore
        }
      }
      io.to(roomCode).emit('customize:done', { participantId: socket.id });
      if (typeof callback === 'function') {
        callback({ success: true, stage: STAGES.REVEAL });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('reveal:publish-strip', async ({ roomCode, sessionId, stripData }, callback) => {
    try {
      const room = roomCode ? roomManager.getRoom(roomCode) : roomManager.getRoomBySocketId(socket.id);
      if (!room) {
        if (typeof callback === 'function') callback({ error: 'Room not found' });
        return;
      }
      const participant = room.participants.get(socket.id);
      const ownerName = participant ? participant.name : 'Unknown';
      
      let stripUrl = stripData;
      let storageKey = null;
      const stripId = `strip-${socket.id}-${Date.now()}`;

      // Check if it's a base64 data URL
      if (stripData && stripData.startsWith('data:image')) {
        const matches = stripData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const buffer = Buffer.from(matches[2], 'base64');
          const { uploadStrip, getSignedUrl } = await import('./storage.js');
          const { query } = await import('./db.js');
          
          storageKey = await uploadStrip(room.code, stripId, buffer);
          if (storageKey) {
            stripUrl = await getSignedUrl(storageKey, 3600);
            
            // Save metadata to postgres asynchronously
            query(`
              INSERT INTO strips (id, session_id, owner_id, owner_name, storage_key, expires_at)
              VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${process.env.ROOM_TTL_MINUTES || 360} minutes')
              ON CONFLICT (id) DO NOTHING
            `, [stripId, sessionId, socket.id, ownerName, storageKey]).catch(e => console.error(e));
          }
        }
      }

      const strip = sessionManager.publishStrip(sessionId, socket.id, ownerName, stripUrl, stripId);
      
      if (strip) {
        io.to(room.code).emit('reveal:new-strip', { strip });
      }
      
      if (typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('reveal:request-strips', ({ sessionId }, callback) => {
    try {
      const strips = sessionManager.getPublishedStrips(sessionId);
      if (typeof callback === 'function') {
        callback({ strips });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  socket.on('session:make-another', ({ roomCode, sessionId }) => {
    try {
      const room = roomManager.getRoom(roomCode);
      if (!room || room.hostId !== socket.id) {
      return socket.emit('error', { message: 'Only the host can perform this action' });
      }
      
      // Preserve gallery and layout for the new round
      const oldSession = sessionManager.getSession(sessionId);
      const oldStrips = oldSession ? oldSession.publishedStrips : new Map();
      const oldLayoutId = oldSession ? oldSession.layoutId : null;

      sessionManager.endSession(sessionId);
      
      const newSession = sessionManager.createSession(roomCode);
      newSession.publishedStrips = new Map(oldStrips);
      newSession.layoutId = oldLayoutId;
      room.currentSessionId = newSession.id;
      
      io.to(roomCode).emit('session:stage-changed', { 
        stage: STAGES.FORMAT_SELECT, 
        session: newSession,
        layoutId: newSession.layoutId,
        photos: [],
        mySelections: [],
        finalStripDataUrl: null,
        publishedStrips: Array.from(newSession.publishedStrips.values())
      });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    const room = roomManager.markDisconnected(socket.id);
    if (room) {
      io.to(room.code).emit('room:participant-reconnecting', { participantId: socket.id, room: serializeRoom(room) });
      
      setTimeout(() => {
        const result = roomManager.handleGraceExpiry(room.code, socket.id);
        if (result.removed) {
          const updatedRoom = roomManager.getRoom(room.code);
          if (result.hostTransferred && updatedRoom) {
            const newHost = updatedRoom.participants.get(result.newHostId);
            io.to(room.code).emit('room:host-transferred', { newHostId: result.newHostId, newHostName: newHost.name, room: serializeRoom(updatedRoom) });
          }
          if (updatedRoom) {
            io.to(room.code).emit('room:participant-left', { participantId: socket.id, room: serializeRoom(updatedRoom) });
          }
        }
      }, RECONNECT_GRACE_MS);
    }
  });
});

const PORT = process.env.PORT || 3001;

async function startServer() {
  await initDb();
  initStorage();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Twogether server running on port ${PORT}`);
    console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  });
}

startServer();
