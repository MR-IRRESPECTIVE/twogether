import React, { createContext, useContext, useEffect } from 'react';
import { useCamera } from '../hooks/useCamera';
import { useWebRTC } from '../hooks/useWebRTC';
import { useRoom } from './RoomContext';
import { ROOM_MODES } from '@shared/constants.js';

const MediaContext = createContext(null);

export const useMedia = () => useContext(MediaContext);

export const MediaProvider = ({ children }) => {
  useEffect(() => {
    console.log("MediaProvider MOUNTED");
    return () => console.log("MediaProvider UNMOUNTED");
  }, []);

  const { roomMode } = useRoom();
  const isWebRTCEnabled = roomMode !== ROOM_MODES.SOLO;

  const cameraState = useCamera();
  const webrtcState = useWebRTC(cameraState.stream, isWebRTCEnabled);

  return (
    <MediaContext.Provider value={{ ...cameraState, ...webrtcState }}>
      {children}
    </MediaContext.Provider>
  );
};
