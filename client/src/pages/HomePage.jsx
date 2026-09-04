import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRoom } from '../context/RoomContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PARTICIPANT_COLORS } from '@shared/constants.js';

const HomePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { createRoom, joinRoom } = useRoom();

  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const joinCode = params.get('join');
    if (joinCode) {
      setRoomCode(joinCode.toUpperCase());
      setJoinModalOpen(true);
      // Clean up the URL so refresh doesn't keep opening it if they cancel
      window.history.replaceState({}, document.title, '/');
    }
  }, [location]);

  const [name, setName] = useState('');
  const [color, setColor] = useState(PARTICIPANT_COLORS[0]);
  const [expectedCount, setExpectedCount] = useState(2);
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleHostSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    setLoading(true);
    setError(null);
    try {
      const code = await createRoom(name.trim(), color, expectedCount);
      navigate(`/room/${code}`);
    } catch (err) {
      setError(err.message || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !roomCode.trim()) return setError("Code and Name are required");
    setLoading(true);
    setError(null);
    try {
      const code = await joinRoom(roomCode.trim().toUpperCase(), name.trim(), color);
      navigate(`/room/${code}`);
    } catch (err) {
      setError(err.message || 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  const ColorPicker = () => (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
      {PARTICIPANT_COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => setColor(c)}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: c,
            border: color === c ? '2px solid var(--near-black)' : '2px solid transparent',
            cursor: 'pointer'
          }}
          aria-label={`Select color ${c}`}
        />
      ))}
    </div>
  );

  return (
    <div style={{ 
      position: 'relative', 
      height: '100dvh', 
      width: '100vw', 
      overflow: 'hidden', 
      backgroundColor: 'var(--cream)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Full-bleed Hero Illustration */}
      <img
        src="/twogether-homepage-hero.jpg"
        alt="Friends in a photobooth"
        style={{ 
          position: 'absolute', 
          inset: 0, 
          width: '100%', 
          height: '100%', 
          objectFit: 'cover', 
          objectPosition: 'center top' 
        }}
      />

      {/* Top Logo Overlay */}
      <img
        src="/twogether-logo.png"
        alt="Twogether Logo"
        style={{
          position: 'absolute',
          top: '24px',
          left: '24px',
          width: '130px',
          zIndex: 10
        }}
      />

      {/* Overlaid Content in Open Lower Third */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '0 24px 36px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 10
      }}>
        <h1 className="font-display" style={{
          fontSize: 'clamp(1.5rem, 3vw, 2.25rem)',
          color: 'var(--near-black)',
          marginBottom: '16px',
          textAlign: 'center',
          fontWeight: 700
        }}>
          A little photobooth, wherever you are
        </h1>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          width: '100%',
          maxWidth: '380px'
        }}>
          <Button fullWidth onClick={() => setHostModalOpen(true)}>
            HOST A ROOM
          </Button>
          <Button fullWidth variant="secondary" onClick={() => setJoinModalOpen(true)}>
            JOIN A ROOM
          </Button>
        </div>
      </div>

      {/* Host Modal */}
      <Modal isOpen={hostModalOpen} onClose={() => setHostModalOpen(false)}>
        <h2 style={{ marginBottom: '24px' }}>Host a Room</h2>
        {error && <p style={{ color: 'var(--coral)', marginBottom: '16px' }}>{error}</p>}
        <form onSubmit={handleHostSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Your Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Alex"
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--grey-200)' }}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Your Color</label>
            <ColorPicker />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Expected People</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[2,3,4].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setExpectedCount(num)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: expectedCount === num ? '2px solid var(--coral)' : '1px solid var(--grey-200)',
                    background: expectedCount === num ? 'var(--coral)' : 'var(--white)',
                    color: expectedCount === num ? 'var(--white)' : 'var(--near-black)',
                    fontWeight: 600
                  }}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" fullWidth isLoading={loading}>CREATE ROOM</Button>
        </form>
      </Modal>

      {/* Join Modal */}
      <Modal isOpen={joinModalOpen} onClose={() => setJoinModalOpen(false)}>
        <h2 style={{ marginBottom: '24px' }}>Join a Room</h2>
        {error && <p style={{ color: 'var(--coral)', marginBottom: '16px' }}>{error}</p>}
        <form onSubmit={handleJoinSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase().slice(0,6))}
              placeholder="6-letter code"
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--grey-200)', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 'bold' }}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Your Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Jamie"
              style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--grey-200)' }}
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Your Color</label>
            <ColorPicker />
          </div>
          <Button type="submit" fullWidth isLoading={loading}>JOIN ROOM</Button>
        </form>
      </Modal>
    </div>
  );
};

export default HomePage;
