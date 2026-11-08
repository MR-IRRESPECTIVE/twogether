import { v4 as uuidv4 } from 'uuid';
import { MAX_PHOTOS_PER_SESSION, STAGES } from '../../shared/constants.js';


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
      soloSlots: new Map(),
      participantSelections: new Map(),
      participantStages: new Map(),
      publishedStrips: new Map(),
      createdAt: now,
      lastActivityAt: now
    };
    this.sessions.set(session.id, session);

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

  addPhoto(sessionId, photoUrl, metadata, storageKey, base64Data) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Idempotent retry: if this photoId is already in buffer, update it without incrementing count
    if (metadata?.id && session.photoBuffer.has(metadata.id)) {
      this.touch(sessionId);
      const photoEntry = { data: photoUrl, base64Data, metadata, storageKey };
      session.photoBuffer.set(metadata.id, photoEntry);
      return photoEntry;
    }

    if (session.photoCount >= MAX_PHOTOS_PER_SESSION) {
      return null;
    }

    this.touch(sessionId);
    const photoEntry = { data: photoUrl, base64Data, metadata, storageKey };
    session.photoBuffer.set(metadata.id, photoEntry);
    session.photoCount++;
    return photoEntry;
  }

  addSoloPhoto(sessionId, slotIndex, revision, photoUrl, metadata, storageKey, base64Data) {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 3) {
      return { success: false, error: 'Invalid slot index: must be an integer between 0 and 3' };
    }

    if (!Number.isInteger(revision) || revision < 1) {
      return { success: false, error: 'Invalid revision: must be a positive integer' };
    }

    const photoId = metadata?.id;
    if (!photoId || typeof photoId !== 'string') {
      return { success: false, error: 'Invalid photo ID: must be a non-empty string' };
    }

    // Idempotent retry: exact same capture ID already committed
    if (session.photoBuffer.has(photoId)) {
      this.touch(sessionId);
      const existingEntry = session.photoBuffer.get(photoId);
      const slotRecord = session.soloSlots.get(slotIndex);
      return {
        success: true,
        photoEntry: existingEntry,
        slotRecord,
        superseded: null,
        isRetry: true
      };
    }

    // Check active slot revision fencing
    const activeSlot = session.soloSlots.get(slotIndex);
    if (activeSlot) {
      if (revision <= activeSlot.revision) {
        return {
          success: false,
          stale: true,
          currentRevision: activeSlot.revision,
          error: `Stale revision: incoming revision ${revision} is not greater than active revision ${activeSlot.revision}`
        };
      }
    } else {
      // Filling a previously empty slot
      if (session.photoCount >= MAX_PHOTOS_PER_SESSION) {
        return { success: false, error: 'Photo cap reached for this session' };
      }
    }

    this.touch(sessionId);
    let superseded = null;

    if (activeSlot) {
      superseded = {
        photoId: activeSlot.photoId,
        storageKey: activeSlot.storageKey,
        revision: activeSlot.revision
      };
      // Remove superseded photo from buffer so exactly the current slot photos remain
      session.photoBuffer.delete(activeSlot.photoId);
      // NOTE: Replacing an existing slot photo does NOT increment photoCount
    } else {
      session.photoCount++;
    }

    const photoEntry = { data: photoUrl, base64Data, metadata, storageKey };
    session.photoBuffer.set(photoId, photoEntry);

    const slotRecord = {
      slotIndex,
      revision,
      photoId,
      storageKey,
      metadata
    };
    session.soloSlots.set(slotIndex, slotRecord);

    return {
      success: true,
      photoEntry,
      slotRecord,
      superseded,
      isRetry: false
    };
  }

  getSoloSlot(sessionId, slotIndex) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.soloSlots.get(slotIndex) || null;
  }

  getSoloSlots(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.soloSlots.values());
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
      session.soloSlots.clear();
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
