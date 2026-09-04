import React, { useState } from 'react';
import { useRoom } from '../context/RoomContext';
import { useSession } from '../context/SessionContext';
import { socket } from '../lib/socket';

const LAYOUT_OPTIONS = [
  { id: 'layout-1x4', label: '1x4 Strip' },
  { id: 'layout-2x2', label: '2x2 Grid' }
];

export default function FormatSelectPage() {
  const { isHost, roomCode } = useRoom();
  const { setLayout, layoutId, sessionId } = useSession();
  const [selectedLayout, setSelectedLayout] = useState(layoutId || 'layout-1x4');

  const handleSelect = (newLayoutId) => {
    setSelectedLayout(newLayoutId);
    if (isHost) {
      setLayout(newLayoutId);
    }
  };

  const toBooth = () => {
    socket.emit('session:to-booth', { roomCode, sessionId });
  };

  if (!isHost) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', backgroundColor: 'var(--cream)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', color: 'var(--coral)', marginBottom: '1rem' }}>Format Selection</h1>
        <p style={{ color: 'var(--grey-600)' }}>Waiting for host to select a layout format...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', backgroundColor: 'var(--cream)', padding: '24px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', color: 'var(--coral)', marginBottom: '2rem' }}>Select Layout</h1>
      
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '2rem', marginBottom: '2rem' }}>
        {LAYOUT_OPTIONS.map(opt => (
          <button 
            key={opt.id}
            onClick={() => handleSelect(opt.id)}
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              border: `3px solid ${selectedLayout === opt.id ? 'var(--coral)' : 'transparent'}`,
              backgroundColor: 'var(--white)',
              boxShadow: selectedLayout === opt.id ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              transform: selectedLayout === opt.id ? 'scale(1.05)' : 'scale(1)'
            }}
          >
            {/* Visual Preview */}
            <div style={{
              width: '100px',
              height: '140px',
              backgroundColor: 'var(--grey-100)',
              border: '1px solid var(--grey-200)',
              padding: '8px',
              display: 'flex',
              flexDirection: opt.id === 'layout-1x4' ? 'column' : 'row',
              flexWrap: opt.id === 'layout-2x2' ? 'wrap' : 'nowrap',
              gap: '4px'
            }}>
              {opt.id === 'layout-1x4' ? (
                // 1x4 Strip visual
                <>
                  <div style={{ flex: 1, backgroundColor: 'var(--grey-400)', width: '100%' }}></div>
                  <div style={{ flex: 1, backgroundColor: 'var(--grey-400)', width: '100%' }}></div>
                  <div style={{ flex: 1, backgroundColor: 'var(--grey-400)', width: '100%' }}></div>
                  <div style={{ flex: 1, backgroundColor: 'var(--grey-400)', width: '100%' }}></div>
                </>
              ) : (
                // 2x2 Grid visual
                <>
                  <div style={{ width: 'calc(50% - 2px)', height: 'calc(50% - 2px)', backgroundColor: 'var(--grey-400)' }}></div>
                  <div style={{ width: 'calc(50% - 2px)', height: 'calc(50% - 2px)', backgroundColor: 'var(--grey-400)' }}></div>
                  <div style={{ width: 'calc(50% - 2px)', height: 'calc(50% - 2px)', backgroundColor: 'var(--grey-400)' }}></div>
                  <div style={{ width: 'calc(50% - 2px)', height: 'calc(50% - 2px)', backgroundColor: 'var(--grey-400)' }}></div>
                </>
              )}
            </div>
            
            <span style={{
              color: selectedLayout === opt.id ? 'var(--coral)' : 'var(--near-black)',
              fontWeight: 'bold',
              fontSize: '1.1rem'
            }}>
              {opt.label}
            </span>
          </button>
        ))}
      </div>

      <button 
        onClick={toBooth}
        style={{
          padding: '16px 32px',
          backgroundColor: 'var(--coral)',
          color: 'var(--white)',
          fontWeight: 'bold',
          borderRadius: 'var(--radius-full)',
          fontSize: '1.25rem',
          boxShadow: 'var(--shadow-md)'
        }}
      >
        ENTER BOOTH
      </button>
    </div>
  );
}
