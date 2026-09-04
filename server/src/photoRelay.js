import { uploadPhoto, getSignedUrl } from './storage.js';
import { query } from './db.js';

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
            photoUrl = await getSignedUrl(storageKey, 3600);
            
            // Save metadata to postgres asynchronously
            query(`
              INSERT INTO photos (id, session_id, storage_key, captured_by, expires_at)
              VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${process.env.IMAGE_TTL_MINUTES || 120} minutes')
              ON CONFLICT (id) DO NOTHING
            `, [metadata.id, sessionId, storageKey, metadata.capturedBy]).catch(e => console.error(e));
          }
        }
      }

      const photoEntry = sessionManager.addPhoto(sessionId, photoUrl, metadata);
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

  socket.on('photo:request-all', ({ sessionId }) => {
    try {
      const session = sessionManager.getSession(sessionId);
      if (!session) return;
      
      const photos = sessionManager.getPhotos(sessionId);
      socket.emit('photo:all', { photos });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });
}
