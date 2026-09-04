import { useState, useEffect, useCallback } from 'react';

export function useCamera() {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const requestCamera = useCallback(async () => {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      setStream(mediaStream);
      setIsReady(true);
      
      const videoTrack = mediaStream.getVideoTracks()[0];
      console.log(`[MEDIA]\nstreamId: ${mediaStream.id}\nvideoTrackId: ${videoTrack?.id}\nvideoTrack.readyState: ${videoTrack?.readyState}\nvideoTrack.enabled: ${videoTrack?.enabled}`);
    } catch (err) {
      setIsReady(false);
      let errorMessage = 'Failed to access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Camera access was denied. Please allow camera access in your browser settings and try again.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera device found.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Camera is already in use by another application.';
      }
      setError(errorMessage);
    }
  }, []);

  const retry = useCallback(() => {
    setRetryCount(prev => prev + 1);
    requestCamera();
  }, [requestCamera]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsReady(false);
    }
  }, [stream]);

  useEffect(() => {
    requestCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
    // We intentionally don't put stream in the dep array here to avoid infinite loops,
    // only want to run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { stream, error, isReady, retry, retryCount, stopCamera };
}
