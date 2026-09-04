export async function renderStrip(layout, theme, photos, stickers, textElements) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Photos
    let loadedPhotos = 0;
    const totalPhotos = Math.min(photos.length, layout.photoSlots.length);
    
    if (totalPhotos === 0) {
      drawAll();
      return;
    }

    const images = [];

    for (let i = 0; i < totalPhotos; i++) {
      const slot = layout.photoSlots[i];
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        images.push({ img, slot });
        loadedPhotos++;
        if (loadedPhotos === totalPhotos) drawAll();
      };
      img.onerror = () => {
        loadedPhotos++;
        if (loadedPhotos === totalPhotos) drawAll();
      }
      img.src = photos[i].url;
    }

    function drawAll() {
      // Draw photos
      images.forEach(({ img, slot }) => {
        ctx.fillStyle = theme.borderColor;
        ctx.fillRect(slot.x - 5, slot.y - 5, slot.width + 10, slot.height + 10);
        
        // object-fit: cover math
        const imgAspect = img.width / img.height;
        const slotAspect = slot.width / slot.height;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        
        if (imgAspect > slotAspect) {
          sw = img.height * slotAspect;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / slotAspect;
          sy = (img.height - sh) / 2;
        }
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(slot.x, slot.y, slot.width, slot.height);
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sh, slot.x, slot.y, slot.width, slot.height);
        ctx.restore();
      });

      // Draw stickers
      if (stickers) {
        stickers.forEach(sticker => {
          ctx.save();
          ctx.translate(sticker.x, sticker.y);
          ctx.rotate((sticker.rotation * Math.PI) / 180);
          ctx.scale(sticker.scale, sticker.scale);
          ctx.font = "3rem sans-serif";
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillText(sticker.emoji || sticker.name, 0, 0);
          ctx.restore();
        });
      }

      // Draw texts
      if (textElements) {
        textElements.forEach(textEl => {
          ctx.save();
          ctx.translate(textEl.x, textEl.y);
          ctx.rotate((textEl.rotation * Math.PI) / 180);
          ctx.scale(textEl.scale, textEl.scale);
          
          ctx.font = "4rem sans-serif";
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          
          ctx.fillStyle = theme.textColor || "#333";
          ctx.fillText(textEl.text, 0, 0);
          
          ctx.restore();
        });
      }

      resolve(canvas.toDataURL("image/png"));
    }
  });
}

