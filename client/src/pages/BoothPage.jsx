import React, { useState, useEffect } from 'react';
import { useRoom } from '../context/RoomContext';
import { useSession } from '../context/SessionContext';
import { useMedia } from '../context/MediaContext';
import { socket } from '../lib/socket';
import CameraGrid from '../components/booth/CameraGrid';
import FilterSelector from '../components/booth/FilterSelector';
import PhotoCounter from '../components/booth/PhotoCounter';
import CaptureButton from '../components/booth/CaptureButton';
import CountdownOverlay from '../components/ui/CountdownOverlay';
import { captureFrame } from '../lib/capture';
import { MAX_PHOTOS_PER_SESSION } from '@shared/constants.js';
import layouts from '../data/layouts.json';

export default function BoothPage() {
  const { isHost, participants, roomCode, myId } = useRoom();
  const { photos, startCountdown, endBooth, sessionId, layoutId, uploadPhoto, pendingUploads, requestAllPhotos } = useSession();

  const [unconfirmedUploads, setUnconfirmedUploads] = useState([]);
  const [retryingId, setRetryingId] = useState(null);

  const layout = layouts.find(l => l.id === layoutId) || layouts[0];
  const targetSlotAspect = (layout.photoSlots && layout.photoSlots[0])
    ? layout.photoSlots[0].width / layout.photoSlots[0].height
    : 1.333;

  const { stream: localStream, remoteStreams } = useMedia();

  const [filterCss, setFilterCss] = useState('none');

  useEffect(() => {
    if (roomCode) {
      socket.emit('room:filter-change', { roomCode, filterCss });
    }
  }, [filterCss, roomCode]);

  const [isCounting, setIsCounting] = useState(false);
  const [countdownVal, setCountdownVal] = useState(3);

  useEffect(() => {
    const onCountdown = () => {
      console.log("[CAPTURE][COUNTDOWN-START]");
      setCountdownVal(3);
      setIsCounting(true);
    };
    socket.on('countdown:start', onCountdown);
    return () => socket.off('countdown:start', onCountdown);
  }, []);

  const handleCaptureTrigger = () => {
    console.log("[CAPTURE][HANDLER]", {
      isHost,
      participantCount: participants?.length,
      photoCount: photos.length,
      selectedFilter: filterCss
    });
    startCountdown();
  };

  const onFlash = () => {
    console.log("[CAPTURE][FLASH]");
    console.log("[CAPTURE][STREAMS]", {
      localStreamReady: !!localStream,
      remoteStreamCount: remoteStreams?.size,
      participants: participants?.length
    });

    // Allow the 0.5s flash animation to play before unmounting the overlay
    setTimeout(() => {
      setIsCounting(false);
    }, 500);

    const captureItems = [];
    if (localStream) {
      captureItems.push({ stream: localStream, filter: filterCss });
    }
    remoteStreams.forEach((stream, id) => {
      const p = participants.find(part => part.id === id);
      captureItems.push({ stream, filter: p ? p.filter : 'none' });
    });

    if (captureItems.length > 0 && isHost) {
      console.log("Host is capturing frame...", captureItems.length, "items");
      captureFrame(captureItems, targetSlotAspect).then(async ({ dataUrl }) => {
        console.log("Frame captured! Emitting photo:upload...");
        const meta = { id: Date.now().toString(), capturedBy: socket.id, timestamp: Date.now() };
        if (typeof uploadPhoto === 'function') {
          const res = await uploadPhoto(dataUrl, meta);
          if (!res?.success) {
            console.error("Photo upload unconfirmed:", res?.error);
            setUnconfirmedUploads(prev => [...prev.filter(u => u.meta.id !== meta.id), { dataUrl, meta, error: res?.error }]);
          } else {
            setUnconfirmedUploads(prev => prev.filter(u => u.meta.id !== meta.id));
          }
        } else {
          socket.emit('photo:upload', {
            sessionId,
            photoData: dataUrl,
            metadata: meta
          });
        }
      }).catch(err => {
        console.error("CAPTURE FRAME FAILED:", err);
      });
    }
  };

  const handleRetryUpload = async (item) => {
    if (!item) return;
    setRetryingId(item.meta.id);
    const res = await uploadPhoto(item.dataUrl, item.meta);
    setRetryingId(null);
    if (res?.success) {
      setUnconfirmedUploads(prev => prev.filter(u => u.meta.id !== item.meta.id));
    } else {
      setUnconfirmedUploads(prev => prev.map(u => u.meta.id === item.meta.id ? { ...u, error: res?.error } : u));
    }
  };

  const handleSyncWithServer = async () => {
    if (typeof requestAllPhotos === 'function') {
      const res = await requestAllPhotos();
      if (res?.success && res.photos) {
        const serverIds = new Set(res.photos.map(p => p.metadata?.id || p.id));
        setUnconfirmedUploads(prev => prev.filter(u => !serverIds.has(u.meta.id)));
      }
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      backgroundColor: 'var(--near-black)',
      color: 'var(--cream)',
      position: 'relative'
    }}>
      {isCounting && (
        <CountdownOverlay
          duration={countdownVal}
          onFlash={onFlash}
        />
      )}

      {/* Main Camera Area */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        position: 'relative',
        width: '100%',
        minHeight: 0
      }}>
        <CameraGrid
          localStream={localStream}
          remoteStreams={remoteStreams}
          myId={myId}
          myFilterCss={filterCss}
          participants={participants || []}
          targetSlotAspect={targetSlotAspect}
        />
      </div>

      {/* Unconfirmed Upload Warning Banner */}
      {unconfirmedUploads.length > 0 && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.2)',
          borderTop: '1px solid rgba(239, 68, 68, 0.4)',
          color: '#fca5a5',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.85rem',
          gap: '12px',
          flexWrap: 'wrap',
          zIndex: 10
        }}>
          <span>
            ⚠️ {unconfirmedUploads.length} photo upload could not be confirmed ({unconfirmedUploads[0].error || 'network issue'}).
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => handleRetryUpload(unconfirmedUploads[0])}
              disabled={retryingId === unconfirmedUploads[0].meta.id || pendingUploads > 0}
              style={{
                padding: '4px 10px',
                backgroundColor: 'var(--soft-blue)',
                color: 'var(--white)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: (retryingId === unconfirmedUploads[0].meta.id || pendingUploads > 0) ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
                fontWeight: 'bold'
              }}
            >
              {retryingId === unconfirmedUploads[0].meta.id ? 'RETRYING...' : 'RETRY UPLOAD'}
            </button>
            <button
              onClick={handleSyncWithServer}
              disabled={pendingUploads > 0}
              style={{
                padding: '4px 10px',
                backgroundColor: 'transparent',
                color: 'var(--cream)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: 'var(--radius-sm)',
                cursor: pendingUploads > 0 ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem'
              }}
            >
              SYNC WITH SERVER
            </button>
          </div>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div style={{
        height: 'auto',
        minHeight: '80px',
        backgroundColor: 'var(--near-black)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderTop: '1px solid rgba(123, 158, 196, 0.3)', // soft-blue with opacity
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ flex: '1 1 auto', minWidth: '100px' }}>
          <FilterSelector currentFilter={filterCss} setFilter={setFilterCss} />
        </div>

        <div style={{ flex: '1 1 100%', display: 'flex', justifyContent: 'center', order: -1, marginBottom: '8px' }}>
          <CaptureButton onClick={handleCaptureTrigger} disabled={photos.length >= MAX_PHOTOS_PER_SESSION} />
        </div>

        <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '16px', minWidth: '100px' }}>
          <PhotoCounter count={photos.length} max={MAX_PHOTOS_PER_SESSION} />
          {isHost && (
            <button
              onClick={endBooth}
              disabled={pendingUploads > 0 || unconfirmedUploads.length > 0}
              title={
                pendingUploads > 0
                  ? 'Saving photos to server...'
                  : unconfirmedUploads.length > 0
                    ? 'Please retry unconfirmed photo uploads before proceeding'
                    : 'Finish session and select photos'
              }
              style={{
                padding: '8px 16px',
                backgroundColor: (pendingUploads > 0 || unconfirmedUploads.length > 0) ? 'var(--grey-400)' : 'var(--soft-blue)',
                color: 'var(--white)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 'bold',
                fontSize: '0.875rem',
                border: 'none',
                cursor: (pendingUploads > 0 || unconfirmedUploads.length > 0) ? 'not-allowed' : 'pointer'
              }}
            >
              {pendingUploads > 0 ? 'SAVING...' : unconfirmedUploads.length > 0 ? 'UPLOAD INCOMPLETE' : 'FINISH'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
