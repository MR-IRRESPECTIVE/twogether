import React from 'react';
import themes from '../../data/themes.json';

export default function ThemePicker({ currentTheme, onSelectTheme }) {
  return (
    <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', padding: '8px 0', scrollbarWidth: 'none' }}>
      {themes.map(t => (
        <button 
          key={t.id}
          onClick={() => onSelectTheme(t)}
          style={{
            padding: '12px 16px',
            border: currentTheme.id === t.id ? '3px solid var(--coral)' : '3px solid transparent',
            backgroundColor: t.background,
            color: t.textColor,
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            minWidth: '100px',
            textAlign: 'center',
            fontWeight: 'bold',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.2s'
          }}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
