import React from 'react';

export default function PhotoCounter({ count, max = 20 }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--near-black)',
      border: '1px solid var(--soft-blue)',
      borderRadius: 'var(--radius-sm)',
      padding: '6px 12px',
      boxShadow: 'var(--shadow-sm)'
    }}>
      <span style={{
        color: 'var(--cream)',
        fontFamily: 'monospace',
        fontSize: '0.875rem',
        letterSpacing: '0.1em',
        fontWeight: 'bold'
      }}>
        {count} / {max}
      </span>
    </div>
  );
}
