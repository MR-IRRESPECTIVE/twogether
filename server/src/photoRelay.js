import { uploadPhoto, getSignedUrl } from './storage.js';


export function registerPhotoRelayHandlers(io, socket, sessionManager, roomManager) {
  socket.on('photo:upload', async ({ sessionId, photoData, metadata }) => {
    // console.log(`[SERVER] Received photo:upload for session ${sessionId}, metadata ID: ${metadata.id}`);
    try {
      const session = sessionManager.getSession(sessionId);
      if (!session) return;
      
      let photoUrl = photoData;
      let storageKey = null;

      // Check if it's a base64 data URL
      if (photoData && photoData.startsWith('data:image')) {
        const matches = photoData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const buffer = Buffer.from(matches[2], 'base64');
          storageKey = await uploadPhoto(session.roomCode, metadata.id, buffer);
          if (storageKey) {
            photoUrl = await getSignedUrl(storageKey, 21600);
          }
        }
      }

      const photoEntry = sessionManager.addPhoto(sessionId, photoUrl, metadata, storageKey);
      if (photoEntry) {
        io.to(session.roomCode).emit('photo:new', {
          photoId: metadata.id,
          photoData: photoEntry.data,
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
        return p;
      }));
      
      socket.emit('photo:all', { photos: freshPhotos });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });
}
