import { uploadPhoto, getSignedUrl, deleteObject } from './storage.js';
import { ROOM_MODES } from '../../shared/constants.js';

export function registerPhotoRelayHandlers(io, socket, sessionManager, roomManager) {
  socket.on('photo:upload', async ({ sessionId, photoData, metadata }, callback) => {
    console.log(`[SERVER] Received photo:upload for session: ${sessionId}, metadata ID: ${metadata?.id}, slot: ${metadata?.slotIndex}, rev: ${metadata?.revision}`);
    try {
      let session = sessionId ? sessionManager.getSession(sessionId) : null;
      let room = roomManager.getRoomBySocketId(socket.id);

      if (!session && room && room.currentSessionId) {
        sessionId = room.currentSessionId;
        session = sessionManager.getSession(sessionId);
      }

      if (!room && session) {
        room = roomManager.getRoom(session.roomCode);
      }

      if (!session || !room || session.roomCode !== room.code) {
        console.warn(`[SERVER] Session or room not found for sessionId: ${sessionId}`);
        if (typeof callback === 'function') callback({ success: false, error: 'Session not found' });
        return;
      }

      if (!room.participants.has(socket.id)) {
        console.warn(`[SERVER] Unauthorized upload attempt by socket: ${socket.id}`);
        if (typeof callback === 'function') callback({ success: false, error: 'Unauthorized participant' });
        return socket.emit('error', { message: 'Unauthorized participant' });
      }

      const isSolo = room.mode === ROOM_MODES.SOLO;
      const hasSlotIndex = metadata?.slotIndex !== undefined;

      // Security: Group mode clients cannot submit slotted uploads
      if (!isSolo && hasSlotIndex) {
        const err = 'Slotted photo uploads are only allowed in solo mode';
        if (typeof callback === 'function') callback({ success: false, error: err });
        return socket.emit('error', { message: err });
      }

      // Solo Mode: Slotted upload with revision fencing
      if (isSolo) {
        if (!hasSlotIndex || !Number.isInteger(metadata.slotIndex) || metadata.slotIndex < 0 || metadata.slotIndex > 3) {
          const err = 'Invalid slot index: must be an integer between 0 and 3';
          if (typeof callback === 'function') callback({ success: false, error: err });
          return socket.emit('error', { message: err });
        }

        if (!Number.isInteger(metadata.revision) || metadata.revision < 1) {
          const err = 'Invalid revision: must be a positive integer';
          if (typeof callback === 'function') callback({ success: false, error: err });
          return socket.emit('error', { message: err });
        }

        if (!metadata.id || typeof metadata.id !== 'string') {
          const err = 'Invalid photo ID: must be a non-empty string';
          if (typeof callback === 'function') callback({ success: false, error: err });
          return socket.emit('error', { message: err });
        }

        // Fast-path: idempotent check if this exact capture ID is already committed
        if (session.photoBuffer.has(metadata.id)) {
          const existing = session.photoBuffer.get(metadata.id);
          if (typeof callback === 'function') {
            callback({
              success: true,
              photoId: metadata.id,
              revision: metadata.revision,
              slotIndex: metadata.slotIndex,
              photoUrl: existing.data
            });
          }
          return;
        }

        let photoUrl = photoData;
        let storageKey = null;

        // Upload new revision to its unique R2 key
        if (photoData && photoData.startsWith('data:image')) {
          const matches = photoData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const buffer = Buffer.from(matches[2], 'base64');
            storageKey = await uploadPhoto(session.roomCode, metadata.id, buffer);
            if (storageKey) {
              const signed = await getSignedUrl(storageKey, 21600);
              if (signed) {
                photoUrl = signed;
              } else {
                storageKey = null;
              }
            }
          }
        }

        // Recheck active revision immediately before committing
        const commitResult = sessionManager.addSoloPhoto(
          sessionId,
          metadata.slotIndex,
          metadata.revision,
          photoUrl,
          metadata,
          storageKey,
          storageKey ? null : photoData
        );

        if (commitResult.stale) {
          console.warn(`[SERVER] Stale upload detected for slot ${metadata.slotIndex} (incoming rev ${metadata.revision}) - cleaning up R2 object: ${storageKey}`);
          if (storageKey) {
            try {
              await deleteObject(storageKey);
            } catch (delErr) {
              console.warn('[SERVER] Failed to delete stale R2 object (non-fatal):', delErr.message);
            }
          }
          if (typeof callback === 'function') {
            callback({ success: false, stale: true, error: commitResult.error });
          }
          return;
        }

        if (!commitResult.success) {
          if (storageKey) {
            try {
              await deleteObject(storageKey);
            } catch (delErr) {
              console.warn('[SERVER] Failed to delete uncommitted R2 object (non-fatal):', delErr.message);
            }
          }
          if (typeof callback === 'function') {
            callback({ success: false, error: commitResult.error });
          }
          socket.emit('error', { message: commitResult.error });
          return;
        }

        // Successfully committed! Asynchronously delete superseded photo in R2 if one existed
        if (commitResult.superseded && commitResult.superseded.storageKey) {
          deleteObject(commitResult.superseded.storageKey).catch(delErr => {
            console.warn('[SERVER] Failed to delete superseded R2 object (non-fatal):', delErr.message);
          });
        }

        io.to(session.roomCode).emit('photo:new', {
          photoId: metadata.id,
          photoData: storageKey ? photoUrl : (photoData || commitResult.photoEntry.data),
          slotIndex: metadata.slotIndex,
          revision: metadata.revision,
          supersededPhotoId: commitResult.superseded?.photoId,
          metadata: commitResult.photoEntry.metadata
        });

        if (typeof callback === 'function') {
          callback({
            success: true,
            photoId: metadata.id,
            revision: metadata.revision,
            slotIndex: metadata.slotIndex,
            photoUrl: commitResult.photoEntry.data
          });
        }
        return;
      }

      // Group Mode: existing flat photo upload logic (unchanged)
      let photoUrl = photoData;
      let storageKey = null;

      if (photoData && photoData.startsWith('data:image')) {
        const matches = photoData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const buffer = Buffer.from(matches[2], 'base64');
          storageKey = await uploadPhoto(session.roomCode, metadata.id, buffer);
          if (storageKey) {
            const signed = await getSignedUrl(storageKey, 21600);
            if (signed) {
              photoUrl = signed;
            } else {
              storageKey = null;
            }
          }
        }
      }

      const photoEntry = sessionManager.addPhoto(sessionId, photoUrl, metadata, storageKey, storageKey ? null : photoData);
      if (photoEntry) {
        io.to(session.roomCode).emit('photo:new', {
          photoId: metadata.id,
          photoData: storageKey ? photoUrl : (photoData || photoEntry.data),
          metadata: photoEntry.metadata
        });
        if (typeof callback === 'function') {
          callback({ success: true, photoId: metadata.id, photoUrl: photoEntry.data });
        }
      } else {
        if (typeof callback === 'function') callback({ success: false, error: 'Photo cap reached for this session' });
        socket.emit('error', { message: 'Photo cap reached for this session' });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('photo:request-all', async ({ sessionId }, callback) => {
    try {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        if (typeof callback === 'function') callback({ error: 'Session not found' });
        return;
      }

      const photos = sessionManager.getPhotos(sessionId);

      const freshPhotos = await Promise.all(photos.map(async p => {
        if (p.storageKey) {
          const freshUrl = await getSignedUrl(p.storageKey, 21600);
          return { ...p, data: freshUrl || p.base64Data || p.data };
        }
        if (p.base64Data) {
          return { ...p, data: p.base64Data };
        }
        return p;
      }));

      socket.emit('photo:all', { photos: freshPhotos });
      if (typeof callback === 'function') {
        callback({ photos: freshPhotos });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
      socket.emit('error', { message: err.message });
    }
  });
}
