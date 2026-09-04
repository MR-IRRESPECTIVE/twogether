import React from 'react';

export default function CaptureButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        console.log("[CAPTURE][CLICK]");
        onClick(e);
      }}
      disabled={disabled}
      style={{
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        backgroundColor: disabled ? 'var(--grey-400)' : 'var(--coral)',
        border: '4px solid var(--cream)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--shadow-lg)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'transform 0.1s ease-in-out',
        padding: 0
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.95)'; }}
      onMouseUp={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <div style={{
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        border: '2px solid var(--cream)',
        backgroundColor: 'transparent'
      }} />
    </button>
  );
}
