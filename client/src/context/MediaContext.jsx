import React, { createContext, useContext, useEffect } from 'react';
import { useCamera } from '../hooks/useCamera';
import { useWebRTC } from '../hooks/useWebRTC';

const MediaContext = createContext(null);

export const useMedia = () => useContext(MediaContext);

export const MediaProvider = ({ children }) => {
  useEffect(() => {
    console.log("MediaProvider MOUNTED");
    return () => console.log("MediaProvider UNMOUNTED");
  }, []);
  const cameraState = useCamera();
  const webrtcState = useWebRTC(cameraState.stream);

  return (
    <MediaContext.Provider value={{ ...cameraState, ...webrtcState }}>
      {children}
    </MediaContext.Provider>
  );
};
