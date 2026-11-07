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
import { initStorage } from './storage.js';
import { fetchSecureImage } from './proxySecurity.js';

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

// Image proxy endpoint to securely relay R2 / remote images with permissive CORS for canvas rendering
app.get('/api/proxy-image', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
  const imageUrl = req.query.url;
  if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
    return res.status(400).send('Invalid url parameter');
  }

  try {
    const { buffer, contentType } = await fetchSecureImage(imageUrl);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).send(err.message || 'Image proxy error');
  }
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
      socket.join(room.code);
      console.log(`[SERVER] socket ${socket.id} joined room ${room.code}. Sockets now in room:`, Array.from(io.sockets.adapter.rooms.get(room.code) || []));
      const serializedRoom = serializeRoom(room);
      
      if (isRejoin) {
        socket.to(roomCode).emit('room:participant-reconnected', serializedRoom.participants.find(p => p.id === socket.id));
      } else {
        const newParticipant = serializedRoom.participants.find(p => p.id === socket.id);
        socket.to(roomCode).emit('room:participant-joined', { participant: newParticipant, room: serializedRoom });
      }
      io.to(room.code).emit('room:update', { room: serializedRoom });
      
      let currentSession = null;
      if (room.currentSessionId) {
        currentSession = sessionManager.getSession(room.currentSessionId);
      }
      
      callback({ roomCode: room.code, participantId: socket.id, room: serializedRoom, session: currentSession });
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
        io.to(room.code).emit('room:participant-left', { participantId: socket.id, room: serializedRoom });
        io.to(room.code).emit('room:update', { room: serializedRoom });
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
        io.to(room.code).emit('room:camera-ready', { participantId: socket.id, ready, room: serializedRoom });
        io.to(room.code).emit('room:update', { room: serializedRoom });
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
        io.to(room.code).emit('room:update', { room: serializedRoom });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('session:start', ({ roomCode }) => {
    try {
      const room = roomCode ? roomManager.getRoom(roomCode) : roomManager.getRoomBySocketId(socket.id);
      if (!room || room.hostId !== socket.id) {
        return socket.emit('error', { message: 'Only the host can perform this action' });
      }
      const session = sessionManager.createSession(room.code);
      room.currentSessionId = session.id;
      const roomSockets = Array.from(io.sockets.adapter.rooms.get(room.code) || []);
      console.log(`[SERVER] session:start for room ${room.code}, session ${session.id}, sockets in room:`, roomSockets);
      io.to(room.code).emit('session:stage-changed', { stage: STAGES.FORMAT_SELECT, session });
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
      io.to(room.code).emit('session:layout-changed', { layoutId });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('session:to-booth', ({ roomCode, sessionId }) => {
    try {
      const room = roomCode ? roomManager.getRoom(roomCode) : roomManager.getRoomBySocketId(socket.id);
      if (!room || room.hostId !== socket.id) {
        return socket.emit('error', { message: 'Only the host can perform this action' });
      }
      sessionManager.setStage(sessionId, STAGES.BOOTH);
      const roomSockets = Array.from(io.sockets.adapter.rooms.get(room.code) || []);
      console.log(`[SERVER] session:to-booth for room ${room.code}, sockets in room:`, roomSockets);
      io.to(room.code).emit('session:stage-changed', { stage: STAGES.BOOTH, sessionId });
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
      io.to(room.code).emit('session:stage-changed', { stage: STAGES.SELECTION, sessionId });
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
      
      io.to(room.code).emit('selection:confirmed', { participantId: socket.id, photoIds });
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
      io.to(room.code).emit('customize:done', { participantId: socket.id });
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
          
          storageKey = await uploadStrip(room.code, stripId, buffer);
          if (storageKey) {
            const signed = await getSignedUrl(storageKey, 21600);
            if (signed) {
              stripUrl = signed;
            } else {
              storageKey = null;
            }
          }
        }
      }

      const strip = sessionManager.publishStrip(sessionId, socket.id, ownerName, stripUrl, stripId, storageKey);
      
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

  socket.on('reveal:request-strips', async ({ sessionId }, callback) => {
    try {
      const strips = sessionManager.getPublishedStrips(sessionId);
      const { getSignedUrl } = await import('./storage.js');
      
      const freshStrips = await Promise.all(strips.map(async strip => {
        if (strip.storageKey) {
          const freshUrl = await getSignedUrl(strip.storageKey, 21600);
          return { ...strip, imageData: freshUrl };
        }
        return strip;
      }));
      
      if (typeof callback === 'function') {
        callback({ strips: freshStrips });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  socket.on('session:make-another', async ({ roomCode, sessionId }) => {
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
      
      const { getSignedUrl } = await import('./storage.js');
      const freshStrips = await Promise.all(Array.from(newSession.publishedStrips.values()).map(async strip => {
        if (strip.storageKey) {
          const freshUrl = await getSignedUrl(strip.storageKey, 21600);
          return { ...strip, imageData: freshUrl };
        }
        return strip;
      }));

      io.to(room.code).emit('session:stage-changed', { 
        stage: STAGES.FORMAT_SELECT, 
        session: newSession,
        layoutId: newSession.layoutId,
        photos: [],
        mySelections: [],
        finalStripDataUrl: null,
        publishedStrips: freshStrips
      });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[SERVER] socket ${socket.id} disconnected, reason: ${reason}`);
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
  initStorage();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Twogether server running on port ${PORT}`);
    console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  });
}

startServer();
