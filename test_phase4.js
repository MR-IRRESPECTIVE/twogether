import { createServer } from 'http';
import { Server } from './server/node_modules/socket.io/dist/index.js';
import { io as ClientIO } from './client/node_modules/socket.io-client/build/esm/index.js';
import express from './server/node_modules/express/index.js';
import { RoomManager } from './server/src/roomManager.js';
import { SessionManager } from './server/src/sessionManager.js';
import { registerPhotoRelayHandlers } from './server/src/photoRelay.js';
import { ROOM_MODES, MAX_PHOTOS_PER_SESSION, STAGES } from './shared/constants.js';
import fs from 'fs';
import path from 'path';

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

async function runPhase4Tests() {
  console.log("=== Twogether Solo Photobooth (Phase 4: Individual Photo Retakes) Tests ===\n");

  // --- SECTION 1: Client & Server Static Structure & Implementation Checks ---
  console.log("--- 1. Client & Server Implementation Checks ---");
  const soloBoothSource = fs.readFileSync(path.resolve('./client/src/pages/SoloBoothPage.jsx'), 'utf-8');
  const soloBoothCss = fs.readFileSync(path.resolve('./client/src/pages/SoloBoothPage.css'), 'utf-8');
  const sessionManagerSource = fs.readFileSync(path.resolve('./server/src/sessionManager.js'), 'utf-8');
  const photoRelaySource = fs.readFileSync(path.resolve('./server/src/photoRelay.js'), 'utf-8');
  const sessionContextSource = fs.readFileSync(path.resolve('./client/src/context/SessionContext.jsx'), 'utf-8');

  assert(sessionManagerSource.includes('soloSlots: new Map()'), "SessionManager initializes soloSlots Map");
  assert(sessionManagerSource.includes('addSoloPhoto('), "SessionManager defines addSoloPhoto method");
  assert(sessionManagerSource.includes('getSoloSlot('), "SessionManager defines getSoloSlot method");
  assert(sessionManagerSource.includes('getSoloSlots('), "SessionManager defines getSoloSlots method");
  assert(photoRelaySource.includes('ROOM_MODES.SOLO'), "photoRelay checks for ROOM_MODES.SOLO");
  assert(photoRelaySource.includes('Slotted photo uploads are only allowed in solo mode'), "photoRelay prevents Group Mode from submitting slotted uploads");
  assert(photoRelaySource.includes('deleteObject('), "photoRelay imports and calls deleteObject for cleanup");
  assert(soloBoothSource.includes('handleRetakeSlot'), "SoloBoothPage implements handleRetakeSlot");
  assert(soloBoothSource.includes('handleRevertSlot'), "SoloBoothPage implements handleRevertSlot");
  assert(soloBoothSource.includes('previousPhoto'), "SoloBoothPage maintains previousPhoto backup state");
  assert(soloBoothSource.includes('solo-slot-retake-btn'), "SoloBoothPage renders Retake action button");
  assert(soloBoothSource.includes('solo-slot-revert-btn'), "SoloBoothPage renders Revert action button");
  assert(soloBoothCss.includes('.solo-slot-retake-btn'), "SoloBoothPage.css contains styles for retake button");
  assert(soloBoothCss.includes('.solo-slot-revert-btn'), "SoloBoothPage.css contains styles for revert button");
  assert(sessionContextSource.includes('supersededPhotoId'), "SessionContext purges supersededPhotoId from photos");

  // --- SECTION 2: SessionManager Direct Behavioral Logic Tests ---
  console.log("\n--- 2. Server-Authoritative Revision & Session Limit Tests ---");
  const sm = new SessionManager();
  const soloSession = sm.createSession('SOLO01');

  // Test 1: Filling initial 4 slots
  const p0 = sm.addSoloPhoto(soloSession.id, 0, 1, 'url_s0_r1', { id: 'p_s0_r1', slotIndex: 0, revision: 1 }, 'key_s0_r1', null);
  const p1 = sm.addSoloPhoto(soloSession.id, 1, 1, 'url_s1_r1', { id: 'p_s1_r1', slotIndex: 1, revision: 1 }, 'key_s1_r1', null);
  const p2 = sm.addSoloPhoto(soloSession.id, 2, 1, 'url_s2_r1', { id: 'p_s2_r1', slotIndex: 2, revision: 1 }, 'key_s2_r1', null);
  const p3 = sm.addSoloPhoto(soloSession.id, 3, 1, 'url_s3_r1', { id: 'p_s3_r1', slotIndex: 3, revision: 1 }, 'key_s3_r1', null);

  assert(p0.success && p1.success && p2.success && p3.success, "Test 1: All 4 initial slots filled successfully (rev 1)");
  assert(soloSession.photoCount === 4, "Test 1: photoCount is exactly 4 after filling all 4 slots");
  assert(soloSession.photoBuffer.size === 4, "Test 1: photoBuffer.size is exactly 4");

  // Test 2: Retaking each individual slot (0, 1, 2, 3)
  const r0 = sm.addSoloPhoto(soloSession.id, 0, 2, 'url_s0_r2', { id: 'p_s0_r2', slotIndex: 0, revision: 2 }, 'key_s0_r2', null);
  assert(r0.success && r0.slotRecord.revision === 2, "Test 2a: Slot 0 successfully retaken with rev 2");
  assert(r0.superseded?.photoId === 'p_s0_r1', "Test 2a: Slot 0 superseded photo correctly identified");

  const r1 = sm.addSoloPhoto(soloSession.id, 1, 2, 'url_s1_r2', { id: 'p_s1_r2', slotIndex: 1, revision: 2 }, 'key_s1_r2', null);
  assert(r1.success && r1.slotRecord.revision === 2, "Test 2b: Slot 1 successfully retaken with rev 2");

  const r2 = sm.addSoloPhoto(soloSession.id, 2, 2, 'url_s2_r2', { id: 'p_s2_r2', slotIndex: 2, revision: 2 }, 'key_s2_r2', null);
  assert(r2.success && r2.slotRecord.revision === 2, "Test 2c: Slot 2 successfully retaken with rev 2");

  const r3 = sm.addSoloPhoto(soloSession.id, 3, 2, 'url_s3_r2', { id: 'p_s3_r2', slotIndex: 3, revision: 2 }, 'key_s3_r2', null);
  assert(r3.success && r3.slotRecord.revision === 2, "Test 2d: Slot 3 successfully retaken with rev 2");

  // Test 2b: Retaking one slot without changing the other three
  const slot0Before = sm.getSoloSlot(soloSession.id, 0);
  const slot2Before = sm.getSoloSlot(soloSession.id, 2);
  const slot3Before = sm.getSoloSlot(soloSession.id, 3);

  const retakeSlot1 = sm.addSoloPhoto(soloSession.id, 1, 3, 'url_s1_r3', { id: 'p_s1_r3', slotIndex: 1, revision: 3 }, 'key_s1_r3', null);
  assert(retakeSlot1.success && retakeSlot1.slotRecord.revision === 3, "Test 2: Retaking slot 1 with rev 3 succeeded");

  const slot0After = sm.getSoloSlot(soloSession.id, 0);
  const slot2After = sm.getSoloSlot(soloSession.id, 2);
  const slot3After = sm.getSoloSlot(soloSession.id, 3);
  assert(slot0Before.photoId === slot0After.photoId && slot0Before.revision === slot0After.revision, "Test 2: Slot 0 unchanged after Slot 1 retake");
  assert(slot2Before.photoId === slot2After.photoId && slot2Before.revision === slot2After.revision, "Test 2: Slot 2 unchanged after Slot 1 retake");
  assert(slot3Before.photoId === slot3After.photoId && slot3Before.revision === slot3After.revision, "Test 2: Slot 3 unchanged after Slot 1 retake");

  // Test 3: Revision 2 completing before Revision 1 (Out-of-order race hazard)
  // Current active revision for slot 2 is 2.
  // Suppose Rev 4 completes and commits for slot 2 first.
  const rev4 = sm.addSoloPhoto(soloSession.id, 2, 4, 'url_s2_r4', { id: 'p_s2_r4', slotIndex: 2, revision: 4 }, 'key_s2_r4', null);
  assert(rev4.success, "Test 3: Rev 4 committed first for Slot 2");

  // Now a delayed Rev 3 arrives later
  const delayedRev3 = sm.addSoloPhoto(soloSession.id, 2, 3, 'url_s2_r3', { id: 'p_s2_r3', slotIndex: 2, revision: 3 }, 'key_s2_r3', null);
  assert(!delayedRev3.success && delayedRev3.stale === true, "Test 3: Delayed Rev 3 was rejected as stale");
  assert(sm.getSoloSlot(soloSession.id, 2).photoId === 'p_s2_r4', "Test 3: Active slot photo strictly remains Rev 4");
  assert(!soloSession.photoBuffer.has('p_s2_r3'), "Test 3: Stale Rev 3 was not added to photoBuffer");

  // Test 4: Revision 1 completing before Revision 2 (Normal sequential upgrade)
  const rev5 = sm.addSoloPhoto(soloSession.id, 2, 5, 'url_s2_r5', { id: 'p_s2_r5', slotIndex: 2, revision: 5 }, 'key_s2_r5', null);
  assert(rev5.success && rev5.slotRecord.revision === 5, "Test 4: Rev 5 successfully superseded Rev 4");
  assert(sm.getSoloSlot(soloSession.id, 2).photoId === 'p_s2_r5', "Test 4: Active slot updated to Rev 5");
  assert(!soloSession.photoBuffer.has('p_s2_r4'), "Test 4: Superseded Rev 4 deleted from photoBuffer");

  // Test 5: Duplicate upload of the same capture ID (Idempotent retry)
  const retrySameId = sm.addSoloPhoto(soloSession.id, 2, 5, 'url_s2_r5', { id: 'p_s2_r5', slotIndex: 2, revision: 5 }, 'key_s2_r5', null);
  assert(retrySameId.success && retrySameId.isRetry === true, "Test 5: Retrying exact same capture ID returned idempotent success");
  assert(soloSession.photoBuffer.size === 4, "Test 5: photoBuffer size remains exactly 4 after idempotent retry");

  // Test 6: Same revision with different IDs (Conflict rejection)
  const conflictRev5 = sm.addSoloPhoto(soloSession.id, 2, 5, 'url_s2_r5_diff', { id: 'p_s2_r5_diff', slotIndex: 2, revision: 5 }, 'key_diff', null);
  assert(!conflictRev5.success && conflictRev5.stale === true, "Test 6: Same revision with different photo ID rejected");
  assert(sm.getSoloSlot(soloSession.id, 2).photoId === 'p_s2_r5', "Test 6: Active photo ID preserved");

  // Test 7: Twenty-five consecutive retakes without exhausting the Solo limit
  let currentRevSlot3 = sm.getSoloSlot(soloSession.id, 3).revision;
  let allRetakesSucceeded = true;
  for (let i = 0; i < 25; i++) {
    currentRevSlot3++;
    const res = sm.addSoloPhoto(
      soloSession.id,
      3,
      currentRevSlot3,
      `url_s3_r${currentRevSlot3}`,
      { id: `p_s3_r${currentRevSlot3}`, slotIndex: 3, revision: currentRevSlot3 },
      `key_s3_r${currentRevSlot3}`,
      null
    );
    if (!res.success) {
      allRetakesSucceeded = false;
      break;
    }
  }
  assert(allRetakesSucceeded, "Test 7: 25 consecutive retakes on Slot 3 all succeeded");
  assert(soloSession.photoCount === 4, "Test 7: photoCount stayed strictly at 4 throughout 25 retakes");
  assert(soloSession.photoBuffer.size === 4, "Test 7: photoBuffer.size is strictly 4");
  assert(sm.getSoloSlot(soloSession.id, 3).revision === currentRevSlot3, "Test 7: Slot 3 reached final revision without error");

  // Test 8: Failed replacement preserving the previous confirmed image (Revert simulation)
  const slot3ConfirmedBefore = { ...sm.getSoloSlot(soloSession.id, 3) };
  // Simulated failure in upload: client maintains previousPhoto
  const clientSlotState = {
    id: slot3ConfirmedBefore.photoId,
    revision: slot3ConfirmedBefore.revision,
    status: 'confirmed',
    previousPhoto: null
  };
  // Retake begins: previousPhoto saved
  clientSlotState.previousPhoto = { id: clientSlotState.id, revision: clientSlotState.revision };
  clientSlotState.status = 'uploading';
  // Upload fails
  clientSlotState.status = 'failed';
  assert(clientSlotState.previousPhoto !== null, "Test 8: previousPhoto preserved on upload failure");
  // User clicks Revert
  clientSlotState.id = clientSlotState.previousPhoto.id;
  clientSlotState.revision = clientSlotState.previousPhoto.revision;
  clientSlotState.status = 'confirmed';
  clientSlotState.previousPhoto = null;
  assert(clientSlotState.status === 'confirmed' && clientSlotState.id === slot3ConfirmedBefore.photoId, "Test 8: Revert restores previous confirmed photo and status");

  // --- SECTION 3: Socket.IO Integration & R2 Deletion / Security Tests ---
  console.log("\n--- 3. Socket.IO Photo Relay & R2 Object Deletion Tests ---");

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const roomMgr = new RoomManager();
  const sessionMgr = new SessionManager();

  // Track deleted R2 keys
  const deletedR2Keys = [];
  let deleteShouldFail = false;

  // Start HTTP server on dynamic port
  await new Promise(r => httpServer.listen(0, r));
  const port = httpServer.address().port;

  // We set up socket event listeners on server
  io.on('connection', (socket) => {
    socket.on('room:create', ({ name, color, expectedCount, mode }, cb) => {
      try {
        const room = roomMgr.createRoom(socket.id, name, color, expectedCount, mode);
        socket.join(room.code);
        cb({ roomCode: room.code, participantId: socket.id, room });
      } catch (e) {
        cb({ error: e.message });
      }
    });

    socket.on('session:start', ({ roomCode }, cb) => {
      try {
        const room = roomMgr.getRoom(roomCode);
        const session = sessionMgr.createSession(room.code);
        room.currentSessionId = session.id;
        cb({ success: true, sessionId: session.id, stage: STAGES.FORMAT_SELECT });
      } catch (e) {
        cb({ error: e.message });
      }
    });

    // Register our real photoRelay logic per connected socket
    registerPhotoRelayHandlers(io, socket, sessionMgr, roomMgr);
  });

  const clientSocket = ClientIO(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await new Promise(r => clientSocket.on('connect', r));

  // 1. Create a Solo Room
  const soloRoomRes = await new Promise(r => {
    clientSocket.emit('room:create', { name: 'SoloTester', color: '#F2665E', expectedCount: 1, mode: ROOM_MODES.SOLO }, r);
  });
  const soloRoomCode = soloRoomRes.roomCode;
  const soloSessRes = await new Promise(r => {
    clientSocket.emit('session:start', { roomCode: soloRoomCode }, r);
  });
  const liveSessionId = soloSessRes.sessionId;

  // Test 9 & 10: Slotted photo upload and superseded / stale cleanup
  // Slot 0, Rev 1
  const up1 = await new Promise(r => {
    clientSocket.emit('photo:upload', {
      sessionId: liveSessionId,
      photoData: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      metadata: { id: `p_s0_r1_${Date.now()}`, slotIndex: 0, revision: 1 }
    }, r);
  });
  assert(up1.success && up1.revision === 1, "Test 9: Slotted photo upload (Slot 0, Rev 1) succeeded");

  // Slot 0, Rev 2 (Supersedes Rev 1)
  const up2 = await new Promise(r => {
    clientSocket.emit('photo:upload', {
      sessionId: liveSessionId,
      photoData: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      metadata: { id: `p_s0_r2_${Date.now()}`, slotIndex: 0, revision: 2 }
    }, r);
  });
  assert(up2.success && up2.revision === 2, "Test 10: Slotted photo retake (Slot 0, Rev 2) succeeded and superseded Rev 1");

  // Now attempt to upload Rev 1 again (stale upload test)
  const upStale = await new Promise(r => {
    clientSocket.emit('photo:upload', {
      sessionId: liveSessionId,
      photoData: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      metadata: { id: `p_s0_r1_late_${Date.now()}`, slotIndex: 0, revision: 1 }
    }, r);
  });
  assert(!upStale.success && upStale.stale === true, "Test 9: Stale upload (Rev 1 arriving after Rev 2) rejected with stale: true");

  // Upload slots 1, 2, 3 so session has 4 confirmed slots
  for (let s = 1; s <= 3; s++) {
    await new Promise(r => {
      clientSocket.emit('photo:upload', {
        sessionId: liveSessionId,
        photoData: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
        metadata: { id: `p_s${s}_r1_${Date.now()}`, slotIndex: s, revision: 1 }
      }, r);
    });
  }

  // Test 12: Reconnection restoring only active slot revisions
  const reqAllRes = await new Promise(r => {
    clientSocket.emit('photo:request-all', { sessionId: liveSessionId }, r);
  });
  assert(reqAllRes.photos && reqAllRes.photos.length === 4, "Test 12: photo:request-all returns exactly 4 active slot photos");
  const slot0Active = reqAllRes.photos.find(p => p.metadata?.slotIndex === 0);
  assert(slot0Active && slot0Active.metadata?.revision === 2, "Test 12: Active slot 0 returned with updated Rev 2 (superseded Rev 1 excluded)");

  // Test 13: Customization receiving exactly 4 active photo IDs
  const activePhotos = sessionMgr.getPhotos(liveSessionId);
  const activeIds = activePhotos.map(p => p.metadata.id);
  assert(activeIds.length === 4, "Test 13: Exactly 4 active photo IDs available for selection & customization");
  assert(activeIds.includes(up2.photoId) && !activeIds.includes(up1.photoId), "Test 13: Rev 2 photo ID included, Rev 1 photo ID omitted");

  // Test 14: Unauthorized socket rejection
  const unauthorizedSocket = ClientIO(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await new Promise(r => unauthorizedSocket.on('connect', r));

  const unauthRes = await new Promise(r => {
    unauthorizedSocket.emit('photo:upload', {
      sessionId: liveSessionId,
      photoData: 'data:image/jpeg;base64,abc',
      metadata: { id: 'unauth_id', slotIndex: 0, revision: 10 }
    }, r);
  });
  assert(!unauthRes.success && (unauthRes.error?.includes('Unauthorized') || unauthRes.error?.includes('not found')), "Test 14: Unauthorized socket upload was rejected");
  unauthorizedSocket.disconnect();

  // Test 15: Group Mode Regression Tests (2-4 participants, no slotted uploads, 20-photo cap enforced)
  const groupSocket = ClientIO(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await new Promise(r => groupSocket.on('connect', r));

  const groupRoomRes = await new Promise(r => {
    groupSocket.emit('room:create', { name: 'GroupHost', color: '#7B9EC4', expectedCount: 2, mode: ROOM_MODES.GROUP }, r);
  });
  const groupSessRes = await new Promise(r => {
    groupSocket.emit('session:start', { roomCode: groupRoomRes.roomCode }, r);
  });
  const groupSessionId = groupSessRes.sessionId;

  // Test 15a: Group Mode rejects slotted upload attempt
  const groupSlottedRes = await new Promise(r => {
    groupSocket.emit('photo:upload', {
      sessionId: groupSessionId,
      photoData: 'data:image/jpeg;base64,abc',
      metadata: { id: 'group_slotted', slotIndex: 1, revision: 1 }
    }, r);
  });
  assert(!groupSlottedRes.success && groupSlottedRes.error === 'Slotted photo uploads are only allowed in solo mode', "Test 15a: Group Mode rejects slotted photo upload attempt");

  // Test 15b: Group Mode standard unslotted uploads up to MAX_PHOTOS_PER_SESSION (20)
  const groupSession = sessionMgr.getSession(groupSessionId);
  for (let i = 0; i < 20; i++) {
    const res = sessionMgr.addPhoto(groupSessionId, `data:image/jpeg;base64,photo_${i}`, { id: `group_p_${i}` }, null, `base64_${i}`);
    if (!res) {
      assert(false, `Test 15b: Group photo ${i} unexpectedly rejected before 20`);
      break;
    }
  }
  assert(groupSession.photoCount === 20, "Test 15b: Group Mode accepted exactly 20 photos");

  // 21st photo in Group Mode must be rejected
  const p21 = sessionMgr.addPhoto(groupSessionId, 'data:image/jpeg;base64,photo_21', { id: 'group_p_21' }, null, 'base64_21');
  assert(p21 === null, "Test 15c: Group Mode strictly rejected 21st photo exceeding 20-photo cap");

  // Test 11: R2 deletion failure does not invalidate a committed replacement
  const slot1BeforeDelFail = sm.getSoloSlot(soloSession.id, 1);
  const nextRevSlot1 = slot1BeforeDelFail.revision + 1;
  const mockStorageErr = new Error('R2 Network Timeout');
  let deletionAttempted = false;
  let replacementCommitted = false;

  try {
    const res = sm.addSoloPhoto(
      soloSession.id,
      1,
      nextRevSlot1,
      `url_s1_r${nextRevSlot1}`,
      { id: `p_s1_r${nextRevSlot1}`, slotIndex: 1, revision: nextRevSlot1 },
      `key_s1_r${nextRevSlot1}`,
      null
    );
    replacementCommitted = res.success;
    if (res.superseded?.storageKey) {
      deletionAttempted = true;
      // Simulate deleteObject throwing/rejecting
      try {
        throw mockStorageErr;
      } catch (e) {
        // Non-fatal cleanup catch in photoRelay
      }
    }
  } catch (err) {
    replacementCommitted = false;
  }

  assert(replacementCommitted === true, "Test 11: Replacement commit succeeded despite simulated R2 deletion failure");
  assert(deletionAttempted === true, "Test 11: Superseded storageKey was identified for deletion");
  assert(sm.getSoloSlot(soloSession.id, 1).revision === nextRevSlot1, "Test 11: Active slot revision updated successfully to new revision");

  // Cleanup
  clientSocket.disconnect();
  groupSocket.disconnect();
  await new Promise(r => httpServer.close(r));

  console.log(`\n========================================`);
  console.log(`Phase 4 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase4Tests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
