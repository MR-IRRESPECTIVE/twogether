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
  const { photos, startCountdown, endBooth, sessionId, layoutId } = useSession();
  
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
      captureFrame(captureItems, targetSlotAspect).then(({ dataUrl }) => {
        console.log("Frame captured! Emitting photo:upload...");
        socket.emit('photo:upload', { 
          sessionId, 
          photoData: dataUrl, 
          metadata: { id: Date.now().toString(), capturedBy: socket.id, timestamp: Date.now() } 
        });
      }).catch(err => {
        console.error("CAPTURE FRAME FAILED:", err);
      });
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
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
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
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--soft-blue)',
                color: 'var(--white)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 'bold',
                fontSize: '0.875rem',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              FINISH
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
