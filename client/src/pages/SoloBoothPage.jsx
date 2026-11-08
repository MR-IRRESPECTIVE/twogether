import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMedia } from '../context/MediaContext';
import { useRoom } from '../context/RoomContext';
import { useSession } from '../context/SessionContext';
import FilterSelector from '../components/booth/FilterSelector';
import { captureFrame } from '../lib/capture';
import layouts from '../data/layouts.json';
import { socket } from '../lib/socket';
import './SoloBoothPage.css';

export default function SoloBoothPage() {
  const {
    stream,
    error: cameraError,
    isReady: isCameraReady,
    retry: retryCamera,
    stopCamera,
    startCamera,
    switchCamera,
    facingMode,
    hasMultipleCameras
  } = useMedia();

  const { roomCode } = useRoom();
  const {
    sessionId,
    layoutId,
    uploadPhoto,
    endBooth,
    confirmSelection,
    photos
  } = useSession();

  const videoRef = useRef(null);

  // Layout aspect ratio matching selected layout
  const layout = layouts.find(l => l.id === layoutId) || layouts[0];
  const targetSlotAspect = (layout.photoSlots && layout.photoSlots[0])
    ? layout.photoSlots[0].width / layout.photoSlots[0].height
    : 1.333;

  // 4 Filmstrip slots with revision tracking and backup preservation
  const [slots, setSlots] = useState([
    { id: null, dataUrl: null, status: 'empty', error: null, metadata: null, revision: 1, previousPhoto: null },
    { id: null, dataUrl: null, status: 'empty', error: null, metadata: null, revision: 1, previousPhoto: null },
    { id: null, dataUrl: null, status: 'empty', error: null, metadata: null, revision: 1, previousPhoto: null },
    { id: null, dataUrl: null, status: 'empty', error: null, metadata: null, revision: 1, previousPhoto: null }
  ]);

  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [captureMode, setCaptureMode] = useState('auto'); // 'auto' | 'manual'
  const [selectedFilter, setSelectedFilter] = useState('none');
  const [countdown, setCountdown] = useState(null); // null | 3 | 2 | 1
  const [isFlashing, setIsFlashing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [generalError, setGeneralError] = useState(null);

  // Synchronous refs for race condition and stale-closure prevention
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const isBusyRef = useRef(false);
  const isCompletingRef = useRef(false);
  const abortLoopRef = useRef(false);
  const activeTimersRef = useRef(new Set());
  const isMountedRef = useRef(true);
  const streamRef = useRef(stream);
  streamRef.current = stream;
  const facingModeRef = useRef(facingMode);
  facingModeRef.current = facingMode;
  const filterRef = useRef(selectedFilter);
  filterRef.current = selectedFilter;

  // Timer helpers with unmount tracking
  const registerTimeout = useCallback((fn, delayMs) => {
    const id = setTimeout(() => {
      activeTimersRef.current.delete(id);
      fn();
    }, delayMs);
    activeTimersRef.current.add(id);
    return id;
  }, []);

  const clearAllTimers = useCallback(() => {
    activeTimersRef.current.forEach(id => clearTimeout(id));
    activeTimersRef.current.clear();
  }, []);

  // Update a single slot in state and ref
  const updateSlot = useCallback((index, partial) => {
    setSlots(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...partial };
      slotsRef.current = next;
      return next;
    });
  }, []);

  // Sync active slot photos from session on reconnect or mount
  useEffect(() => {
    if (!photos || photos.length === 0) return;
    setSlots(prev => {
      let changed = false;
      const next = [...prev];
      photos.forEach(p => {
        const sIdx = p.metadata?.slotIndex;
        if (sIdx !== undefined && sIdx >= 0 && sIdx < 4) {
          const current = next[sIdx];
          const remoteRev = p.metadata?.revision || 1;
          if (current.status === 'empty' || (current.status === 'confirmed' && remoteRev > (current.revision || 1))) {
            next[sIdx] = {
              id: p.id,
              dataUrl: p.url,
              status: 'confirmed',
              revision: remoteRev,
              metadata: p.metadata,
              error: null,
              previousPhoto: null
            };
            changed = true;
          }
        }
      });
      if (changed) {
        slotsRef.current = next;
        return next;
      }
      return prev;
    });
  }, [photos]);

  // Ensure camera starts when entering booth if inactive
  useEffect(() => {
    const isLive = stream && stream.getVideoTracks().some(t => t.readyState === 'live');
    if (!isLive && typeof startCamera === 'function') {
      startCamera().catch(() => {});
    }
  }, [stream, startCamera]);

  // Clean up camera hardware tracks and timers when leaving the booth
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      console.log('[SOLO_BOOTH] Leaving booth: cleanup');
      isMountedRef.current = false;
      abortLoopRef.current = true;
      isCompletingRef.current = false;
      clearAllTimers();
      if (typeof stopCamera === 'function') {
        stopCamera();
      }
    };
  }, [stopCamera, clearAllTimers]);

  // Attach media stream to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.srcObject = stream || null;
      if (stream) {
        videoRef.current.play().catch(err => {
          console.warn('[SOLO_BOOTH] Video play interrupted:', err);
        });
      }
    }
  }, [stream]);

  // Listen for hardware camera track disconnection
  useEffect(() => {
    const tracks = stream?.getVideoTracks() || [];
    const handleEnded = () => {
      console.warn('[SOLO_BOOTH] Video track disconnected/ended');
      abortLoopRef.current = true;
      clearAllTimers();
      setCountdown(null);
      setIsFlashing(false);
      setIsBusy(false);
      isBusyRef.current = false;
      setGeneralError('Camera stream disconnected. Please retry camera.');
    };
    tracks.forEach(t => t.addEventListener('ended', handleEnded));
    return () => {
      tracks.forEach(t => t.removeEventListener('ended', handleEnded));
    };
  }, [stream, clearAllTimers]);

  // Run 3-second countdown promise
  const runCountdown = useCallback(() => {
    return new Promise((resolve) => {
      let current = 3;
      setCountdown(3);

      const tick = () => {
        if (abortLoopRef.current || !isMountedRef.current) {
          setCountdown(null);
          resolve(false);
          return;
        }

        current -= 1;
        if (current > 0) {
          setCountdown(current);
          registerTimeout(tick, 1000);
        } else {
          // Count reaches 0: trigger flash and snapshot
          setCountdown(0);
          setIsFlashing(true);
          registerTimeout(() => {
            if (isMountedRef.current) setIsFlashing(false);
          }, 500);

          registerTimeout(() => {
            if (isMountedRef.current) setCountdown(null);
            resolve(!abortLoopRef.current && isMountedRef.current);
          }, 80);
        }
      };

      registerTimeout(tick, 1000);
    });
  }, [registerTimeout]);

  // Capture frame and upload for a specific slot (supporting new captures and retakes)
  const captureAndUploadSlot = useCallback(async (slotIdx, isRetake = false) => {
    if (!isMountedRef.current || abortLoopRef.current) return false;

    // Check camera track health before proceeding
    const tracks = streamRef.current?.getVideoTracks() || [];
    const isLive = tracks.some(t => t.readyState === 'live');
    if (!isLive) {
      setGeneralError('Camera stream unavailable. Please check your camera.');
      return false;
    }

    setGeneralError(null);

    const currentSlot = slotsRef.current[slotIdx];
    const nextRevision = isRetake ? (currentSlot.revision || 1) + 1 : (currentSlot.revision || 1);
    const prevBackup = (isRetake && currentSlot.status === 'confirmed')
      ? { id: currentSlot.id, dataUrl: currentSlot.dataUrl, metadata: currentSlot.metadata, revision: currentSlot.revision }
      : currentSlot.previousPhoto;

    updateSlot(slotIdx, { status: 'capturing', previousPhoto: prevBackup, error: null });

    // Step 1: 3-second countdown
    const countdownFinished = await runCountdown();
    if (!countdownFinished || !isMountedRef.current || abortLoopRef.current) {
      if (isRetake && prevBackup) {
        updateSlot(slotIdx, { status: 'confirmed', ...prevBackup, previousPhoto: null });
      } else {
        updateSlot(slotIdx, { status: 'empty', error: null });
      }
      return false;
    }

    // Step 2: Frame capture with selected filter and front/rear mirroring
    let captureResult;
    try {
      captureResult = await captureFrame([
        {
          stream: streamRef.current,
          filter: filterRef.current,
          mirrored: facingModeRef.current === 'user'
        }
      ], targetSlotAspect);
    } catch (err) {
      console.error('[SOLO_BOOTH] Capture frame failed:', err);
      updateSlot(slotIdx, { status: 'failed', error: 'Failed to capture frame' });
      return false;
    }

    if (!isMountedRef.current || abortLoopRef.current) return false;

    const capturedDataUrl = captureResult.dataUrl;
    // Globally unique photo ID per revision
    const uniquePhotoId = `${sessionId || 'solo'}_s${slotIdx}_r${nextRevision}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const meta = {
      id: uniquePhotoId,
      slotIndex: slotIdx,
      revision: nextRevision,
      capturedBy: socket?.id || 'solo_user',
      timestamp: Date.now()
    };

    // Step 3: Transition slot to uploading state (saving dataUrl locally for safe retry)
    updateSlot(slotIdx, {
      dataUrl: capturedDataUrl,
      metadata: meta,
      revision: nextRevision,
      status: 'uploading',
      error: null
    });

    // Step 4: Upload with server acknowledgement
    let uploadRes;
    try {
      uploadRes = await uploadPhoto(capturedDataUrl, meta);
    } catch (uErr) {
      uploadRes = { success: false, error: uErr?.message || 'Upload failed' };
    }

    if (!isMountedRef.current) return false;

    if (uploadRes?.success) {
      // Concurrency protection: discard delayed ACK if local slot has since moved to a newer revision
      if (uploadRes.revision && uploadRes.revision < slotsRef.current[slotIdx].revision) {
        console.warn(`[SOLO_BOOTH] Dropping delayed ACK for slot ${slotIdx + 1}: rev ${uploadRes.revision} < ${slotsRef.current[slotIdx].revision}`);
        return false;
      }

      const confirmedId = uploadRes.photoId || meta.id;
      updateSlot(slotIdx, {
        status: 'confirmed',
        id: confirmedId,
        dataUrl: capturedDataUrl,
        revision: nextRevision,
        metadata: meta,
        previousPhoto: null, // Successfully replaced
        error: null
      });
      return true;
    } else {
      console.warn(`[SOLO_BOOTH] Upload failed for Slot ${slotIdx + 1}:`, uploadRes?.error);
      updateSlot(slotIdx, {
        status: 'failed',
        error: uploadRes?.error || 'Upload acknowledgement failed'
      });
      return false;
    }
  }, [runCountdown, sessionId, targetSlotAspect, updateSlot, uploadPhoto]);

  // Complete session: transitions server BOOTH -> SELECTION -> CUSTOMIZE
  const handleCompleteSession = useCallback(async () => {
    if (isCompletingRef.current) return;

    const confirmedSlots = slotsRef.current.filter(s => s.status === 'confirmed' && s.id);
    if (confirmedSlots.length !== 4) {
      console.warn('[SOLO_BOOTH] Cannot complete session without 4 confirmed photos:', confirmedSlots.length);
      return;
    }

    isCompletingRef.current = true;
    setIsCompleting(true);
    setGeneralError(null);

    const photoIds = confirmedSlots.map(s => s.id);

    try {
      console.log('[SOLO_BOOTH] Transitioning BOOTH -> SELECTION');
      const endRes = await endBooth();
      if (!endRes || !endRes.success) {
        throw new Error(endRes?.error || 'Failed to advance from photobooth. Please retry.');
      }

      console.log('[SOLO_BOOTH] Transitioning SELECTION -> CUSTOMIZE with photos:', photoIds);
      const selRes = await confirmSelection(photoIds);
      if (!selRes || !selRes.success) {
        throw new Error(selRes?.error || 'Failed to confirm selection. Please retry.');
      }
    } catch (err) {
      console.error('[SOLO_BOOTH] Error advancing to customization:', err);
      isCompletingRef.current = false;
      setIsCompleting(false);
      setGeneralError(err.message || 'Failed to transition to customization. Please try again.');
    }
  }, [confirmSelection, endBooth]);

  // Automatic sequence loop
  const executeAutoSequence = useCallback(async () => {
    if (isBusyRef.current || isCompleting) return;

    // Find first unconfirmed slot
    const startIndex = slotsRef.current.findIndex(s => s.status !== 'confirmed');
    if (startIndex === -1) {
      // All 4 are already confirmed
      await handleCompleteSession();
      return;
    }

    isBusyRef.current = true;
    setIsBusy(true);
    abortLoopRef.current = false;

    for (let i = startIndex; i < 4; i++) {
      if (abortLoopRef.current || !isMountedRef.current) break;
      if (slotsRef.current[i].status === 'confirmed') continue;

      setActiveSlotIndex(i);
      const success = await captureAndUploadSlot(i);

      if (!success) {
        console.log(`[SOLO_BOOTH] Auto sequence halted at Slot ${i + 1}`);
        abortLoopRef.current = true;
        break;
      }

      // Brief 600ms pause between shots for user visibility
      if (i < 3) {
        await new Promise(r => registerTimeout(r, 600));
      }
    }

    if (isMountedRef.current) {
      const allConfirmed = slotsRef.current.every(s => s.status === 'confirmed');
      if (allConfirmed) {
        await handleCompleteSession();
      }
      isBusyRef.current = false;
      setIsBusy(false);
    }
  }, [captureAndUploadSlot, handleCompleteSession, isCompleting, registerTimeout]);

  // Manual snap handler
  const handleManualCapture = useCallback(async () => {
    if (isBusyRef.current || isCompleting) return;

    const nextIndex = slotsRef.current.findIndex(s => s.status !== 'confirmed');
    if (nextIndex === -1) return;

    isBusyRef.current = true;
    setIsBusy(true);
    abortLoopRef.current = false;
    setActiveSlotIndex(nextIndex);

    const success = await captureAndUploadSlot(nextIndex);

    if (isMountedRef.current) {
      if (success) {
        const allConfirmed = slotsRef.current.every(s => s.status === 'confirmed');
        if (allConfirmed) {
          await handleCompleteSession();
        }
      }
      isBusyRef.current = false;
      setIsBusy(false);
    }
  }, [captureAndUploadSlot, handleCompleteSession, isCompleting]);

  // Retake an individual confirmed slot
  const handleRetakeSlot = useCallback(async (slotIdx) => {
    if (isBusyRef.current || isCompleting) return;
    const slot = slotsRef.current[slotIdx];
    if (!slot || slot.status !== 'confirmed') return;

    isBusyRef.current = true;
    setIsBusy(true);
    abortLoopRef.current = false;
    setActiveSlotIndex(slotIdx);
    setGeneralError(null);

    await captureAndUploadSlot(slotIdx, true);

    if (isMountedRef.current) {
      isBusyRef.current = false;
      setIsBusy(false);
    }
  }, [captureAndUploadSlot, isCompleting]);

  // Revert a failed retake back to the previously confirmed photo
  const handleRevertSlot = useCallback((slotIdx) => {
    if (isBusyRef.current || isCompleting) return;
    const slot = slotsRef.current[slotIdx];
    if (!slot || !slot.previousPhoto) return;

    const prev = slot.previousPhoto;
    updateSlot(slotIdx, {
      status: 'confirmed',
      id: prev.id,
      dataUrl: prev.dataUrl,
      revision: prev.revision,
      metadata: prev.metadata,
      previousPhoto: null,
      error: null
    });
    setGeneralError(null);
  }, [isCompleting, updateSlot]);

  // Retry an individual failed slot upload (reuses exact original captured image and metadata)
  const handleRetrySlot = useCallback(async (slotIdx) => {
    if (isBusyRef.current || isCompleting) return;

    const slot = slotsRef.current[slotIdx];
    if (!slot || slot.status !== 'failed' || !slot.dataUrl || !slot.metadata) return;

    isBusyRef.current = true;
    setIsBusy(true);
    setGeneralError(null);
    updateSlot(slotIdx, { status: 'uploading', error: null });

    let uploadRes;
    try {
      // Idempotent retry: reuses exact same image and metadata (ID and revision)
      uploadRes = await uploadPhoto(slot.dataUrl, slot.metadata);
    } catch (err) {
      uploadRes = { success: false, error: err?.message || 'Retry failed' };
    }

    if (!isMountedRef.current) return;

    if (uploadRes?.success) {
      const confirmedId = uploadRes.photoId || slot.metadata.id;
      updateSlot(slotIdx, {
        status: 'confirmed',
        id: confirmedId,
        previousPhoto: null,
        error: null
      });

      const allConfirmed = slotsRef.current.every(s => s.status === 'confirmed');
      if (allConfirmed && !slot.previousPhoto) {
        await handleCompleteSession();
      } else if (captureMode === 'auto' && !slot.previousPhoto) {
        // Resume auto sequence for subsequent slots
        isBusyRef.current = false;
        setIsBusy(false);
        executeAutoSequence();
        return;
      }
    } else {
      updateSlot(slotIdx, {
        status: 'failed',
        error: uploadRes?.error || 'Retry upload failed'
      });
    }

    isBusyRef.current = false;
    setIsBusy(false);
  }, [captureMode, executeAutoSequence, handleCompleteSession, isCompleting, updateSlot, uploadPhoto]);

  // Primary Shutter button click
  const handleShutterClick = () => {
    if (isBusy || isCompleting || !isCameraReady || !!cameraError) return;

    if (isSequenceComplete) {
      handleCompleteSession();
      return;
    }

    if (captureMode === 'auto') {
      executeAutoSequence();
    } else {
      handleManualCapture();
    }
  };

  const handleCameraSwitch = () => {
    if (isBusy || isCompleting) return;
    if (typeof switchCamera === 'function') {
      switchCamera();
    }
  };

  const confirmedCount = slots.filter(s => s.status === 'confirmed').length;
  const photoCount = confirmedCount;
  const isSequenceComplete = confirmedCount === 4;
  const hasFailedSlot = slots.some(s => s.status === 'failed');

  return (
    <div className="solo-booth-container">
      <header className="solo-booth-header">
        <h1 className="solo-booth-title">Solo Photobooth</h1>
        <div className="solo-progress-badge">
          {confirmedCount} / 4 PHOTOS
        </div>
      </header>

      {generalError && (
        <div className="solo-banner-error" role="alert">
          <span>⚠️ {generalError}</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isSequenceComplete && !isCompleting && (
              <button
                type="button"
                onClick={handleCompleteSession}
                className="solo-retry-btn"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              >
                Retry Advance
              </button>
            )}
            <button type="button" onClick={() => setGeneralError(null)} className="solo-banner-dismiss">
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="solo-booth-content">
        {/* Viewfinder Area */}
        <section className="solo-viewfinder-section">
          <div className="solo-viewfinder-box">
            {cameraError ? (
              <div className="solo-camera-error">
                <span style={{ fontSize: '2rem' }}>📷</span>
                <p>{cameraError}</p>
                <button type="button" className="solo-retry-btn" onClick={retryCamera}>
                  RETRY CAMERA
                </button>
              </div>
            ) : !isCameraReady ? (
              <div className="solo-camera-loading">
                <span style={{ fontSize: '2rem' }}>⏳</span>
                <p>Starting camera...</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ filter: selectedFilter }}
                  className={`solo-camera-video ${facingMode === 'user' ? 'mirrored' : ''}`}
                />

                {/* Live Countdown Overlay */}
                {countdown !== null && (
                  <div className="solo-countdown-overlay" aria-live="assertive">
                    <span className="solo-countdown-number">{countdown}</span>
                  </div>
                )}

                {/* Flash Animation */}
                {isFlashing && <div className="solo-flash-overlay" />}

                {/* Transitioning Overlay */}
                {isCompleting && (
                  <div className="solo-completing-overlay">
                    <div className="solo-spinner" />
                    <p>Preparing your strip customization...</p>
                  </div>
                )}

                {/* Camera Flip Control */}
                {(hasMultipleCameras || typeof switchCamera === 'function') && (
                  <button
                    type="button"
                    className="solo-camera-switch-btn"
                    onClick={handleCameraSwitch}
                    disabled={isBusy || isCompleting}
                    title="Switch camera"
                    aria-label="Switch between front and rear cameras"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 1.956.702 3.748 1.87 5.14" />
                      <path d="M4 14c0 4.418 3.582 8 8 8s8-3.582 8-8c0-1.956-.702-3.748-1.87-5.14" />
                      <polyline points="20 4 20 10 14 10" />
                      <polyline points="4 20 4 14 10 14" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>

          {/* Filter Bar */}
          <div className="solo-filter-container">
            <FilterSelector currentFilter={selectedFilter} setFilter={setSelectedFilter} />
          </div>
        </section>

        {/* Filmstrip Slots & Controls Panel */}
        <aside className="solo-controls-panel">
          {/* Filmstrip Preview Slots */}
          <div className="solo-filmstrip-preview" aria-label="Photo strip slots">
            {slots.map((slot, idx) => {
              const isCurrent = activeSlotIndex === idx && (isBusy || countdown !== null);
              return (
                <div
                  key={idx}
                  className={`solo-strip-slot ${slot.status} ${isCurrent ? 'active' : ''}`}
                  title={`Slot ${idx + 1}: ${slot.status}`}
                >
                  {slot.dataUrl ? (
                    <img
                      src={slot.dataUrl}
                      alt={`Captured photo ${idx + 1}`}
                      className="solo-strip-thumbnail"
                    />
                  ) : null}

                  {slot.status === 'empty' && (
                    <span className="solo-slot-label">Slot {idx + 1}</span>
                  )}

                  {slot.status === 'capturing' && (
                    <div className="solo-slot-badge capturing">
                      <span>📸 Snap</span>
                    </div>
                  )}

                  {slot.status === 'uploading' && (
                    <div className="solo-slot-badge uploading">
                      <div className="solo-slot-spinner" />
                      <span>Syncing</span>
                    </div>
                  )}

                  {slot.status === 'confirmed' && (
                    <div className="solo-slot-confirmed-overlay">
                      <div className="solo-slot-badge confirmed" title="Upload confirmed">
                        ✓
                      </div>
                      <button
                        type="button"
                        className="solo-slot-retake-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetakeSlot(idx);
                        }}
                        disabled={isBusy || isCompleting}
                        aria-label={`Retake photo ${idx + 1}`}
                      >
                        Retake
                      </button>
                    </div>
                  )}

                  {slot.status === 'failed' && (
                    <div className="solo-slot-failed-actions">
                      <span className="solo-failed-icon" title={slot.error || 'Upload failed'}>⚠️</span>
                      <div className="solo-slot-failed-buttons">
                        <button
                          type="button"
                          className="solo-slot-retry-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetrySlot(idx);
                          }}
                          disabled={isBusy || isCompleting}
                          aria-label={`Retry uploading photo ${idx + 1}`}
                        >
                          Retry
                        </button>
                        {slot.previousPhoto && (
                          <button
                            type="button"
                            className="solo-slot-revert-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRevertSlot(idx);
                            }}
                            disabled={isBusy || isCompleting}
                            aria-label={`Revert to previous photo ${idx + 1}`}
                          >
                            Revert
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Capture Mode Selector: Automatic vs Manual */}
          <div className="solo-mode-selector" role="radiogroup" aria-label="Capture Mode">
            <button
              type="button"
              className={`solo-mode-btn ${captureMode === 'auto' ? 'active' : ''}`}
              onClick={() => !isBusy && !isCompleting && setCaptureMode('auto')}
              disabled={isBusy || isCompleting}
              role="radio"
              aria-checked={captureMode === 'auto'}
            >
              Automatic (3s)
            </button>
            <button
              type="button"
              className={`solo-mode-btn ${captureMode === 'manual' ? 'active' : ''}`}
              onClick={() => !isBusy && !isCompleting && setCaptureMode('manual')}
              disabled={isBusy || isCompleting}
              role="radio"
              aria-checked={captureMode === 'manual'}
            >
              Manual (Snap)
            </button>
          </div>

          {/* Shutter Button & Status */}
          <div className="solo-shutter-wrapper">
            <button
              type="button"
              className={`solo-shutter-btn ${isBusy ? 'busy' : ''}`}
              onClick={handleShutterClick}
              disabled={!isCameraReady || !!cameraError || isBusy || isCompleting || hasFailedSlot}
              aria-label={
                isCompleting
                  ? 'Completing session'
                  : isSequenceComplete
                    ? (generalError ? 'Retry advancing to customize' : 'Proceed to customize')
                    : hasFailedSlot
                      ? 'Please retry failed upload'
                      : captureMode === 'auto'
                        ? 'Start automatic sequence'
                        : `Capture photo ${confirmedCount + 1} of 4`
              }
            >
              <div className="solo-shutter-inner" />
            </button>

            <span className="solo-shutter-label">
              {isCompleting
                ? 'Processing Strip...'
                : isSequenceComplete
                  ? (generalError ? 'Retry Advance' : 'Proceed to Customize')
                  : hasFailedSlot
                    ? 'Retry Failed Photo'
                    : isBusy
                      ? 'Capturing...'
                      : captureMode === 'auto'
                        ? 'Start Sequence'
                        : `Snap Photo ${confirmedCount + 1}/4`}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
