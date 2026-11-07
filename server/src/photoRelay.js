import { uploadPhoto, getSignedUrl } from './storage.js';


export function registerPhotoRelayHandlers(io, socket, sessionManager, roomManager) {
  socket.on('photo:upload', async ({ sessionId, photoData, metadata }) => {
    console.log(`[SERVER] Received photo:upload for session: ${sessionId}, metadata ID: ${metadata?.id}`);
    try {
      let session = sessionId ? sessionManager.getSession(sessionId) : null;
      if (!session) {
        const room = roomManager.getRoomBySocketId(socket.id);
        if (room && room.currentSessionId) {
          sessionId = room.currentSessionId;
          session = sessionManager.getSession(sessionId);
        }
      }
      if (!session) {
        console.warn(`[SERVER] Session not found for sessionId: ${sessionId}`);
        return;
      }
      
      let photoUrl = photoData;
      let storageKey = null;

      // Check if it's a base64 data URL
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
      } else {
        socket.emit('error', { message: 'Photo cap reached for this session' });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('photo:request-all', async ({ sessionId }) => {
    try {
      const session = sessionManager.getSession(sessionId);
      if (!session) return;
      
      const photos = sessionManager.getPhotos(sessionId);
      
      const freshPhotos = await Promise.all(photos.map(async p => {
        if (p.storageKey) {
          const freshUrl = await getSignedUrl(p.storageKey, 21600);
          return { ...p, data: freshUrl };
        }
        if (p.base64Data) {
          return { ...p, data: p.base64Data };
        }
        return p;
      }));
      
      socket.emit('photo:all', { photos: freshPhotos });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });
}
