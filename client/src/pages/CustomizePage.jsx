import React, { useState } from 'react';
import { useSession } from '../context/SessionContext';
import StripCanvas from '../components/customize/StripCanvas';
import ThemePicker from '../components/customize/ThemePicker';
import StickerPalette from '../components/customize/StickerPalette';
import { renderStrip } from '../lib/stripRenderer';
import layouts from '../data/layouts.json';
import themes from '../data/themes.json';

export default function CustomizePage() {
  const { photos, mySelections, finishCustomize, layoutId } = useSession();
  
  const layout = layouts.find(l => l.id === layoutId) || layouts[0];
  const [theme, setTheme] = useState(themes[0]);
  const [stickers, setStickers] = useState([]);
  const [textElements, setTextElements] = useState([]);

  const selectedPhotos = (mySelections || []).map(id => photos.find(p => p.id === id)).filter(Boolean);

  const handleDone = async () => {
    const dataUrl = await renderStrip(layout, theme, selectedPhotos, stickers, textElements);
    finishCustomize(dataUrl);
  };

  const addSticker = (sticker) => {
    setStickers([...stickers, { ...sticker, instanceId: Date.now(), x: 100, y: 100, scale: 1, rotation: 0 }]);
  };

  const updateSticker = (id, newProps) => {
    setStickers(stickers.map(s => s.instanceId === id ? { ...s, ...newProps } : s));
  };

  const addText = () => {
    setTextElements([...textElements, { 
      instanceId: Date.now(), 
      text: 'Twogether ✨', 
      x: layout.width / 2, 
      y: layout.height - 100, 
      scale: 1, 
      rotation: 0 
    }]);
  };

  const updateText = (id, newProps) => {
    setTextElements(textElements.map(t => t.instanceId === id ? { ...t, ...newProps } : t));
  };

  const removeText = (id) => {
    setTextElements(prev => prev.filter(t => t.instanceId !== id));
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100dvh',
      backgroundColor: 'var(--cream)',
      padding: '24px'
    }}>
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: '24px'
      }}>
        <StripCanvas 
          layout={layout} 
          theme={theme} 
          photos={selectedPhotos} 
          stickers={stickers}
          textElements={textElements}
          onUpdateSticker={updateSticker}
          onUpdateText={updateText}
          onRemoveText={removeText}
        />
      </div>
      <div style={{
        backgroundColor: 'var(--white)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <ThemePicker currentTheme={theme} onSelectTheme={setTheme} />
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <StickerPalette onAddSticker={addSticker} />
          <button 
            type="button"
            onClick={addText}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--soft-blue)',
              color: 'var(--white)',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            + Text
          </button>
        </div>

        <button 
          onClick={handleDone}
          style={{
            backgroundColor: 'var(--coral)',
            color: 'var(--white)',
            padding: '16px',
            borderRadius: 'var(--radius-full)',
            border: 'none',
            fontSize: '1.25rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          FINISH
        </button>
      </div>
    </div>
  );
}
