import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { RoomProvider, useRoom } from './context/RoomContext';
import { SessionProvider, useSession } from './context/SessionContext';
import { MediaProvider } from './context/MediaContext';
import { STAGES } from '@shared/constants.js';

import HomePage from './pages/HomePage';
import LobbyPage from './pages/LobbyPage';
import FormatSelectPage from './pages/FormatSelectPage';
import BoothPage from './pages/BoothPage';
import SelectionPage from './pages/SelectionPage';
import CustomizePage from './pages/CustomizePage';
import RevealPage from './pages/RevealPage';

import { Button } from './components/ui/Button';
import { Modal } from './components/ui/Modal';

const RoomPageWrapper = () => {
  const { stage } = useSession();
  const { roomCode } = useParams();
  const { leaveRoom } = useRoom();
  const navigate = useNavigate();
  const [exitModalOpen, setExitModalOpen] = useState(false);

  const handleExit = () => {
    leaveRoom();
    navigate('/');
  };

  let content;
  if (!stage || stage === STAGES.LOBBY) {
    content = <LobbyPage />;
  } else if (stage === STAGES.FORMAT_SELECT) {
    content = <FormatSelectPage />;
  } else if (stage === STAGES.BOOTH) {
    content = <BoothPage />;
  } else if (stage === STAGES.SELECTION) {
    content = <SelectionPage />;
  } else if (stage === STAGES.CUSTOMIZE) {
    content = <CustomizePage />;
  } else if (stage === STAGES.REVEAL) {
    content = <RevealPage />;
  } else {
    content = <LobbyPage />;
  }

  return (
    <MediaProvider>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {content}
        <button 
          onClick={() => setExitModalOpen(true)}
          style={{
            position: 'absolute',
            top: '24px',
            right: '24px',
            zIndex: 100,
            background: 'rgba(255, 255, 255, 0.9)',
            color: 'var(--coral)',
            border: '2px solid var(--coral)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 16px',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.2s ease'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'var(--coral)';
            e.currentTarget.style.color = 'white';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)';
            e.currentTarget.style.color = 'var(--coral)';
          }}
        >
          Exit
        </button>
      </div>

      <Modal isOpen={exitModalOpen} onClose={() => setExitModalOpen(false)}>
        <h2 style={{ marginBottom: '16px' }}>Leave this room?</h2>
        <p style={{ marginBottom: '24px', color: 'var(--grey-600)' }}>
          Are you sure you want to leave? Your current session progress may be lost.
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button variant="secondary" fullWidth onClick={() => setExitModalOpen(false)}>
            CANCEL
          </Button>
          <Button fullWidth onClick={handleExit}>
            LEAVE ROOM
          </Button>
        </div>
      </Modal>
    </MediaProvider>
  );
};

function App() {
  return (
    <RoomProvider>
      <SessionProvider>
        <Router>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/room/:roomCode" element={<RoomPageWrapper />} />
          </Routes>
        </Router>
      </SessionProvider>
    </RoomProvider>
  );
}

export default App;
