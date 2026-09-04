import React, { useState, useEffect, useRef } from 'react';
import DraggableElement from './DraggableElement';

function TextElement({ 
  textEl, 
  scale, 
  layout, 
  theme, 
  onUpdateText, 
  onRemoveText,
  isSelected,
  onSelect
}) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isSelected) {
      setIsEditing(false);
      // Auto-delete if empty on blur
      if (textEl && typeof textEl.text === 'string' && !textEl.text.trim()) {
        onRemoveText(textEl.instanceId);
      }
    }
  }, [isSelected, textEl, onRemoveText]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isSelected && !isEditing) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          onRemoveText(textEl.instanceId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, isEditing, onRemoveText, textEl.instanceId]);

  const handlePointerDown = (e) => {
    if (!isEditing) {
      // If we are not editing, this is just a normal click on the element to select/drag.
      // We do NOT stop propagation here for DraggableElement, it needs the event to drag.
      // But we DO want to select it. We can call onSelect here.
      onSelect(textEl.instanceId);
    } else {
      // If we ARE editing, we stop propagation so we can click inside the input to move the cursor without dragging.
      e.stopPropagation();
    }
  };

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  return (
    <DraggableElement 
      x={textEl.x}
      y={textEl.y}
      scale={textEl.scale}
      rotation={textEl.rotation}
      displayScale={scale}
      bounds={{ minX: 100, maxX: layout.width - 100, minY: 50, maxY: layout.height - 50 }}
      onUpdate={(newProps) => onUpdateText(textEl.instanceId, newProps)}
    >
      <div 
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        style={{ position: 'relative' }}
      >
        {isSelected && !isEditing && (
          <button
            onPointerDown={(e) => {
              e.stopPropagation(); // prevent dragging
            }}
            onClick={(e) => {
              e.stopPropagation();
              onRemoveText(textEl.instanceId);
            }}
            style={{
              position: 'absolute',
              top: '-20px',
              right: '-20px',
              background: 'var(--coral)',
              color: 'white',
              border: '2px solid white',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              fontSize: '24px',
              lineHeight: '1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              zIndex: 10
            }}
          >
            ×
          </button>
        )}
        
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={textEl.text}
            onChange={(e) => onUpdateText(textEl.instanceId, { text: e.target.value })}
            onBlur={() => {
              setIsEditing(false);
              if (!textEl.text.trim()) {
                onRemoveText(textEl.instanceId);
              }
            }}
            style={{
              background: 'rgba(255, 255, 255, 0.5)',
              border: '4px dashed rgba(0,0,0,0.5)',
              color: theme.textColor || 'var(--near-black)',
              fontSize: '4rem',
              fontFamily: 'var(--font-display)',
              textAlign: 'center',
              outline: 'none',
              minWidth: '250px',
              padding: '10px',
              pointerEvents: 'auto'
            }}
          />
        ) : (
          <div
            style={{
              background: isSelected ? 'rgba(255, 255, 255, 0.5)' : 'transparent',
              border: isSelected ? '4px dashed rgba(0,0,0,0.5)' : '4px solid transparent',
              color: theme.textColor || 'var(--near-black)',
              fontSize: '4rem',
              fontFamily: 'var(--font-display)',
              textAlign: 'center',
              minWidth: '250px',
              padding: '10px',
              cursor: 'grab',
              userSelect: 'none',
              whiteSpace: 'pre'
            }}
          >
            {textEl.text}
          </div>
        )}
      </div>
    </DraggableElement>
  );
}

export default function StripCanvas({ layout, theme, photos, stickers, textElements = [], onUpdateSticker, onUpdateText, onRemoveText }) {
  const [selectedId, setSelectedId] = useState(null);
  
  const scale = 300 / layout.width; // scale down for preview
  const previewWidth = layout.width * scale;
  const previewHeight = layout.height * scale;

  return (
    <div 
      className="strip-canvas-container"
      onPointerDown={() => setSelectedId(null)}
      style={{
        width: previewWidth,
        height: previewHeight,
        backgroundColor: theme.background,
        position: 'relative',
        overflow: 'hidden',
        border: `2px solid ${theme.borderColor}`,
        transformOrigin: 'top left'
      }}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: layout.width, height: layout.height }}>
        {layout.photoSlots.map((slot, index) => (
          <div 
            key={slot.id}
            style={{
              position: 'absolute',
              left: slot.x,
              top: slot.y,
              width: slot.width,
              height: slot.height,
              backgroundColor: '#ccc',
              border: `5px solid ${theme.borderColor}`,
              boxSizing: 'border-box'
            }}
          >
            {photos[index] && (
              <img 
                src={photos[index].url} 
                alt="slot" 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              />
            )}
          </div>
        ))}

        {stickers.map(sticker => (
          <DraggableElement 
            key={sticker.instanceId}
            x={sticker.x}
            y={sticker.y}
            scale={sticker.scale}
            rotation={sticker.rotation}
            displayScale={scale}
            bounds={{ minX: 50, maxX: layout.width - 50, minY: 50, maxY: layout.height - 50 }}
            onUpdate={(newProps) => onUpdateSticker(sticker.instanceId, newProps)}
          >
            <div style={{ fontSize: '3rem' }}>
              {sticker.emoji || sticker.name}
            </div>
          </DraggableElement>
        ))}

        {textElements && textElements.map(textEl => (
          <TextElement
            key={textEl.instanceId}
            textEl={textEl}
            scale={scale}
            layout={layout}
            theme={theme}
            onUpdateText={onUpdateText}
            onRemoveText={onRemoveText}
            isSelected={selectedId === textEl.instanceId}
            onSelect={setSelectedId}
          />
        ))}
      </div>
    </div>
  );
}
