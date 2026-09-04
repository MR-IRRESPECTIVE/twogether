import React, { useEffect, useRef } from 'react';

export const CameraPreview = ({ stream }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!stream) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--grey-200)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--grey-400)',
        borderRadius: 'var(--radius-md)'
      }}>
        No camera feed
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: 'scaleX(-1)', // Selfie mode
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--grey-200)'
      }}
    />
  );
};
