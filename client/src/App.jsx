import React from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import { RoomProvider } from './context/RoomContext';
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

const RoomPageWrapper = () => {
  const { stage } = useSession();
  const { roomCode } = useParams();

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
      {content}
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
