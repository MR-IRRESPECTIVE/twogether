import { v4 as uuidv4 } from 'uuid';
import { MAX_PHOTOS_PER_SESSION, STAGES } from '../../shared/constants.js';
import { query } from './db.js';

export class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(roomCode) {
    const now = Date.now();
    const session = {
      id: uuidv4(),
      roomCode,
      stage: STAGES.FORMAT_SELECT,
      layoutId: null,
      photoBuffer: new Map(),
      photoCount: 0,
      participantSelections: new Map(),
      participantStages: new Map(),
      publishedStrips: new Map(),
      createdAt: now,
      lastActivityAt: now
    };
    this.sessions.set(session.id, session);
    
    // Async DB save
    query(`
      INSERT INTO sessions (id, room_code, stage)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING
    `, [session.id, roomCode, session.stage]).catch(e => console.error(e));
    
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  getSessionByRoomCode(roomCode) {
    for (const session of this.sessions.values()) {
      if (session.roomCode === roomCode && session.stage !== STAGES.ENDED) {
        return session;
      }
    }
    return null;
  }

  setStage(sessionId, newStage) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.touch(sessionId);
    const validTransitions = {
      [STAGES.FORMAT_SELECT]: [STAGES.BOOTH],
      [STAGES.BOOTH]: [STAGES.SELECTION],
      [STAGES.SELECTION]: [STAGES.CUSTOMIZE],
      [STAGES.CUSTOMIZE]: [STAGES.REVEAL],
      [STAGES.REVEAL]: [STAGES.ENDED]
    };

    if (validTransitions[session.stage] && validTransitions[session.stage].includes(newStage)) {
      session.stage = newStage;
    } else {
      throw new Error(`Invalid stage transition from ${session.stage} to ${newStage}`);
    }
  }

  setLayout(sessionId, layoutId) {
    const session = this.sessions.get(sessionId);
    if (session && session.stage === STAGES.FORMAT_SELECT) {
      this.touch(sessionId);
      session.layoutId = layoutId;
    }
  }

  addPhoto(sessionId, photoUrl, metadata, storageKey) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.photoCount >= MAX_PHOTOS_PER_SESSION) {
      return null;
    }

    this.touch(sessionId);
    const photoEntry = { data: photoUrl, metadata, storageKey };
    session.photoBuffer.set(metadata.id, photoEntry);
    session.photoCount++;
    return photoEntry;
  }

  getPhotos(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    
    return Array.from(session.photoBuffer.values());
  }

  setSelection(sessionId, socketId, photoIds) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.touch(sessionId);
      session.participantSelections.set(socketId, photoIds);
    }
  }

  setParticipantStage(sessionId, socketId, stage) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.touch(sessionId);
      session.participantStages.set(socketId, stage);
    }
  }

  publishStrip(sessionId, socketId, ownerName, stripUrl, stripId, storageKey) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.touch(sessionId);
      const strip = {
        id: stripId || `strip-${socketId}-${Date.now()}`,
        ownerId: socketId,
        ownerName,
        imageData: stripUrl, // initial url
        storageKey, // raw key to generate fresh urls
        createdAt: Date.now()
      };
      session.publishedStrips.set(strip.id, strip);
      return strip;
    }
    return null;
  }

  getPublishedStrips(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.publishedStrips.values());
  }

  endSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.touch(sessionId);
      session.stage = STAGES.ENDED;
      session.photoBuffer.clear();
      // publishedStrips are kept because they are needed in "Make Another One" gallery
      session.photoCount = 0;
    }
  }

  touch(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
  }
}
