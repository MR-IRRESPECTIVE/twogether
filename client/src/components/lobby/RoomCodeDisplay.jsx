import React, { useState } from 'react';

export const RoomCodeDisplay = ({ roomCode }) => {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      const link = `${window.location.origin}/room/${roomCode}`;
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  return (
    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
      <div style={{
        fontSize: '2.5rem',
        fontWeight: 'bold',
        fontFamily: 'monospace',
        letterSpacing: '0.2em',
        color: 'var(--near-black)',
        marginBottom: '12px'
      }}>
        {roomCode}
      </div>
      <button
        onClick={copyLink}
        style={{
          background: 'var(--white)',
          border: '1px solid var(--grey-200)',
          borderRadius: 'var(--radius-full)',
          padding: '8px 16px',
          fontSize: '0.875rem',
          color: 'var(--near-black)',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        {copied ? 'Copied!' : '🔗 Copy invite link'}
      </button>
    </div>
  );
};
