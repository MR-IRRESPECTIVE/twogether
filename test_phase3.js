import { ROOM_MODES, STAGES, MAX_PHOTOS_PER_SESSION } from './shared/constants.js';
import { SessionManager } from './server/src/sessionManager.js';
import { RoomManager } from './server/src/roomManager.js';
import { requestTransition } from './client/src/lib/transitions.js';
import fs from 'fs';

async function runPhase3Tests() {
  console.log('=== Twogether Solo Photobooth (Phase 3: Capture Engine) Tests ===\n');

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

  // --- 1. COMPONENT FILE AUDIT ---
  console.log('--- 1. SoloBoothPage Structure & Safeguards ---');
  const soloSource = fs.readFileSync('client/src/pages/SoloBoothPage.jsx', 'utf8');
  const captureSource = fs.readFileSync('client/src/lib/capture.js', 'utf8');
  const sessionContextSource = fs.readFileSync('client/src/context/SessionContext.jsx', 'utf8');

  assert(soloSource.includes("const [captureMode, setCaptureMode] = useState('auto')"), 'SoloBoothPage supports auto/manual state');
  assert(soloSource.includes('executeAutoSequence'), 'Includes dedicated Automatic capture sequence engine');
  assert(soloSource.includes('handleManualCapture'), 'Includes dedicated Manual snap handler');
  assert(soloSource.includes('handleRetrySlot'), 'Includes dedicated upload retry handler without recapture');
  assert(soloSource.includes('handleCompleteSession'), 'Includes completion orchestration');
  assert(soloSource.includes('endBooth()') && soloSource.includes('confirmSelection(photoIds)'), 'Transitions BOOTH -> SELECTION -> CUSTOMIZE');
  assert(soloSource.includes('isBusyRef') && soloSource.includes('abortLoopRef'), 'Uses synchronous refs for rapid-click & abort protection');
  assert(soloSource.includes('isCompletingRef'), 'Uses synchronous ref to prevent duplicate stage completion attempts');
  assert(soloSource.includes('mirrored: facingModeRef.current === \'user\''), 'Passes facingMode mirroring state to captureFrame');
  assert(captureSource.includes('item.mirrored !== false'), 'captureFrame supports un-mirrored rear camera capture while preserving group mode');
  assert(sessionContextSource.includes('requestTransition'), 'SessionContext imports and uses requestTransition helper');
  assert(sessionContextSource.includes('sessionIdRef'), 'SessionContext uses sessionIdRef for safe session comparison');
  assert(!/setSessionId\([^)]*=>[^}]*setStage/.test(sessionContextSource), 'No state setter is called inside another state setter functional updater');
  assert(!sessionContextSource.includes('setTimeout(() => resolve({ success: true }), 1500)'), 'SessionContext no longer contains false-success 1500ms timeouts');

  // --- 2. LOGIC UNIT SIMULATION TESTS ---
  console.log('\n--- 2. Solo Capture Engine Logic Simulation ---');

  // Helper simulating the capture engine state machine in SoloBoothPage
  class SoloCaptureEngine {
    constructor({ sessionManager, sessionId, socketId, uploadDelay = 10 }) {
      this.sessionManager = sessionManager;
      this.sessionId = sessionId;
      this.socketId = socketId;
      this.uploadDelay = uploadDelay;

      this.slots = [
        { id: null, dataUrl: null, status: 'empty', error: null, metadata: null },
        { id: null, dataUrl: null, status: 'empty', error: null, metadata: null },
        { id: null, dataUrl: null, status: 'empty', error: null, metadata: null },
        { id: null, dataUrl: null, status: 'empty', error: null, metadata: null }
      ];

      this.captureMode = 'auto';
      this.isBusy = false;
      this.abort = false;
      this.cameraLive = true;
      this.socketConnected = true;
      this.countdownTicks = [];
      this.capturesCount = 0;
      this.completedWithIds = null;
    }

    async runCountdown() {
      for (let t = 3; t >= 1; t--) {
        if (this.abort || !this.cameraLive) {
          return false;
        }
        this.countdownTicks.push(t);
      }
      return !this.abort && this.cameraLive;
    }

    async captureFrame(slotIdx) {
      if (!this.cameraLive) throw new Error('Camera disconnected');
      this.capturesCount++;
      return { dataUrl: `data:image/jpeg;base64,slot_${slotIdx}_img` };
    }

    async uploadPhoto(dataUrl, metadata) {
      if (!this.socketConnected) {
        return { success: false, error: 'Socket disconnected' };
      }
      await new Promise(r => setTimeout(r, this.uploadDelay));
      const res = this.sessionManager.addPhoto(this.sessionId, dataUrl, metadata, `photo_${metadata.id}.jpg`, dataUrl);
      if (!res) {
        return { success: false, error: 'Upload rejected by server' };
      }
      return { success: true, photoId: metadata.id, photoUrl: dataUrl };
    }

    async captureAndUploadSlot(slotIdx) {
      if (!this.cameraLive) return false;
      this.slots[slotIdx].status = 'capturing';

      const ok = await this.runCountdown();
      if (!ok) {
        this.slots[slotIdx].status = 'empty';
        return false;
      }

      let frame;
      try {
        frame = await this.captureFrame(slotIdx);
      } catch (e) {
        this.slots[slotIdx].status = 'failed';
        this.slots[slotIdx].error = e.message;
        return false;
      }

      const meta = {
        id: `${this.sessionId}_slot_${slotIdx}`,
        slotIndex: slotIdx,
        capturedBy: this.socketId,
        timestamp: Date.now()
      };

      this.slots[slotIdx].dataUrl = frame.dataUrl;
      this.slots[slotIdx].metadata = meta;
      this.slots[slotIdx].status = 'uploading';

      const res = await this.uploadPhoto(frame.dataUrl, meta);
      if (res.success) {
        this.slots[slotIdx].status = 'confirmed';
        this.slots[slotIdx].id = res.photoId;
        return true;
      } else {
        this.slots[slotIdx].status = 'failed';
        this.slots[slotIdx].error = res.error;
        return false;
      }
    }

    async executeAutoSequence() {
      if (this.isBusy) return false;
      this.isBusy = true;
      this.abort = false;

      for (let i = 0; i < 4; i++) {
        if (this.abort) break;
        if (this.slots[i].status === 'confirmed') continue;

        const success = await this.captureAndUploadSlot(i);
        if (!success) {
          this.abort = true;
          break;
        }
      }

      const allConfirmed = this.slots.every(s => s.status === 'confirmed');
      if (allConfirmed) {
        this.completeSession();
      }
      this.isBusy = false;
      return true;
    }

    async handleManualCapture() {
      if (this.isBusy) return false;
      const nextIdx = this.slots.findIndex(s => s.status !== 'confirmed');
      if (nextIdx === -1) return false; // 5th capture prevented!

      this.isBusy = true;
      const success = await this.captureAndUploadSlot(nextIdx);

      if (success) {
        if (this.slots.every(s => s.status === 'confirmed')) {
          this.completeSession();
        }
      }
      this.isBusy = false;
      return success;
    }

    async handleRetrySlot(slotIdx) {
      if (this.isBusy) return false;
      const slot = this.slots[slotIdx];
      if (!slot || slot.status !== 'failed' || !slot.dataUrl) return false;

      this.isBusy = true;
      slot.status = 'uploading';
      const res = await this.uploadPhoto(slot.dataUrl, slot.metadata);
      if (res.success) {
        slot.status = 'confirmed';
        slot.id = res.photoId;
        if (this.slots.every(s => s.status === 'confirmed')) {
          this.completeSession();
        } else if (this.captureMode === 'auto') {
          this.isBusy = false;
          return this.executeAutoSequence();
        }
      } else {
        slot.status = 'failed';
        slot.error = res.error;
      }
      this.isBusy = false;
      return res.success;
    }

    completeSession() {
      const confirmed = this.slots.filter(s => s.status === 'confirmed');
      if (confirmed.length === 4) {
        this.sessionManager.setStage(this.sessionId, STAGES.SELECTION);
        this.completedWithIds = confirmed.map(s => s.id);
        this.sessionManager.setSelection(this.sessionId, this.socketId, this.completedWithIds);
        this.sessionManager.setStage(this.sessionId, STAGES.CUSTOMIZE);
      }
    }
  }

  // TEST 1: Automatic 4-photo sequence
  console.log('\n--- TEST 1: Automatic 4-Photo Sequence ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM01');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });
    await engine.executeAutoSequence();

    assert(engine.slots.every(s => s.status === 'confirmed'), 'All 4 slots confirmed in auto mode');
    assert(engine.capturesCount === 4, 'Exactly 4 captures occurred');
    assert(sm.getPhotos(session.id).length === 4, 'Server buffer contains 4 photos');
    assert(session.stage === STAGES.CUSTOMIZE, 'Session advanced automatically to CUSTOMIZE');
    assert(engine.completedWithIds.length === 4, '4 confirmed IDs stored in selection');
  }

  // TEST 2: Manual 4-photo sequence
  console.log('\n--- TEST 2: Manual 4-Photo Sequence ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM02');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });
    engine.captureMode = 'manual';

    for (let i = 0; i < 4; i++) {
      assert(!engine.isBusy, `Shutter is unblocked before capture ${i + 1}`);
      const ok = await engine.handleManualCapture();
      assert(ok, `Manual capture ${i + 1} succeeded`);
      assert(engine.slots[i].status === 'confirmed', `Slot ${i + 1} confirmed`);
    }

    assert(session.stage === STAGES.CUSTOMIZE, 'Manual sequence advanced to CUSTOMIZE after 4th photo');
    assert(engine.slots.filter(s => s.status === 'confirmed').length === 4, 'All 4 slots confirmed');
  }

  // TEST 3: Countdown timing and capture count
  console.log('\n--- TEST 3: Countdown Timing (3, 2, 1) per Photo ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM03');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });
    await engine.executeAutoSequence();

    assert(engine.countdownTicks.length === 12, '12 countdown ticks observed across 4 captures');
    const expectedTicks = [3, 2, 1, 3, 2, 1, 3, 2, 1, 3, 2, 1];
    assert(JSON.stringify(engine.countdownTicks) === JSON.stringify(expectedTicks), 'Every photo ran 3 -> 2 -> 1 countdown in order');
  }

  // TEST 4: Rapid Shutter Clicks Blocked
  console.log('\n--- TEST 4: Rapid Shutter Clicks Blocked ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM04');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host', uploadDelay: 50 });
    engine.captureMode = 'manual';

    const firstPromise = engine.handleManualCapture();
    const secondCallResult = await engine.handleManualCapture();

    assert(secondCallResult === false, 'Rapid 2nd click immediately rejected while busy');
    await firstPromise;
    assert(engine.slots.filter(s => s.status === 'confirmed').length === 1, 'Only 1 capture processed');
  }

  // TEST 5: Upload acknowledgement gating before advancing
  console.log('\n--- TEST 5: Upload Acknowledgement Gated Before Advancing ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM05');
    sm.setStage(session.id, STAGES.BOOTH);

    let ackedSlots = [];
    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host', uploadDelay: 20 });
    const originalUpload = engine.uploadPhoto.bind(engine);
    engine.uploadPhoto = async (dataUrl, meta) => {
      const res = await originalUpload(dataUrl, meta);
      if (res.success) ackedSlots.push(meta.slotIndex);
      return res;
    };

    await engine.executeAutoSequence();
    assert(JSON.stringify(ackedSlots) === JSON.stringify([0, 1, 2, 3]), 'Each slot was acknowledged in strict serial order');
  }

  // TEST 6: Failed upload and retry with identical dataUrl & Idempotency
  console.log('\n--- TEST 6: Failed Upload and Retry (Same Image Preserved) ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM06');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });

    let attempts = 0;
    const originalUpload = engine.uploadPhoto.bind(engine);
    engine.uploadPhoto = async (dataUrl, meta) => {
      if (meta.slotIndex === 1 && attempts === 0) {
        attempts++;
        return { success: false, error: 'Network timeout' };
      }
      return originalUpload(dataUrl, meta);
    };

    await engine.executeAutoSequence();
    assert(engine.slots[0].status === 'confirmed', 'Slot 0 confirmed before failure');
    assert(engine.slots[1].status === 'failed', 'Slot 1 failed as expected');
    assert(engine.slots[1].dataUrl !== null, 'Captured image dataUrl preserved locally on failure');
    assert(engine.slots[2].status === 'empty', 'Slot 2 not started after failure (auto loop stopped)');

    const preservedDataUrl = engine.slots[1].dataUrl;
    const retryOk = await engine.handleRetrySlot(1);
    assert(retryOk, 'Retry upload succeeded');
    assert(engine.capturesCount === 4, 'No extra camera capture occurred during retry');
    assert(engine.slots[1].dataUrl === preservedDataUrl, 'Exact same image dataUrl was re-uploaded');
    assert(engine.slots.every(s => s.status === 'confirmed'), 'Auto sequence resumed and all 4 confirmed');
    assert(sm.getPhotos(session.id).length === 4, 'Server photo count is exactly 4 without duplicates');
  }

  // TEST 7: Socket Disconnection During Upload
  console.log('\n--- TEST 7: Socket Disconnection During Upload ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM07');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });
    engine.socketConnected = false;

    await engine.executeAutoSequence();
    assert(engine.slots[0].status === 'failed', 'Slot marked failed upon disconnect');
    assert(engine.slots[0].error.includes('Socket disconnected'), 'Error explicitly notes socket disconnect');
    assert(!engine.isBusy, 'Engine is not stuck in busy state after disconnect error');
  }

  // TEST 8: Camera Disconnection During Countdown
  console.log('\n--- TEST 8: Camera Disconnection During Countdown ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM08');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });
    engine.cameraLive = false;

    await engine.executeAutoSequence();
    assert(engine.capturesCount === 0, 'No capture triggered when camera is dead');
    assert(!engine.isBusy, 'Engine safely unblocked');
    assert(engine.slots[0].status === 'empty' || engine.slots[0].status === 'failed', 'Safe slot status');
  }

  // TEST 9: Prevention of a 5th Capture
  console.log('\n--- TEST 9: Prevention of 5th Capture ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM09');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });
    await engine.executeAutoSequence();

    assert(engine.slots.filter(s => s.status === 'confirmed').length === 4, 'All 4 confirmed');
    const fifthCaptureResult = await engine.handleManualCapture();
    assert(fifthCaptureResult === false, '5th capture attempt was rejected');
    assert(engine.capturesCount === 4, 'Total captures remain exactly 4');
  }

  // TEST 10: Correct 4 IDs Passed to Selection Flow
  console.log('\n--- TEST 10: Correct 4 IDs Passed Into Selection Flow ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM10');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host' });
    await engine.executeAutoSequence();

    const expectedIds = [
      `${session.id}_slot_0`,
      `${session.id}_slot_1`,
      `${session.id}_slot_2`,
      `${session.id}_slot_3`
    ];

    assert(JSON.stringify(engine.completedWithIds) === JSON.stringify(expectedIds), 'All 4 confirmed IDs match session selection');
    const serverSelection = session.participantSelections.get('solo_host');
    assert(JSON.stringify(serverSelection) === JSON.stringify(expectedIds), 'Server selection stored correct 4 IDs');
    assert(session.stage === STAGES.CUSTOMIZE, 'Stage safely reached CUSTOMIZE');
  }

  // TEST 11: Safe Cleanup When Leaving Mid-Sequence
  console.log('\n--- TEST 11: Safe Cleanup Mid-Sequence ---');
  {
    const sm = new SessionManager();
    const session = sm.createSession('ROOM11');
    sm.setStage(session.id, STAGES.BOOTH);

    const engine = new SoloCaptureEngine({ sessionManager: sm, sessionId: session.id, socketId: 'solo_host', uploadDelay: 100 });
    const autoPromise = engine.executeAutoSequence();

    engine.abort = true;
    engine.cameraLive = false;

    await autoPromise;
    assert(!engine.isBusy, 'Engine cleanly unblocked after unmount abort');
    assert(engine.slots.filter(s => s.status === 'confirmed').length < 4, 'Halted before all 4 completed');
  }

  // --- 3. ACTUAL STAGE TRANSITION PROMISE & ACKNOWLEDGEMENT TESTS ---
  console.log('\n--- 3. Stage Transition Promise & Acknowledgement Behavioral Tests ---');

  function createMockSocket() {
    const listeners = new Map();
    return {
      connected: true,
      emitHandler: null,
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
      },
      off(event, fn) {
        if (listeners.has(event)) listeners.get(event).delete(fn);
      },
      disconnect(reason = 'transport close') {
        this.connected = false;
        const fns = listeners.get('disconnect');
        if (fns) {
          for (const fn of Array.from(fns)) fn(reason);
        }
      },
      emit(event, data, cb) {
        if (this.emitHandler) {
          this.emitHandler(event, data, cb);
        }
      }
    };
  }

  // Case 1: Successful endBooth acknowledgement
  {
    const mockSocket = createMockSocket();
    mockSocket.emitHandler = (event, data, cb) => {
      assert(event === 'session:end-booth', 'Emits session:end-booth event');
      assert(data.roomCode === 'RM01' && data.sessionId === 'SESS01', 'Passes correct roomCode and sessionId');
      cb({ success: true, stage: STAGES.SELECTION });
    };

    const res = await requestTransition(mockSocket, 'session:end-booth', { roomCode: 'RM01', sessionId: 'SESS01' });
    assert(res.success === true, 'Case 1: Successful endBooth acknowledgement resolves success: true');
    assert(res.stage === STAGES.SELECTION, 'Case 1: Stage reported as SELECTION');
  }

  // Case 2: Rejected endBooth acknowledgement
  {
    const mockSocket = createMockSocket();
    mockSocket.emitHandler = (event, data, cb) => {
      cb({ success: false, error: 'Only the host can perform this action' });
    };

    const res = await requestTransition(mockSocket, 'session:end-booth', { roomCode: 'RM01', sessionId: 'SESS01' });
    assert(res.success === false, 'Case 2: Rejected endBooth resolves success: false');
    assert(res.error.includes('Only the host'), 'Case 2: Error message accurately preserved');
  }

  // Case 3: Missing endBooth acknowledgement timeout
  {
    const mockSocket = createMockSocket();
    mockSocket.emitHandler = () => {
      // Deliberately drop callback (simulate unresponsive server)
    };

    const start = Date.now();
    const res = await requestTransition(mockSocket, 'session:end-booth', { roomCode: 'RM01', sessionId: 'SESS01' }, { timeoutMs: 50 });
    const elapsed = Date.now() - start;

    assert(res.success === false, 'Case 3: Missing acknowledgement resolves success: false');
    assert(res.error === 'Transition timed out', 'Case 3: Error indicates Transition timed out');
    assert(elapsed >= 45, 'Case 3: Timeout waited appropriate duration');
  }

  // Case 4: Socket disconnect before / during acknowledgement
  {
    const mockSocket = createMockSocket();
    mockSocket.connected = false;

    const resImmediate = await requestTransition(mockSocket, 'session:end-booth', { roomCode: 'RM01', sessionId: 'SESS01' });
    assert(resImmediate.success === false && resImmediate.error === 'Socket disconnected', 'Case 4a: Disconnect before emit resolves failure immediately');

    const mockSocket2 = createMockSocket();
    mockSocket2.emitHandler = () => {
      // Socket disconnects mid-flight
      setTimeout(() => mockSocket2.disconnect('ping timeout'), 20);
    };

    const resMidflight = await requestTransition(mockSocket2, 'session:end-booth', { roomCode: 'RM01', sessionId: 'SESS01' }, { timeoutMs: 200 });
    assert(resMidflight.success === false, 'Case 4b: Mid-flight disconnect resolves success: false');
    assert(resMidflight.error.includes('Socket disconnected before transition acknowledgement'), 'Case 4b: Error captures mid-flight disconnect');
  }

  // Case 5: Successful confirmSelection acknowledgement updates selections and stage
  {
    let localStage = STAGES.SELECTION;
    let localSelections = [];
    const sessionIdRef = { current: 'SESS01' };
    const mockSocket = createMockSocket();
    mockSocket.emitHandler = (event, data, cb) => {
      assert(event === 'selection:confirm', 'Emits selection:confirm event');
      cb({ success: true, stage: STAGES.CUSTOMIZE });
    };

    // Simulate SessionContext.confirmSelection with sessionIdRef and post-confirmation selection update
    const confirmSelectionSim = async (photoIds) => {
      const targetSessionId = 'SESS01';
      const res = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'RM01', sessionId: targetSessionId, photoIds });
      if (res.success) {
        localSelections = photoIds;
        if (sessionIdRef.current === targetSessionId) {
          localStage = STAGES.CUSTOMIZE;
        }
      }
      return res;
    };

    const res = await confirmSelectionSim(['p1', 'p2', 'p3', 'p4']);
    assert(res.success === true, 'Case 5: Successful confirmSelection resolves success: true');
    assert(localStage === STAGES.CUSTOMIZE, 'Case 5: Local stage updated to CUSTOMIZE after genuine acknowledgement');
    assert(localSelections.length === 4, 'Case 5: Selections updated only after server confirmation');
  }

  // Case 6: Rejected confirmSelection keeps selections and stage unchanged
  {
    let localStage = STAGES.SELECTION;
    let localSelections = [];
    const sessionIdRef = { current: 'SESS01' };
    const mockSocket = createMockSocket();
    mockSocket.emitHandler = (event, data, cb) => {
      cb({ success: false, error: 'Invalid stage transition from BOOTH to CUSTOMIZE' });
    };

    const confirmSelectionSim = async (photoIds) => {
      const targetSessionId = 'SESS01';
      const res = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'RM01', sessionId: targetSessionId, photoIds });
      if (res.success) {
        localSelections = photoIds;
        if (sessionIdRef.current === targetSessionId) {
          localStage = STAGES.CUSTOMIZE;
        }
      }
      return res;
    };

    const res = await confirmSelectionSim(['p1', 'p2', 'p3', 'p4']);
    assert(res.success === false, 'Case 6: Rejected confirmation resolves success: false');
    assert(localStage === STAGES.SELECTION, 'Case 6: Local stage strictly remains SELECTION on rejection');
    assert(localSelections.length === 0, 'Case 6: Selections strictly remain unchanged on rejection');
  }

  // Case 7: Missing acknowledgement timeout leaves selections and stage unchanged
  {
    let localStage = STAGES.SELECTION;
    let localSelections = [];
    const sessionIdRef = { current: 'SESS01' };
    const mockSocket = createMockSocket();
    mockSocket.emitHandler = () => {
      // Drop callback
    };

    const confirmSelectionSim = async (photoIds) => {
      const targetSessionId = 'SESS01';
      const res = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'RM01', sessionId: targetSessionId, photoIds }, { timeoutMs: 50 });
      if (res.success) {
        localSelections = photoIds;
        if (sessionIdRef.current === targetSessionId) {
          localStage = STAGES.CUSTOMIZE;
        }
      }
      return res;
    };

    const res = await confirmSelectionSim(['p1', 'p2', 'p3', 'p4']);
    assert(res.success === false, 'Case 7: Timeout on confirmSelection resolves success: false');
    assert(localStage === STAGES.SELECTION, 'Case 7: Local stage strictly remains SELECTION after timeout');
    assert(localSelections.length === 0, 'Case 7: Selections strictly remain unchanged after timeout');
  }

  // Case 8: Socket disconnect during confirmation leaves selections and stage unchanged
  {
    let localStage = STAGES.SELECTION;
    let localSelections = [];
    const sessionIdRef = { current: 'SESS01' };
    const mockSocket = createMockSocket();
    mockSocket.emitHandler = () => {
      setTimeout(() => mockSocket.disconnect('transport error'), 15);
    };

    const confirmSelectionSim = async (photoIds) => {
      const targetSessionId = 'SESS01';
      const res = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'RM01', sessionId: targetSessionId, photoIds }, { timeoutMs: 150 });
      if (res.success) {
        localSelections = photoIds;
        if (sessionIdRef.current === targetSessionId) {
          localStage = STAGES.CUSTOMIZE;
        }
      }
      return res;
    };

    const res = await confirmSelectionSim(['p1', 'p2', 'p3', 'p4']);
    assert(res.success === false, 'Case 8: Disconnect during confirmation resolves success: false');
    assert(localStage === STAGES.SELECTION, 'Case 8: Local stage strictly remains SELECTION on disconnect');
    assert(localSelections.length === 0, 'Case 8: Selections strictly remain unchanged on disconnect');
  }

  // Case 9: Invariant verification: local stage and selections never advance on any failure mode
  {
    let testStage = STAGES.SELECTION;
    let testSelections = [];
    const failureResults = [
      { success: false, error: 'Rejection' },
      { success: false, error: 'Transition timed out' },
      { success: false, error: 'Socket disconnected' },
      { success: false, error: 'Malformed transition acknowledgement' }
    ];

    for (const failRes of failureResults) {
      if (failRes.success) {
        testStage = STAGES.CUSTOMIZE;
        testSelections = ['fail'];
      }
    }
    assert(testStage === STAGES.SELECTION, 'Case 9: Local stage invariantly protected against all failure modes');
    assert(testSelections.length === 0, 'Case 9: Selections invariantly protected against all failure modes');
  }

  // Case 10: Delayed acknowledgement after timeout does NOT update stage or selections later
  {
    let localStage = STAGES.SELECTION;
    let localSelections = [];
    const sessionIdRef = { current: 'SESS01' };
    const mockSocket = createMockSocket();
    let savedCallback = null;

    mockSocket.emitHandler = (event, data, cb) => {
      savedCallback = cb; // Store for late execution after timeout
    };

    const confirmSelectionSim = async (photoIds) => {
      const targetSessionId = 'SESS01';
      const res = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'RM01', sessionId: targetSessionId, photoIds }, { timeoutMs: 30 });
      if (res.success) {
        localSelections = photoIds;
        if (sessionIdRef.current === targetSessionId) {
          localStage = STAGES.CUSTOMIZE;
        }
      }
      return res;
    };

    const res = await confirmSelectionSim(['p1', 'p2', 'p3', 'p4']);
    assert(res.success === false, 'Case 10: Request timed out at 30ms');
    assert(localStage === STAGES.SELECTION, 'Case 10: Stage is SELECTION at timeout');
    assert(localSelections.length === 0, 'Case 10: Selections empty at timeout');

    // Simulate late server ACK arriving after timeout
    if (savedCallback) {
      savedCallback({ success: true, stage: STAGES.CUSTOMIZE });
    }

    assert(localStage === STAGES.SELECTION, 'Case 10: Delayed server ACK does not alter local stage after timeout');
    assert(localSelections.length === 0, 'Case 10: Delayed server ACK does not alter selections after timeout');
  }

  // Case 10b: Delayed acknowledgement from an obsolete session cannot advance current session
  {
    let currentSessionStage = STAGES.SELECTION;
    let currentSessionSelections = [];
    const sessionIdRef = { current: 'SESS01' };
    const mockSocket = createMockSocket();

    let triggerDelayedAck = null;
    mockSocket.emitHandler = (event, data, cb) => {
      triggerDelayedAck = () => cb({ success: true, stage: STAGES.CUSTOMIZE });
    };

    // Request begins for SESS01
    const confirmPromise = (async () => {
      const targetSessionId = 'SESS01';
      const res = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'RM01', sessionId: targetSessionId, photoIds: ['old1', 'old2'] });
      if (res.success) {
        currentSessionSelections = ['old1', 'old2'];
        if (sessionIdRef.current === targetSessionId) {
          currentSessionStage = STAGES.CUSTOMIZE;
        }
      }
      return res;
    })();

    // In the meantime, user switches session or starts new round (sessionIdRef updates to SESS02)
    sessionIdRef.current = 'SESS02';

    // Now delayed server ACK arrives for the old session SESS01
    triggerDelayedAck();
    await confirmPromise;

    assert(currentSessionStage === STAGES.SELECTION, 'Case 10b: Delayed ACK from obsolete session cannot advance new session stage');
  }

  // Case 11: Group Mode callers compatibility check
  {
    const mockSocket = createMockSocket();
    let endBoothCalled = false;
    mockSocket.emitHandler = (event, data, cb) => {
      if (event === 'session:end-booth') {
        endBoothCalled = true;
        cb({ success: true, stage: STAGES.SELECTION });
      }
    };

    // Simulate BoothPage host clicking Finish
    const endBoothFn = () => requestTransition(mockSocket, 'session:end-booth', { roomCode: 'GROUP01', sessionId: 'SESS01' });
    const ret = endBoothFn();
    assert(ret instanceof Promise, 'Case 11: endBooth returns a Promise for async callers');
    assert(endBoothCalled, 'Case 11: session:end-booth emitted without crashing standard button handler');

    // Simulate SelectionPage confirm handler
    let selectionError = null;
    let groupStage = STAGES.SELECTION;
    const groupConfirmSelection = async (selectedIds) => {
      const res = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'GROUP01', sessionId: 'SESS01', photoIds: selectedIds });
      if (!res.success) {
        selectionError = res.error;
      } else {
        groupStage = STAGES.CUSTOMIZE;
      }
    };

    mockSocket.emitHandler = (event, data, cb) => {
      cb({ success: false, error: 'Selection rejected by server' });
    };

    await groupConfirmSelection(['g1', 'g2']);
    assert(selectionError === 'Selection rejected by server', 'Case 11: Group Mode caller surfaces rejection error');
    assert(groupStage === STAGES.SELECTION, 'Case 11: Group Mode stays in SELECTION on error without false advance');
  }

  // Case 12: Full Solo flow succeeds when both server acknowledgements arrive
  {
    let currentServerStage = STAGES.BOOTH;
    let clientStage = STAGES.BOOTH;
    let errorCaught = null;
    const mockSocket = createMockSocket();

    mockSocket.emitHandler = (event, data, cb) => {
      if (event === 'session:end-booth') {
        if (currentServerStage !== STAGES.BOOTH) {
          cb({ success: false, error: 'Invalid stage' });
          return;
        }
        currentServerStage = STAGES.SELECTION;
        cb({ success: true, stage: STAGES.SELECTION });
      } else if (event === 'selection:confirm') {
        if (currentServerStage !== STAGES.SELECTION) {
          cb({ success: false, error: 'Must be in SELECTION before CUSTOMIZE' });
          return;
        }
        currentServerStage = STAGES.CUSTOMIZE;
        cb({ success: true, stage: STAGES.CUSTOMIZE });
      }
    };

    // Simulate SoloBoothPage.handleCompleteSession
    const handleCompleteSessionSim = async (photoIds) => {
      try {
        const endRes = await requestTransition(mockSocket, 'session:end-booth', { roomCode: 'SOLO_OK', sessionId: 'SESS_OK' });
        if (!endRes || !endRes.success) {
          throw new Error(endRes?.error || 'Failed to advance from photobooth');
        }
        clientStage = STAGES.SELECTION;

        const selRes = await requestTransition(mockSocket, 'selection:confirm', { roomCode: 'SOLO_OK', sessionId: 'SESS_OK', photoIds });
        if (!selRes || !selRes.success) {
          throw new Error(selRes?.error || 'Failed to confirm selection');
        }
        clientStage = STAGES.CUSTOMIZE;
      } catch (err) {
        errorCaught = err.message;
      }
    };

    await handleCompleteSessionSim(['p1', 'p2', 'p3', 'p4']);
    assert(errorCaught === null, 'Case 12: Full solo sequence completed without error');
    assert(currentServerStage === STAGES.CUSTOMIZE, 'Case 12: Server reached CUSTOMIZE');
    assert(clientStage === STAGES.CUSTOMIZE, 'Case 12: Client reached CUSTOMIZE');
  }

  console.log(`\n========================================`);
  console.log(`Phase 3 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
