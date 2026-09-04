import React from 'react';
import { FILTERS } from '../../lib/filters';

export default function FilterSelector({ currentFilter, setFilter }) {
  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      overflowX: 'auto',
      padding: '8px 0',
      scrollbarWidth: 'none', // for Firefox
      WebkitOverflowScrolling: 'touch' // for Safari
    }}>
      {Object.entries(FILTERS).map(([key, filter]) => (
        <button
          key={key}
          onClick={() => setFilter(filter.css)}
          style={{
            padding: '6px 12px',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: '600',
            whiteSpace: 'nowrap',
            transition: 'background-color 0.2s',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: currentFilter === filter.css ? 'var(--coral)' : 'rgba(123, 158, 196, 0.2)',
            color: currentFilter === filter.css ? 'var(--white)' : 'var(--cream)'
          }}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
