import React, { useEffect, useState } from 'react';

export default function CountdownOverlay({ duration = 3, onFlash }) {
  const [count, setCount] = useState(duration);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (count > 0) {
      console.log(`[CAPTURE][COUNTDOWN-TICK] ${count}`);
      const timer = setTimeout(() => setCount(c => c - 1), 1000);
      return () => clearTimeout(timer);
    } else if (count === 0 && !flashing) {
      console.log("[CAPTURE][COUNTDOWN-END]");
      setFlashing(true);
      if (onFlash) onFlash();
      
      const timer = setTimeout(() => {
        // Flash animation ends
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [count, flashing, onFlash]);

  if (flashing) {
    return (
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        backgroundColor: 'white',
        animation: 'flash 0.5s ease-out forwards'
      }}>
        <style>{`
          @keyframes flash {
            0% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none'
    }}>
      <span style={{
        fontSize: '15rem',
        fontWeight: 'bold',
        color: 'white',
        textShadow: '0 0 20px rgba(242, 102, 94, 0.8)',
        animation: 'bounce 1s infinite'
      }}>
        {count}
      </span>
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
      `}</style>
    </div>
  );
}
