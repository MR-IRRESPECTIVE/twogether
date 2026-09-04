import React, { useState } from 'react';
import { useSession } from '../context/SessionContext';
import layouts from '../data/layouts.json';
import './SelectionPage.css'; 

export default function SelectionPage() {
  const { photos, confirmSelection, layoutId } = useSession();
  const [selectedIds, setSelectedIds] = useState([]);
  
  const layout = layouts.find(l => l.id === layoutId) || layouts[0];
  const totalSlots = layout?.photoSlots?.length || 4;
  const maxSelections = photos.length > 0 ? Math.min(totalSlots, photos.length) : totalSlots;

  const toggleSelection = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(selId => selId !== id));
    } else if (selectedIds.length < maxSelections) {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleConfirm = () => {
    if (selectedIds.length === maxSelections && maxSelections > 0) {
      confirmSelection(selectedIds);
    }
  };

  return (
    <div className="selection-page">
      <h2>Select {maxSelections} Photo{maxSelections > 1 ? 's' : ''}</h2>
      <p>{selectedIds.length} / {maxSelections} selected</p>
      
      {photos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--grey-600)' }}>
          <p style={{ marginBottom: '16px' }}>No photos found in this session.</p>
          <button 
            className="btn-confirm" 
            onClick={() => confirmSelection([])}
          >
            CONTINUE TO CUSTOMIZE
          </button>
        </div>
      ) : (
        <>
          <div className="photo-grid">
            {photos.map(photo => {
              const isSelected = selectedIds.includes(photo.id);
              return (
                <div 
                  key={photo.id} 
                  className={`photo-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleSelection(photo.id)}
                >
                  <img src={photo.url} alt="Booth Capture" />
                  {isSelected && <div className="selection-overlay">✓</div>}
                </div>
              );
            })}
          </div>

          <button 
            className="btn-confirm" 
            onClick={handleConfirm}
            disabled={selectedIds.length < maxSelections}
          >
            CONFIRM SELECTION
          </button>
        </>
      )}
    </div>
  );
}

