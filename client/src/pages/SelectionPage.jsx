import React, { useState, useEffect } from 'react';
import { useSession } from '../context/SessionContext';
import layouts from '../data/layouts.json';
import './SelectionPage.css';

export default function SelectionPage() {
  const { photos, confirmSelection, layoutId, sessionId, requestAllPhotos, pendingUploads } = useSession();
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmError, setConfirmError] = useState(null);

  const layout = layouts.find(l => l.id === layoutId) || layouts[0];
  const totalSlots = layout?.photoSlots?.length || 4;

  useEffect(() => {
    if (typeof requestAllPhotos === 'function') {
      requestAllPhotos();
    }
  }, [sessionId]);

  // Target count: enforce totalSlots, preventing premature truncated selection while uploads are in flight
  const maxSelections = photos.length >= totalSlots
    ? totalSlots
    : (pendingUploads > 0 ? totalSlots : (photos.length > 0 ? photos.length : totalSlots));

  const toggleSelection = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(selId => selId !== id);
      } else if (prev.length < maxSelections) {
        return [...prev, id];
      }
      return prev;
    });
  };

  const handleConfirm = async () => {
    if (selectedIds.length === maxSelections && maxSelections > 0) {
      setConfirmError(null);
      const res = await confirmSelection(selectedIds);
      if (res && !res.success) {
        setConfirmError(res.error || 'Failed to confirm selection. Please try again.');
      }
    }
  };

  return (
    <div className="selection-page">
      <h2>Select {maxSelections} Photo{maxSelections > 1 ? 's' : ''}</h2>
      <p>{selectedIds.length} / {maxSelections} selected</p>
      {confirmError && (
        <p style={{ fontSize: '0.875rem', color: '#c92a2a', fontWeight: 'bold' }}>
          ⚠️ {confirmError}
        </p>
      )}
      {pendingUploads > 0 && (
        <p style={{ fontSize: '0.875rem', color: 'var(--coral)', fontWeight: 'bold' }}>
          Syncing photos from booth...
        </p>
      )}

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

