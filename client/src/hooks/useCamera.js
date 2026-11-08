import { useState, useEffect, useCallback, useRef } from 'react';

export function useCamera() {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [facingMode, setFacingMode] = useState('user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const streamRef = useRef(null);
  const facingModeRef = useRef('user');

  // Query available videoinput devices to determine if switching is possible
  const checkMultipleCameras = useCallback(async () => {
    try {
      if (navigator?.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length > 1);
      }
    } catch (e) {
      setHasMultipleCameras(false);
    }
  }, []);

  const requestCamera = useCallback(async (targetMode = facingModeRef.current) => {
    try {
      setError(null);
      
      // Stop old tracks before requesting new stream to release hardware safely
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Camera access not supported by browser');
      }

      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: targetMode ? { ideal: targetMode } : 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
      } catch (firstErr) {
        // Fallback for devices (e.g. desktop webcams) that throw OverconstrainedError on ideal facingMode
        if (targetMode === 'environment') {
          throw firstErr; // Let switchCamera handle environment failure gracefully
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      }

      streamRef.current = mediaStream;
      facingModeRef.current = targetMode;
      setFacingMode(targetMode);
      setStream(mediaStream);
      setIsReady(true);

      const videoTrack = mediaStream.getVideoTracks()[0];
      console.log(`[MEDIA]\nstreamId: ${mediaStream.id}\nvideoTrackId: ${videoTrack?.id}\nvideoTrack.readyState: ${videoTrack?.readyState}\nvideoTrack.enabled: ${videoTrack?.enabled}\nfacingMode: ${targetMode}`);

      // Probe for multiple cameras
      checkMultipleCameras();
      return mediaStream;
    } catch (err) {
      setIsReady(false);
      let errorMessage = 'Failed to access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Camera access was denied. Please allow camera access in your browser settings and try again.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera device found.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Camera is already in use by another application.';
      } else if (err.name === 'OverconstrainedError') {
        errorMessage = 'Camera constraints not satisfied by your device.';
      }
      setError(errorMessage);
      throw err;
    }
  }, [checkMultipleCameras]);

  const switchCamera = useCallback(async () => {
    const nextMode = facingModeRef.current === 'user' ? 'environment' : 'user';
    try {
      await requestCamera(nextMode);
    } catch (err) {
      console.warn(`[CAMERA] Switch to ${nextMode} failed, attempting revert:`, err);
      // Revert to user mode if environment failed
      try {
        await requestCamera('user');
      } catch (revertErr) {
        console.error("[CAMERA] Revert to default camera failed:", revertErr);
      }
    }
  }, [requestCamera]);

  const retry = useCallback(() => {
    setRetryCount(prev => prev + 1);
    requestCamera(facingModeRef.current).catch(() => {});
  }, [requestCamera]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStream(null);
    setIsReady(false);
  }, []);

  const startCamera = useCallback(() => {
    return requestCamera(facingModeRef.current);
  }, [requestCamera]);

  useEffect(() => {
    requestCamera('user').catch(() => {});
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return {
    stream,
    error,
    isReady,
    retry,
    retryCount,
    stopCamera,
    startCamera,
    switchCamera,
    facingMode,
    hasMultipleCameras
  };
}
