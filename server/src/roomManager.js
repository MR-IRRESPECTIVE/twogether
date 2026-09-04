import { generateRoomCode } from './utils/roomCode.js';
import { query } from './db.js';

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(socketId, name, color, expectedCount) {
    const existingCodes = this.getAllRoomCodes();
    const code = generateRoomCode(existingCodes);
    const now = Date.now();

    const participant = {
      id: socketId,
      name,
      color,
      filter: 'none',
      cameraReady: false,
      connected: true,
      disconnectedAt: null,
      joinedAt: now
    };

    const participants = new Map();
    participants.set(socketId, participant);

    const room = {
      code,
      hostId: socketId,
      participants,
      expectedCount,
      currentSessionId: null,
      createdAt: now,
      lastActivityAt: now
    };

    this.rooms.set(code, room);

    // Save to DB asynchronously
    query(`
      INSERT INTO rooms (code, host_id, expected_count, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '${process.env.ROOM_TTL_MINUTES || 360} minutes')
      ON CONFLICT (code) DO NOTHING
    `, [code, socketId, expectedCount]).catch(e => console.error(e));

    return room;
  }

  joinRoom(roomCode, socketId, name, color, previousId) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new Error('Room not found');
    }

    // Handle Reconnection
    if (previousId && room.participants.has(previousId)) {
      const participant = room.participants.get(previousId);
      
      // Update participant with new socket ID
      participant.id = socketId;
      participant.connected = true;
      participant.disconnectedAt = null;
      if (name) participant.name = name;
      if (color) participant.color = color;
      
      // Re-key in map
      room.participants.delete(previousId);
      room.participants.set(socketId, participant);

      // Update host if needed
      if (room.hostId === previousId) {
        room.hostId = socketId;
      }
      
      this.touch(roomCode);
      return { room, isRejoin: true, oldId: previousId };
    }
    
    if (room.participants.size >= room.expectedCount) {
      throw new Error('Room is full');
    }
    
    if (room.currentSessionId) {
      throw new Error('Cannot join room, game has already started');
    }

    this.touch(roomCode);

    const participant = {
      id: socketId,
      name,
      color,
      filter: 'none',
      cameraReady: false,
      connected: true,
      disconnectedAt: null,
      joinedAt: Date.now()
    };

    room.participants.set(socketId, participant);
    return { room, isRejoin: false };
  }

  leaveRoom(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    if (room) {
      this.touch(roomCode);
      room.participants.delete(socketId);
      
      if (room.participants.size === 0) {
        this.deleteRoom(roomCode);
      } else if (room.hostId === socketId) {
        // Transfer host if host leaves actively
        let earliest = null;
        for (const p of room.participants.values()) {
          if (!earliest || p.joinedAt < earliest.joinedAt) {
            earliest = p;
          }
        }
        if (earliest) {
          room.hostId = earliest.id;
        }
      }
    }
  }

  markDisconnected(socketId) {
    const room = this.getRoomBySocketId(socketId);
    if (room) {
      this.touch(room.code);
      const participant = room.participants.get(socketId);
      if (participant) {
        participant.connected = false;
        participant.disconnectedAt = Date.now();
      }
      return room;
    }
    return null;
  }

  reconnect(roomCode, socketId, name, color) {
    const room = this.rooms.get(roomCode);
    if (room) {
      this.touch(roomCode);
      const participant = room.participants.get(socketId);
      if (participant) {
        participant.connected = true;
        participant.disconnectedAt = null;
        if (name) participant.name = name;
        if (color) participant.color = color;
      }
    }
  }

  handleGraceExpiry(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) return { removed: false, hostTransferred: false };

    const participant = room.participants.get(socketId);
    if (!participant || participant.connected) {
      return { removed: false, hostTransferred: false }; // reconnected or not found
    }

    this.touch(roomCode);
    room.participants.delete(socketId);
    let hostTransferred = false;
    let newHostId = undefined;

    if (room.participants.size === 0) {
      this.deleteRoom(roomCode);
    } else if (room.hostId === socketId) {
      let earliest = null;
      for (const p of room.participants.values()) {
        if (!earliest || p.joinedAt < earliest.joinedAt) {
          earliest = p;
        }
      }
      if (earliest) {
        room.hostId = earliest.id;
        newHostId = earliest.id;
        hostTransferred = true;
      }
    }

    return { removed: true, hostTransferred, newHostId };
  }

  setCameraReady(roomCode, socketId, ready) {
    const room = this.rooms.get(roomCode);
    if (room) {
      this.touch(roomCode);
      const participant = room.participants.get(socketId);
      if (participant) {
        participant.cameraReady = ready;
      }
    }
  }

  setFilter(roomCode, socketId, filterCss) {
    const room = this.rooms.get(roomCode);
    if (room) {
      this.touch(roomCode);
      const participant = room.participants.get(socketId);
      if (participant) {
        participant.filter = filterCss;
      }
    }
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode) || null;
  }

  getRoomBySocketId(socketId) {
    for (const room of this.rooms.values()) {
      if (room.participants.has(socketId)) {
        return room;
      }
    }
    return null;
  }

  isHost(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    return room ? room.hostId === socketId : false;
  }

  getAllRoomCodes() {
    return new Set(this.rooms.keys());
  }

  deleteRoom(roomCode) {
    this.rooms.delete(roomCode);
  }

  touch(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.lastActivityAt = Date.now();
    }
  }
}
