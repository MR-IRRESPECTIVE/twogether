import React, { useRef, useState } from 'react';

export default function DraggableElement({ x, y, scale = 1, rotation = 0, displayScale = 1, bounds, onUpdate, children }) {
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0, elX: 0, elY: 0 });

  const handlePointerDown = (e) => {
    e.stopPropagation();
    setIsDragging(true);
    e.target.setPointerCapture(e.pointerId);
    startPos.current = {
      x: e.clientX,
      y: e.clientY,
      elX: x,
      elY: y
    };
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const dx = (e.clientX - startPos.current.x) / displayScale;
    const dy = (e.clientY - startPos.current.y) / displayScale;
    
    let newX = startPos.current.elX + dx;
    let newY = startPos.current.elY + dy;

    if (bounds) {
      newX = Math.max(bounds.minX, Math.min(newX, bounds.maxX));
      newY = Math.max(bounds.minY, Math.min(newY, bounds.maxY));
    }

    onUpdate({ x: newX, y: newY });
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    e.target.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`,
        cursor: 'grab',
        touchAction: 'none'
      }}
    >
      {children}
    </div>
  );
}
