import React from 'react';
import stickers from '../../data/stickers.json';

export default function StickerPalette({ onAddSticker }) {
  return (
    <div style={{ display: 'flex', gap: '8px', padding: '8px 0', flexWrap: 'wrap', overflowY: 'auto', maxHeight: '150px' }}>
      {stickers.map(s => (
        <button 
          key={s.id} 
          onClick={() => onAddSticker(s)}
          title={s.name}
          style={{ 
            fontSize: '1.5rem', 
            padding: '8px', 
            cursor: 'pointer', 
            backgroundColor: 'var(--grey-100)', 
            border: '1px solid var(--grey-200)', 
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.1s'
          }}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.9)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          {s.emoji}
        </button>
      ))}
    </div>
  );
}
