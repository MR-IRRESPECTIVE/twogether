import React from 'react';
import { CameraPreview } from './CameraPreview';

export const ParticipantCard = ({ participant, localStream, isLocal, localIsReady }) => {
  const isReady = isLocal ? localIsReady : participant.cameraReady;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '12px',
      backgroundColor: 'var(--white)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      marginBottom: '12px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Camera Area */}
      <div style={{
        width: '60px',
        height: '60px',
        flexShrink: 0,
        marginRight: '16px',
        borderRadius: 'var(--radius-md)',
        position: 'relative'
      }}>
        {isLocal && localStream ? (
          <CameraPreview stream={localStream} />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: 'var(--grey-200)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
             {isReady ? '📹' : '❌'}
          </div>
        )}
      </div>

      {/* Info Area */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: participant.color || 'var(--grey-400)',
            marginRight: '8px'
          }} />
          <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--near-black)' }}>
            {participant.name} {isLocal && '(You)'}
          </span>
          {participant.isHost && (
            <span style={{ marginLeft: '8px', fontSize: '14px' }} title="Host">👑</span>
          )}
        </div>
        <div style={{ fontSize: '0.875rem', color: isReady ? 'var(--soft-blue)' : 'var(--coral)' }}>
          {isReady ? 'Ready' : 'Camera missing'}
        </div>
      </div>

      {/* Reconnecting Overlay */}
      {participant.isReconnecting && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
          color: 'var(--coral)',
          animation: 'pulse 1.5s infinite'
        }}>
          Reconnecting...
        </div>
      )}
      <style>{`
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};
