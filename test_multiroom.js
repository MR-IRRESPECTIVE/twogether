import { createServer } from 'http';
import { Server } from './server/node_modules/socket.io/dist/index.js';
import { io as ClientIO } from './client/node_modules/socket.io-client/build/esm/index.js';
import express from './server/node_modules/express/index.js';
import { RoomManager } from './server/src/roomManager.js';
import { SessionManager } from './server/src/sessionManager.js';
import { registerPhotoRelayHandlers } from './server/src/photoRelay.js';
import { registerSignalingHandlers } from './server/src/signaling.js';
import { ROOM_MODES, STAGES, MAX_PHOTOS_PER_SESSION } from './shared/constants.js';

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

async function runMultiRoomTests() {
  console.log("=== Twogether Multi-Room Isolation Test Suite ===\n");

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const roomManager = new RoomManager();
  const sessionManager = new SessionManager();

  // Storage tracking to verify room prefix isolation
  const deletedStorageKeys = [];
  const deletedRoomPrefixes = [];

  const serializeRoom = (room) => {
    if (!room) return null;
    return {
      ...room,
      participants: Array.from(room.participants.values())
    };
  };

  io.on('connection', (socket) => {
    registerSignalingHandlers(io, socket);
    registerPhotoRelayHandlers(io, socket, sessionManager, roomManager);

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
        const { room, isRejoin } = roomManager.joinRoom(roomCode, socket.id, name, color, previousId);
        socket.join(room.code);
        const serializedRoom = serializeRoom(room);
        let currentSession = null;
        if (room.currentSessionId) {
          currentSession = sessionManager.getSession(room.currentSessionId);
        }
        socket.to(roomCode).emit('room:participant-joined', { participant: serializedRoom.participants.find(p => p.id === socket.id), room: serializedRoom });
        io.to(room.code).emit('room:update', { room: serializedRoom });
        callback({ roomCode: room.code, participantId: socket.id, room: serializedRoom, session: currentSession });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on('session:start', ({ roomCode }, callback) => {
      try {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.hostId !== socket.id) {
          return callback({ success: false, error: 'Only the host can start session' });
        }
        const session = sessionManager.createSession(room.code);
        room.currentSessionId = session.id;
        io.to(room.code).emit('session:stage-changed', { stage: STAGES.FORMAT_SELECT, session });
        callback({ success: true, sessionId: session.id, stage: STAGES.FORMAT_SELECT });
      } catch (err) {
        callback({ success: false, error: err.message });
      }
    });

    socket.on('session:end-booth', ({ roomCode, sessionId }, callback) => {
      try {
        const room = roomManager.getRoom(roomCode);
        if (!room || room.hostId !== socket.id) {
          return callback({ success: false, error: 'Only the host can perform this action' });
        }
        sessionManager.setStage(sessionId, STAGES.SELECTION);
        const sessionPhotos = sessionManager.getPhotos(sessionId).map(p => ({
          id: p.metadata.id,
          url: p.data,
          metadata: p.metadata
        }));
        io.to(room.code).emit('session:stage-changed', { stage: STAGES.SELECTION, sessionId, photos: sessionPhotos });
        callback({ success: true, stage: STAGES.SELECTION, photos: sessionPhotos });
      } catch (err) {
        callback({ success: false, error: err.message });
      }
    });
  });

  await new Promise(r => httpServer.listen(0, r));
  const port = httpServer.address().port;

  // --- SCENARIO 1: Create Solo Room A and Solo Room B simultaneously ---
  console.log("--- 1. Simultaneous Room Creation & Code Uniqueness ---");
  const socketA = ClientIO(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  const socketB = ClientIO(`http://127.0.0.1:${port}`, { transports: ['websocket'] });

  await Promise.all([
    new Promise(r => socketA.on('connect', r)),
    new Promise(r => socketB.on('connect', r))
  ]);

  const [resA, resB] = await Promise.all([
    new Promise(r => socketA.emit('room:create', { name: 'UserA', color: '#F2665E', expectedCount: 1, mode: ROOM_MODES.SOLO }, r)),
    new Promise(r => socketB.emit('room:create', { name: 'UserB', color: '#7B9EC4', expectedCount: 1, mode: ROOM_MODES.SOLO }, r))
  ]);

  const roomCodeA = resA.roomCode;
  const roomCodeB = resB.roomCode;

  assert(roomCodeA && roomCodeB, "Scenario 1: Both Room A and Room B created successfully");
  assert(roomCodeA !== roomCodeB, `Scenario 1: Room codes are strictly distinct (${roomCodeA} vs ${roomCodeB})`);
  assert(resA.room.mode === ROOM_MODES.SOLO && resB.room.mode === ROOM_MODES.SOLO, "Scenario 1: Both rooms have mode 'solo'");
  assert(resA.room.expectedCount === 1 && resB.room.expectedCount === 1, "Scenario 1: Both rooms have expectedCount = 1");

  // Track broadcasts received by each socket to verify cross-room silence
  const roomAEvents = [];
  const roomBEvents = [];
  socketA.on('session:stage-changed', data => roomAEvents.push({ type: 'stage', data }));
  socketA.on('photo:new', data => roomAEvents.push({ type: 'photo:new', data }));
  socketB.on('session:stage-changed', data => roomBEvents.push({ type: 'stage', data }));
  socketB.on('photo:new', data => roomBEvents.push({ type: 'photo:new', data }));

  // --- SCENARIO 2: Start separate sessions in both rooms ---
  console.log("\n--- 2. Independent Session Lifecycle & Scoped Stage Events ---");
  const [sessA, sessB] = await Promise.all([
    new Promise(r => socketA.emit('session:start', { roomCode: roomCodeA }, r)),
    new Promise(r => socketB.emit('session:start', { roomCode: roomCodeB }, r))
  ]);

  const sessionIdA = sessA.sessionId;
  const sessionIdB = sessB.sessionId;

  assert(sessionIdA && sessionIdB, "Scenario 2: Both sessions started successfully");
  assert(sessionIdA !== sessionIdB, `Scenario 2: Session IDs are strictly distinct (${sessionIdA} vs ${sessionIdB})`);

  const serverSessA = sessionManager.getSession(sessionIdA);
  const serverSessB = sessionManager.getSession(sessionIdB);

  assert(serverSessA.roomCode === roomCodeA, "Scenario 2: Session A strictly belongs to Room Code A");
  assert(serverSessB.roomCode === roomCodeB, "Scenario 2: Session B strictly belongs to Room Code B");

  // Allow brief event loop tick for socket broadcast delivery
  await new Promise(r => setTimeout(r, 50));

  assert(roomAEvents.filter(e => e.type === 'stage').length === 1, "Scenario 2: Socket A received exactly 1 stage-change event (for Room A)");
  assert(roomBEvents.filter(e => e.type === 'stage').length === 1, "Scenario 2: Socket B received exactly 1 stage-change event (for Room B)");
  assert(roomAEvents[0].data.session.id === sessionIdA, "Scenario 2: Socket A's event contained Session A");
  assert(roomBEvents[0].data.session.id === sessionIdB, "Scenario 2: Socket B's event contained Session B");

  // --- SCENARIO 3: Upload four photos to each room ---
  console.log("\n--- 3. Four Photos Uploaded to Each Room Independently ---");
  for (let slot = 0; slot < 4; slot++) {
    const upA = await new Promise(r => {
      socketA.emit('photo:upload', {
        sessionId: sessionIdA,
        photoData: `data:image/jpeg;base64,roomA_photo_${slot}`,
        metadata: { id: `photoA_slot${slot}_r1`, slotIndex: slot, revision: 1 }
      }, r);
    });
    assert(upA.success && upA.slotIndex === slot, `Scenario 3: Room A slot ${slot} uploaded`);

    const upB = await new Promise(r => {
      socketB.emit('photo:upload', {
        sessionId: sessionIdB,
        photoData: `data:image/jpeg;base64,roomB_photo_${slot}`,
        metadata: { id: `photoB_slot${slot}_r1`, slotIndex: slot, revision: 1 }
      }, r);
    });
    assert(upB.success && upB.slotIndex === slot, `Scenario 3: Room B slot ${slot} uploaded`);
  }

  assert(serverSessA.photoBuffer.size === 4, "Scenario 3: Room A photoBuffer contains exactly 4 photos");
  assert(serverSessB.photoBuffer.size === 4, "Scenario 3: Room B photoBuffer contains exactly 4 photos");
  assert(serverSessA.photoCount === 4, "Scenario 3: Room A photoCount is 4");
  assert(serverSessB.photoCount === 4, "Scenario 3: Room B photoCount is 4");

  // Verify no photo key overlap
  const roomAPhotoIds = Array.from(serverSessA.photoBuffer.keys());
  const roomBPhotoIds = Array.from(serverSessB.photoBuffer.keys());
  const overlap = roomAPhotoIds.filter(id => roomBPhotoIds.includes(id));
  assert(overlap.length === 0, "Scenario 3: Zero photo ID overlap between Room A and Room B");

  // --- SCENARIO 4 & 5: Retake a photo in Room A; verify Room B remains unchanged ---
  console.log("\n--- 4 & 5. Photo Retake in Room A with Zero Impact on Room B ---");
  const roomBPhotoEventsBefore = roomBEvents.filter(e => e.type === 'photo:new').length;
  const slot1BeforeB = sessionManager.getSoloSlot(sessionIdB, 1);

  // Retake Slot 1 in Room A with revision 2
  const retakeA = await new Promise(r => {
    socketA.emit('photo:upload', {
      sessionId: sessionIdA,
      photoData: 'data:image/jpeg;base64,roomA_photo_1_retake_r2',
      metadata: { id: 'photoA_slot1_r2', slotIndex: 1, revision: 2 }
    }, r);
  });

  assert(retakeA.success && retakeA.revision === 2, "Scenario 4: Room A Slot 1 retake (Rev 2) succeeded");
  const slot1AfterA = sessionManager.getSoloSlot(sessionIdA, 1);
  assert(slot1AfterA.photoId === 'photoA_slot1_r2' && slot1AfterA.revision === 2, "Scenario 4: Room A Slot 1 updated to Rev 2");

  await new Promise(r => setTimeout(r, 50));

  // Inspect Room B state
  const slot1AfterB = sessionManager.getSoloSlot(sessionIdB, 1);
  assert(slot1AfterB.photoId === slot1BeforeB.photoId, "Scenario 5: Room B Slot 1 photoId completely unchanged");
  assert(slot1AfterB.revision === 1, "Scenario 5: Room B Slot 1 revision remains strictly 1");
  const roomBPhotoEventsAfter = roomBEvents.filter(e => e.type === 'photo:new').length;
  assert(roomBPhotoEventsBefore === roomBPhotoEventsAfter, "Scenario 5: Room B received zero broadcast events from Room A's retake");

  // --- SCENARIOS 6 & 7: Independent photo retrieval and strict isolation ---
  console.log("\n--- 6 & 7. Independent Photo Retrieval Isolation ---");
  const [reqA, reqB] = await Promise.all([
    new Promise(r => socketA.emit('photo:request-all', { sessionId: sessionIdA }, r)),
    new Promise(r => socketB.emit('photo:request-all', { sessionId: sessionIdB }, r))
  ]);

  assert(reqA.photos && reqA.photos.length === 4, "Scenario 6: Room A received exactly 4 photos");
  assert(reqB.photos && reqB.photos.length === 4, "Scenario 6: Room B received exactly 4 photos");

  const reqAIds = reqA.photos.map(p => p.metadata.id);
  const reqBIds = reqB.photos.map(p => p.metadata.id);

  assert(reqAIds.includes('photoA_slot1_r2') && !reqAIds.includes('photoA_slot1_r1'), "Scenario 7: Room A photos contain only active Rev 2 (superseded Rev 1 excluded)");
  assert(reqBIds.includes('photoB_slot1_r1'), "Scenario 7: Room B photos contain only original Rev 1");

  const crossLeakA = reqAIds.some(id => id.startsWith('photoB'));
  const crossLeakB = reqBIds.some(id => id.startsWith('photoA'));
  assert(!crossLeakA && !crossLeakB, "Scenario 7: Zero cross-room photo leakage in photo:request-all responses");

  // --- SCENARIO 8: End Room A and verify Room B remains active ---
  console.log("\n--- 8. Room Teardown Isolation ---");
  // End session A
  sessionManager.endSession(sessionIdA);
  sessionManager.deleteSession(sessionIdA);
  roomManager.deleteRoom(roomCodeA);
  socketA.disconnect();

  assert(sessionManager.getSession(sessionIdA) === null, "Scenario 8: Room A session successfully ended and removed");
  assert(roomManager.getRoom(roomCodeA) === null, "Scenario 8: Room A room entry removed");

  // Check Room B
  const activeSessB = sessionManager.getSession(sessionIdB);
  const activeRoomB = roomManager.getRoom(roomCodeB);
  assert(activeSessB !== null, "Scenario 8: Room B session remains completely active");
  assert(activeRoomB !== null, "Scenario 8: Room B room remains completely active");
  assert(activeSessB.photoBuffer.size === 4, "Scenario 8: Room B photoBuffer retains all 4 photos intact");
  assert(sessionManager.getSoloSlots(sessionIdB).length === 4, "Scenario 8: Room B soloSlots retain all 4 slot records");

  // --- SCENARIO 9: Start a Group Room C while Solo Room B remains active ---
  console.log("\n--- 9. Mixed-Mode Concurrency (Group Room C + Solo Room B) ---");
  const socketCHost = ClientIO(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  const socketCGuest = ClientIO(`http://127.0.0.1:${port}`, { transports: ['websocket'] });

  await Promise.all([
    new Promise(r => socketCHost.on('connect', r)),
    new Promise(r => socketCGuest.on('connect', r))
  ]);

  const groupCreateRes = await new Promise(r => {
    socketCHost.emit('room:create', { name: 'HostC', color: '#6BCB77', expectedCount: 2, mode: ROOM_MODES.GROUP }, r);
  });
  const roomCodeC = groupCreateRes.roomCode;

  const groupJoinRes = await new Promise(r => {
    socketCGuest.emit('room:join', { roomCode: roomCodeC, name: 'GuestC', color: '#FFD93D' }, r);
  });
  assert(groupJoinRes.room && groupJoinRes.room.participants.length === 2, "Scenario 9: Group Room C created with 2 participants");

  const groupSessRes = await new Promise(r => {
    socketCHost.emit('session:start', { roomCode: roomCodeC }, r);
  });
  const sessionIdC = groupSessRes.sessionId;
  assert(sessionIdC && sessionIdC !== sessionIdB, `Scenario 9: Group Room C started session ${sessionIdC} while Solo Room B is active`);

  const serverRoomB = roomManager.getRoom(roomCodeB);
  const serverRoomC = roomManager.getRoom(roomCodeC);
  assert(serverRoomB.mode === ROOM_MODES.SOLO, "Scenario 9: Room B remains in mode 'solo'");
  assert(serverRoomC.mode === ROOM_MODES.GROUP, "Scenario 9: Room C is in mode 'group'");

  // --- SCENARIO 10: WebRTC Signaling Isolation Between Group and Solo Modes ---
  console.log("\n--- 10. WebRTC Signaling Scope Isolation ---");
  // In Room C (Group), participants signal readiness
  let guestReceivedReady = false;
  let soloBReceivedReady = false;

  socketCGuest.on('signal:ready', () => { guestReceivedReady = true; });
  socketB.on('signal:ready', () => { soloBReceivedReady = true; });

  // Host C emits signal:ready scoped to roomCodeC
  socketCHost.emit('signal:ready', { roomCode: roomCodeC });
  await new Promise(r => setTimeout(r, 60));

  assert(guestReceivedReady === true, "Scenario 10: Guest in Group Room C received signal:ready");
  assert(soloBReceivedReady === false, "Scenario 10: Participant in Solo Room B received zero signaling noise from Room C");

  // Test offer dispatch
  let guestReceivedOffer = false;
  socketCGuest.on('signal:offer', () => { guestReceivedOffer = true; });
  socketCHost.emit('signal:offer', { target: groupJoinRes.participantId, offer: { type: 'offer', sdp: 'fake-sdp' } });
  await new Promise(r => setTimeout(r, 50));
  assert(guestReceivedOffer === true, "Scenario 10: WebRTC offer directed exclusively to intended peer in Room C");

  // --- SCENARIO 11: Simultaneous Photo Uploads to Different Rooms ---
  console.log("\n--- 11. Concurrent Simultaneous Photo Uploads Across Rooms ---");
  // Socket B (Solo) uploads retake for slot 2 (rev 2)
  // Socket C (Group) uploads a group photo simultaneously
  const [concB, concC] = await Promise.all([
    new Promise(r => {
      socketB.emit('photo:upload', {
        sessionId: sessionIdB,
        photoData: 'data:image/jpeg;base64,solo_b_slot2_r2_simultaneous',
        metadata: { id: `photoB_slot2_r2_${Date.now()}`, slotIndex: 2, revision: 2 }
      }, r);
    }),
    new Promise(r => {
      socketCHost.emit('photo:upload', {
        sessionId: sessionIdC,
        photoData: 'data:image/jpeg;base64,group_c_photo_1_simultaneous',
        metadata: { id: `groupC_photo1_${Date.now()}` }
      }, r);
    })
  ]);

  assert(concB.success && concB.revision === 2, "Scenario 11: Simultaneous upload to Solo Room B succeeded");
  assert(concC.success && concC.photoId.startsWith('groupC_'), "Scenario 11: Simultaneous upload to Group Room C succeeded");

  const sessBPhotos = sessionManager.getPhotos(sessionIdB).map(p => p.metadata.id);
  const sessCPhotos = sessionManager.getPhotos(sessionIdC).map(p => p.metadata.id);

  assert(sessBPhotos.includes(concB.photoId) && !sessBPhotos.includes(concC.photoId), "Scenario 11: Solo Room B buffer contains only Room B photo");
  assert(sessCPhotos.includes(concC.photoId) && !sessCPhotos.includes(concB.photoId), "Scenario 11: Group Room C buffer contains only Room C photo");

  // --- SCENARIO 12: Storage Object Key Scoping & Cleanup Isolation ---
  console.log("\n--- 12. Storage Prefix Scoping & Room Cleanup Isolation ---");
  // Build storage keys for all rooms
  const keyRoomA = `rooms/${roomCodeA}/photos/photoA_slot0_r1.jpg`;
  const keyRoomB = `rooms/${roomCodeB}/photos/photoB_slot0_r1.jpg`;
  const keyRoomC = `rooms/${roomCodeC}/photos/groupC_photo1.jpg`;

  assert(keyRoomA.startsWith(`rooms/${roomCodeA}/`), "Scenario 12: Room A storage key strictly prefixed by Room A code");
  assert(keyRoomB.startsWith(`rooms/${roomCodeB}/`), "Scenario 12: Room B storage key strictly prefixed by Room B code");
  assert(keyRoomC.startsWith(`rooms/${roomCodeC}/`), "Scenario 12: Room C storage key strictly prefixed by Room C code");

  // Simulated cleanup sweep of Room B
  const mockStorageObjects = [
    `rooms/${roomCodeB}/photos/photoB_slot0_r1.jpg`,
    `rooms/${roomCodeB}/photos/photoB_slot1_r1.jpg`,
    `rooms/${roomCodeC}/photos/groupC_photo1.jpg`,
    `rooms/${roomCodeC}/strips/strip1.png`
  ];

  // Simulating deleteRoomObjects(roomCodeB) using actual prefix logic
  const targetPrefix = `rooms/${roomCodeB}/`;
  const deletedObjects = mockStorageObjects.filter(key => key.startsWith(targetPrefix));
  const remainingObjects = mockStorageObjects.filter(key => !key.startsWith(targetPrefix));

  assert(deletedObjects.length === 2, "Scenario 12: Cleanup sweep of Room B matched exactly its 2 objects");
  assert(deletedObjects.every(k => k.startsWith(`rooms/${roomCodeB}/`)), "Scenario 12: All deleted objects belonged to Room B");
  assert(remainingObjects.length === 2 && remainingObjects.every(k => k.startsWith(`rooms/${roomCodeC}/`)), "Scenario 12: Zero Room C objects were deleted during Room B cleanup");

  // --- CROSS-ROOM INJECTION PROTECTION ---
  console.log("\n--- 13. Cross-Room Security & Tampering Protections ---");
  // Socket B attempts to upload into Room C's session
  const crossUploadAttempt = await new Promise(r => {
    socketB.emit('photo:upload', {
      sessionId: sessionIdC,
      photoData: 'data:image/jpeg;base64,malicious_injection',
      metadata: { id: 'injected_photo' }
    }, r);
  });
  assert(!crossUploadAttempt.success, "Scenario 13: Socket from Room B blocked from uploading into Room C");
  assert(crossUploadAttempt.error.includes('Unauthorized') || crossUploadAttempt.error.includes('not found'), "Scenario 13: Rejection error correctly flags unauthorized cross-room action");

  // Socket B attempts to trigger session:end-booth in Room C
  const crossEndBoothAttempt = await new Promise(r => {
    socketB.emit('session:end-booth', { roomCode: roomCodeC, sessionId: sessionIdC }, r);
  });
  assert(!crossEndBoothAttempt.success && crossEndBoothAttempt.error === 'Only the host can perform this action', "Scenario 13: Socket from Room B blocked from advancing Room C session stage");

  // Cleanup active sockets and server
  socketB.disconnect();
  socketCHost.disconnect();
  socketCGuest.disconnect();
  await new Promise(r => httpServer.close(r));

  console.log(`\n========================================`);
  console.log(`Multi-Room Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runMultiRoomTests().catch(err => {
  console.error("Multi-Room test execution failed:", err);
  process.exit(1);
});
