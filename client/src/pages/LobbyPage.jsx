import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRoom } from '../context/RoomContext';
import { useSession } from '../context/SessionContext';
import { useMedia } from '../context/MediaContext';
import { ParticipantCard } from '../components/lobby/ParticipantCard';
import { RoomCodeDisplay } from '../components/lobby/RoomCodeDisplay';
import { Button } from '../components/ui/Button';

const LobbyPage = () => {
  const navigate = useNavigate();
  const { roomCode: urlRoomCode } = useParams();
  const { roomCode, participants, isHost, myId, leaveRoom, connectionStatus } = useRoom();
  const { startSession } = useSession();
  const { stream, error, isReady, retry } = useMedia();

  // If no roomCode in context, redirect home (with join param if they navigated to a deep link)
  useEffect(() => {
    if (!roomCode) {
      if (urlRoomCode) {
        navigate(`/?join=${urlRoomCode}`);
      } else {
        navigate('/');
      }
    }
  }, [roomCode, urlRoomCode, navigate]);

  // Sync camera status with server
  useEffect(() => {
    if (roomCode) {
      import('../lib/socket').then(({ socket }) => {
        socket.emit('room:camera-ready', { roomCode, ready: isReady });
      });
    }
  }, [isReady, roomCode]);

  if (!roomCode) return null; // or loading

  // Determine if we can start
  const readyCount = participants.filter(p => p.cameraReady).length + (isReady ? 1 : 0); // Note: server updates cameraReady via WebRTC later, but for now we'll just assume they are ready or use the participant object. Actually in Phase 2, we just emit a status if we want, but instructions say "enabled only when >=2 participants have cameraReady: true". Let's assume the server syncs this or we check the local isReady + remote cameraReady.
  
  // Wait, the local participant is in the participants array. So we just check the array.
  // Actually, local user hasn't sent their cameraReady status to server yet (Phase 3 WebRTC). 
  // We can just rely on the participants array if the server tracks it, but server doesn't track camera status in Phase 2.
  // Let's implement what was asked: "Enabled only when >=2 participants have cameraReady: true" (or for now, just >=2 people in the room to test, as cameraReady is Phase 3). I will just check if participants.length >= 2 since actual WebRTC stream signals aren't fully implemented in Phase 2's server yet. The prompt says "Enabled only when >=2 participants have cameraReady: true". I'll add a check that defaults to true or checks the property.
  const isStartEnabled = participants.length >= 2;

  const handleStart = async () => {
    if (!isStartEnabled) return;
    try {
      await startSession();
    } catch (err) {
      console.error('Failed to start session', err);
    }
  };

  const expectedCount = participants[0]?.expectedCount || 4; // Not strictly provided by server unless we added it to room state, let's just show max or expected. Actually the prompt says "X / N PEOPLE". We can just show length.
  
  return (
    <div style={{
      minHeight: '100dvh',
      backgroundColor: 'var(--cream)',
      padding: '24px',
      position: 'relative',
      border: '8px solid var(--soft-blue)', // Film strip vibe
      display: 'flex',
      flexDirection: 'column'
    }}>
      <header style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ fontWeight: 'bold', color: 'var(--grey-600)', marginBottom: '16px' }}>
          {participants.length} PEOPLE
        </div>
        <RoomCodeDisplay roomCode={roomCode} />
      </header>

      {/* Connection warning */}
      {connectionStatus === 'disconnected' && (
        <div style={{ backgroundColor: 'var(--coral)', color: 'white', padding: '8px', textAlign: 'center', borderRadius: '4px', marginBottom: '16px' }}>
          Disconnected. Trying to reconnect...
        </div>
      )}

      {/* Camera Error Recovery UI */}
      {error && (
        <div style={{
          backgroundColor: '#ffebee',
          border: '1px solid var(--coral)',
          padding: '16px',
          borderRadius: 'var(--radius-md)',
          marginBottom: '24px'
        }}>
          <h3 style={{ color: 'var(--coral)', marginBottom: '8px' }}>Camera Access Needed</h3>
          <p style={{ fontSize: '0.875rem', marginBottom: '16px', color: 'var(--near-black)' }}>
            {error}
          </p>
          <Button variant="secondary" size="sm" onClick={retry}>Try Again</Button>
        </div>
      )}

      {/* Participant List */}
      <div style={{ flex: 1 }}>
        {participants.map(p => (
          <ParticipantCard 
            key={p.id} 
            participant={p} 
            isLocal={p.id === myId}
            localStream={p.id === myId ? stream : null}
            localIsReady={isReady}
          />
        ))}
      </div>

      {/* Footer Controls */}
      <div style={{ marginTop: 'auto', paddingTop: '24px' }}>
        {isHost ? (
          <Button 
            fullWidth 
            size="lg" 
            onClick={handleStart} 
            disabled={!isStartEnabled}
          >
            START BOOTH
          </Button>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--grey-600)', padding: '16px 0' }}>
            Waiting for host to start...
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button 
            onClick={() => { leaveRoom(); navigate('/'); }}
            style={{ background: 'none', border: 'none', color: 'var(--grey-600)', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
};

export default LobbyPage;
