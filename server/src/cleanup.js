import { SESSION_TTL_MS, ROOM_INACTIVITY_TTL_MS, SESSION_CLEANUP_INTERVAL_MS, ROOM_CLEANUP_INTERVAL_MS } from '../../shared/constants.js';
import { query } from './db.js';
import { deleteRoomObjects, deleteObject } from './storage.js';

export function startCleanupTimers(roomManager, sessionManager) {
  const sessionInterval = setInterval(async () => {
    const now = Date.now();
    for (const [sessionId, session] of sessionManager.sessions.entries()) {
      if (now - session.lastActivityAt > SESSION_TTL_MS) {
        
        // Before clearing session, delete its photos from S3 (keep strips)
        try {
          const res = await query('SELECT storage_key FROM photos WHERE session_id = $1', [sessionId]);
          if (res && res.rows) {
            for (const row of res.rows) {
              if (row.storage_key) await deleteObject(row.storage_key);
            }
          }
          await query('DELETE FROM sessions WHERE id = $1', [sessionId]); // cascades to photos & strips in DB
        } catch (e) {
          console.error(`DB/S3 cleanup failed for session ${sessionId}`, e);
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
          
          // Delete room from DB (cascades to sessions, photos, strips)
          await query('DELETE FROM rooms WHERE code = $1', [roomCode]);
        } catch (e) {
          console.error(`DB/S3 cleanup failed for room ${roomCode}`, e);
        }

        if (room.currentSessionId) {
          sessionManager.deleteSession(room.currentSessionId);
        }
        roomManager.deleteRoom(roomCode);
      }
    }
    
    // Safety net: orphaned DB cleanup
    try {
      await query(`DELETE FROM rooms WHERE expires_at < NOW()`);
      await query(`DELETE FROM photos WHERE expires_at < NOW()`);
      await query(`DELETE FROM strips WHERE expires_at < NOW()`);
    } catch (e) {
      // ignore
    }
    
  }, ROOM_CLEANUP_INTERVAL_MS);

  return {
    stopAll: () => {
      clearInterval(sessionInterval);
      clearInterval(roomInterval);
    }
  };
}
