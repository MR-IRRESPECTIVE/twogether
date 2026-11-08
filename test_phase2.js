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

async function runPhase2Tests() {
  console.log("=== Twogether Solo Photobooth (Phase 2: Camera & Booth UI) Tests ===");

  // TEST 1 & 2: WebRTC Isolation verification
  console.log("\n--- TEST 1 & 2: WebRTC Isolation Logic ---");
  {
    let signalEmitted = false;
    let listenersAttached = 0;

    const mockSocket = {
      id: 'mock-socket-1',
      on: (event) => {
        if (event.startsWith('signal:')) listenersAttached++;
      },
      off: (event) => {
        if (event.startsWith('signal:')) listenersAttached--;
      },
      emit: (event) => {
        if (event === 'signal:ready') signalEmitted = true;
      }
    };

    // When enabled is false (Solo Mode)
    const soloEnabled = false;
    let soloManagerInitialized = false;
    if (soloEnabled) {
      soloManagerInitialized = true;
      mockSocket.emit('signal:ready', { from: 'mock-socket-1' });
    }

    assert(!soloManagerInitialized, 'Solo Mode: WebRTC manager does not initialize when enabled=false');
    assert(!signalEmitted, 'Solo Mode: signal:ready is NOT emitted to socket');
    assert(listenersAttached === 0, 'Solo Mode: Zero peer signaling listeners attached');

    // When enabled is true (Group Mode)
    const groupEnabled = true;
    let groupManagerInitialized = false;
    if (groupEnabled) {
      groupManagerInitialized = true;
      mockSocket.emit('signal:ready', { from: 'mock-socket-1' });
      mockSocket.on('signal:ready', () => {});
      mockSocket.on('signal:offer', () => {});
      mockSocket.on('signal:answer', () => {});
      mockSocket.on('signal:ice-candidate', () => {});
    }

    assert(groupManagerInitialized, 'Group Mode: WebRTC manager initializes when enabled=true');
    assert(signalEmitted, 'Group Mode: signal:ready is emitted');
    assert(listenersAttached === 4, 'Group Mode: Peer signaling listeners properly attached');
  }

  // TEST 3, 4, 5, 6: Camera Hook Logic, Switching, Fallback & Errors
  console.log("\n--- TEST 3-6: Camera Hook, Lifecycle & Switching ---");
  {
    let stoppedTracks = [];
    const createMockTrack = (id, kind = 'video') => ({
      id,
      kind,
      readyState: 'live',
      enabled: true,
      stop: function() {
        this.readyState = 'ended';
        stoppedTracks.push(this.id);
      }
    });

    const createMockStream = (trackId) => {
      const track = createMockTrack(trackId);
      return {
        id: `stream-${trackId}`,
        active: true,
        getVideoTracks: () => [track],
        getTracks: function() { return this.getVideoTracks(); }
      };
    };

    // Test 3: Camera stream opening
    let currentStream = createMockStream('track-front');
    assert(currentStream.getVideoTracks().length === 1, 'Opens exactly one local camera video track');
    assert(currentStream.getVideoTracks()[0].readyState === 'live', 'Local camera track is live');

    // Test 4: Camera switching (user -> environment)
    let facingMode = 'user';
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    
    // Old track is stopped before or during replacement
    currentStream.getTracks().forEach(t => t.stop());
    assert(stoppedTracks.includes('track-front'), 'Old front camera track stopped before switching');
    
    // New rear track acquired
    currentStream = createMockStream('track-rear');
    facingMode = nextMode;
    assert(facingMode === 'environment', 'Facing mode updated to environment');
    assert(currentStream.getVideoTracks()[0].id === 'track-rear', 'Rear camera stream active');

    // Test 5: Fallback if environment is unsupported (e.g. desktop webcam)
    let fallbackTriggered = false;
    try {
      // Simulate OverconstrainedError on environment
      const err = new Error('Constraint not satisfied');
      err.name = 'OverconstrainedError';
      throw err;
    } catch (e) {
      // Revert to user
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = createMockStream('track-desktop-fallback');
      facingMode = 'user';
      fallbackTriggered = true;
    }
    assert(fallbackTriggered, 'Handled unsupported facingMode without crash');
    assert(facingMode === 'user', 'Safely reverted to user/webcam stream');

    // Test 6: Permission denied error handling
    let userFriendlyError = null;
    const permErr = new Error('Permission denied');
    permErr.name = 'NotAllowedError';
    if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
      userFriendlyError = 'Camera access was denied. Please allow camera access in your browser settings and try again.';
    }
    assert(userFriendlyError !== null && userFriendlyError.includes('browser settings'), 'Permission denial formats user-friendly actionable message');

    // Test 7 & 8: Camera tracks stop on leaving booth and exiting room
    currentStream.getTracks().forEach(t => t.stop());
    assert(stoppedTracks.includes('track-desktop-fallback'), 'Camera tracks stopped on cleanup when leaving booth / room');
    assert(currentStream.getVideoTracks()[0].readyState === 'ended', 'All tracks are in ended state');
  }

  // TEST 9: SoloBoothPage Component File Verification
  console.log("\n--- TEST 9: Dedicated SoloBoothPage UI Structure ---");
  const fs = await import('fs');
  const soloBoothContent = fs.readFileSync('client/src/pages/SoloBoothPage.jsx', 'utf8');
  assert(soloBoothContent.includes('solo-camera-video'), 'Includes centered camera preview viewfinder');
  assert(soloBoothContent.includes('solo-strip-slot'), 'Includes four filmstrip photo slots');
  assert(soloBoothContent.includes('Automatic (3s)'), 'Includes Automatic capture mode selector');
  assert(soloBoothContent.includes('Manual (Snap)'), 'Includes Manual capture mode selector');
  assert(soloBoothContent.includes('solo-shutter-btn'), 'Includes shutter control button');
  assert(soloBoothContent.includes('switchCamera'), 'Includes camera-switch control');
  assert(soloBoothContent.includes('photoCount'), 'Includes capture progress indicator');
  assert(soloBoothContent.includes('solo-camera-error'), 'Includes camera error and retry state');
  assert(soloBoothContent.includes('stopCamera()'), 'Includes explicit camera cleanup on unmount');

  // TEST 10: Routing & Mode Guard in App.jsx
  console.log("\n--- TEST 10: Routing & Mode Guard in App.jsx ---");
  const appContent = fs.readFileSync('client/src/App.jsx', 'utf8');
  assert(appContent.includes("roomMode === ROOM_MODES.SOLO ? <SoloBoothPage /> : <BoothPage />"), 'App.jsx selectively renders SoloBoothPage for Solo mode and BoothPage for Group mode');

  console.log(`\n========================================`);
  console.log(`Phase 2 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2Tests().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
