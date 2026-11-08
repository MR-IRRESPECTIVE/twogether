import { createServer } from 'http';
import { Server } from './server/node_modules/socket.io/dist/index.js';
import { io as ClientIO } from './client/node_modules/socket.io-client/build/esm/index.js';
import express from './server/node_modules/express/index.js';
import { RoomManager } from './server/src/roomManager.js';
import { SessionManager } from './server/src/sessionManager.js';
import { RateLimiter } from './server/src/utils/rateLimiter.js';
import { ROOM_MODES, MIN_PARTICIPANTS, MAX_PARTICIPANTS, STAGES } from './shared/constants.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("=== Twogether Solo Photobooth (Phase 1) Integration Tests ===");

  // Setup test server
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const roomManager = new RoomManager();
  const sessionManager = new SessionManager();
  const rateLimiter = new RateLimiter();

  const serializeRoom = (room) => {
    if (!room) return null;
    return {
      ...room,
      participants: Array.from(room.participants.values())
    };
  };

  io.on('connection', (socket) => {
    socket.on('room:create', ({ name, color, expectedCount, mode }, callback) => {
      try {
        const room = roomManager.createRoom(socket.id, name, color, expectedCount, mode);
        socket.join(room.code);
        callback({ roomCode: room.code, participantId: socket.id, room: serializeRoom(room) });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('room:join', ({ roomCode, name, color, previousId }, callback) => {
      try {
        const { room, isRejoin, oldId } = roomManager.joinRoom(roomCode, socket.id, name, color, previousId);
        socket.join(room.code);
        const serializedRoom = serializeRoom(room);
        let currentSession = null;
        if (room.currentSessionId) {
          currentSession = sessionManager.getSession(room.currentSessionId);
        }
        callback({ roomCode: room.code, participantId: socket.id, room: serializedRoom, session: currentSession, isRejoin });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('session:start', ({ roomCode }, callback) => {
      try {
        const room = roomCode ? roomManager.getRoom(roomCode) : roomManager.getRoomBySocketId(socket.id);
        if (!room || room.hostId !== socket.id) {
          const errorMsg = 'Only the host can perform this action';
          if (typeof callback === 'function') callback({ error: errorMsg });
          return socket.emit('error', { message: errorMsg });
        }
        const session = sessionManager.createSession(room.code);
        room.currentSessionId = session.id;
        io.to(room.code).emit('session:stage-changed', { stage: STAGES.FORMAT_SELECT, session });
        if (typeof callback === 'function') {
          callback({ success: true, sessionId: session.id, stage: STAGES.FORMAT_SELECT, session });
        }
      } catch (err) {
        if (typeof callback === 'function') callback({ error: err.message });
        socket.emit('error', { message: err.message });
      }
    });
  });

  await new Promise(resolve => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;

  const createClient = () => {
    return new Promise((resolve) => {
      const client = ClientIO(serverUrl, { reconnection: false });
      client.on('connect', () => resolve(client));
    });
  };

  try {
    // TEST 1: Solo Room Creation
    console.log("\n--- TEST 1: Solo Room Creation ---");
    const client1 = await createClient();
    let soloRoomCode = null;
    let soloSessionId = null;

    await new Promise((resolve) => {
      client1.emit('room:create', { name: 'SoloTester', color: '#F2665E', mode: ROOM_MODES.SOLO }, (res) => {
        assert(!res.error, 'Solo room creation succeeded without error');
        assert(res.room.mode === 'solo', 'Room mode is explicitly "solo"');
        assert(res.room.expectedCount === 1, 'Solo room expectedCount is forced to 1');
        assert(res.room.participants.length === 1, 'Only 1 participant in solo room');
        assert(res.roomCode.length === 6, 'Generated 6-letter room code');
        soloRoomCode = res.roomCode;
        resolve();
      });
    });

    // TEST 2: Solo Session Start Flow
    console.log("\n--- TEST 2: Solo Session Start Flow ---");
    await new Promise((resolve) => {
      client1.emit('session:start', { roomCode: soloRoomCode }, (res) => {
        assert(!res.error, 'session:start acknowledged successfully');
        assert(res.success === true, 'Response reports success: true');
        assert(res.stage === STAGES.FORMAT_SELECT, 'Session stage set to FORMAT_SELECT');
        assert(!!res.sessionId, 'Session ID returned');
        soloSessionId = res.sessionId;
        resolve();
      });
    });

    // TEST 3: Solo Room Rejection of Additional Participants
    console.log("\n--- TEST 3: Solo Room Rejection of Additional Participants ---");
    const client2 = await createClient();
    await new Promise((resolve) => {
      client2.emit('room:join', { roomCode: soloRoomCode, name: 'Intruder', color: '#7B9EC4' }, (res) => {
        assert(!!res.error, 'Additional participant was rejected from solo room');
        assert(res.error.includes('Solo rooms do not allow additional participants'), 'Error specifically identifies solo room restriction');
        resolve();
      });
    });

    // TEST 4: Solo Room Refresh / Reconnection
    console.log("\n--- TEST 4: Solo Room Refresh / Reconnection ---");
    const oldSocketId = client1.id;
    client1.disconnect();

    const client1Rejoin = await createClient();
    await new Promise((resolve) => {
      client1Rejoin.emit('room:join', { roomCode: soloRoomCode, name: 'SoloTester', color: '#F2665E', previousId: oldSocketId }, (res) => {
        assert(!res.error, 'Solo participant reconnected successfully');
        assert(res.isRejoin === true, 'Server identified reconnection');
        assert(res.room.mode === 'solo', 'Room mode retained as "solo"');
        assert(res.room.participants.length === 1, 'Still exactly 1 participant in room');
        assert(res.session && res.session.id === soloSessionId, 'Recovered active session correctly');
        assert(res.session && res.session.stage === STAGES.FORMAT_SELECT, 'Recovered FORMAT_SELECT stage');
        resolve();
      });
    });
    client1Rejoin.disconnect();
    client2.disconnect();

    // TEST 5: Group Room Creation with 2, 3, and 4 Participants
    console.log("\n--- TEST 5: Group Room Creation with 2, 3, and 4 Participants ---");
    for (const count of [2, 3, 4]) {
      const gClient = await createClient();
      await new Promise((resolve) => {
        gClient.emit('room:create', { name: `Host${count}`, color: '#6BCB77', expectedCount: count, mode: ROOM_MODES.GROUP }, (res) => {
          assert(!res.error, `Group room creation with expectedCount=${count} succeeded`);
          assert(res.room.mode === 'group', `Room mode is "group" for expectedCount=${count}`);
          assert(res.room.expectedCount === count, `expectedCount correctly stored as ${count}`);
          resolve();
        });
      });
      gClient.disconnect();
    }

    // TEST 6: Group Room Creation Default Mode
    console.log("\n--- TEST 6: Group Room Default Mode when Unspecified ---");
    const defClient = await createClient();
    await new Promise((resolve) => {
      defClient.emit('room:create', { name: 'DefaultHost', color: '#FFD93D', expectedCount: 3 }, (res) => {
        assert(!res.error, 'Room creation without explicit mode succeeded');
        assert(res.room.mode === 'group', 'Room mode defaults to "group"');
        assert(res.room.expectedCount === 3, 'expectedCount correctly set to 3');
        resolve();
      });
    });
    defClient.disconnect();

    // TEST 7: Group Room Creation with Invalid Participant Counts
    console.log("\n--- TEST 7: Group Room Creation with Invalid Participant Counts ---");
    const invCounts = [1, 5, 0, -1, 10, 'invalid'];
    for (const inv of invCounts) {
      const invClient = await createClient();
      await new Promise((resolve) => {
        invClient.emit('room:create', { name: 'BadHost', color: '#C77DFF', expectedCount: inv, mode: ROOM_MODES.GROUP }, (res) => {
          assert(!!res.error, `Group room creation with invalid expectedCount=${inv} was rejected`);
          assert(res.error.includes('must be an integer between 2 and 4'), `Error message correctly specifies boundaries for expectedCount=${inv}`);
          resolve();
        });
      });
      invClient.disconnect();
    }

    // TEST 8: Invalid Room Mode Rejection
    console.log("\n--- TEST 8: Invalid Room Mode Rejection ---");
    const invModeClient = await createClient();
    await new Promise((resolve) => {
      invModeClient.emit('room:create', { name: 'BadModeHost', color: '#FF8FA3', expectedCount: 2, mode: 'party' }, (res) => {
        assert(!!res.error, 'Room creation with mode="party" was rejected');
        assert(res.error.includes('Invalid room mode'), 'Error message specifically identifies invalid room mode');
        resolve();
      });
    });
    invModeClient.disconnect();

  } finally {
    httpServer.close();
  }

  console.log(`\n========================================`);
  console.log(`Phase 1 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
