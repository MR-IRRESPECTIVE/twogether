import { SESSION_TTL_MS, ROOM_INACTIVITY_TTL_MS, SESSION_CLEANUP_INTERVAL_MS, ROOM_CLEANUP_INTERVAL_MS } from '../../shared/constants.js';
import { deleteRoomObjects, deleteObject } from './storage.js';

export function startCleanupTimers(roomManager, sessionManager) {
  const sessionInterval = setInterval(async () => {
    const now = Date.now();
    for (const [sessionId, session] of sessionManager.sessions.entries()) {
      if (now - session.lastActivityAt > SESSION_TTL_MS) {
        
        // Before clearing session, delete its photos from S3 (keep strips)
        try {
          const photos = sessionManager.getPhotos(sessionId);
          for (const photo of photos) {
            if (photo.storageKey) await deleteObject(photo.storageKey);
          }
        } catch (e) {
          console.error(`S3 cleanup failed for session ${sessionId}`, e);
        }

        sessionManager.endSession(sessionId);
        sessionManager.deleteSession(sessionId);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);

  const roomInterval = setInterval(async () => {
    const now = Date.now();
    for (const [roomCode, room] of roomManager.rooms.entries()) {
      let allDisconnected = true;
      for (const participant of room.participants.values()) {
        if (participant.connected) {
          allDisconnected = false;
          break;
        }
      }

      if (allDisconnected && now - room.lastActivityAt > ROOM_INACTIVITY_TTL_MS) {
        try {
          // Delete all S3 objects under the room (photos and strips)
          await deleteRoomObjects(roomCode);
        } catch (e) {
          console.error(`S3 cleanup failed for room ${roomCode}`, e);
        }

        if (room.currentSessionId) {
          sessionManager.deleteSession(room.currentSessionId);
        }
        roomManager.deleteRoom(roomCode);
      }
    }
  }, ROOM_CLEANUP_INTERVAL_MS);

  return {
    stopAll: () => {
      clearInterval(sessionInterval);
      clearInterval(roomInterval);
    }
  };
}
