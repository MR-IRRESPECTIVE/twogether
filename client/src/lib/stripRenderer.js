function redactUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return rawUrl.split('?')[0];
  }
}

async function loadHtmlImage(url) {
  if (!url) return null;

  // 1. Direct load for Data URLs or local Blob URLs (completely immune to CORS)
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        resolve(img);
      };
      img.onerror = (e) => {
        console.warn("Failed to load data/blob image in strip renderer");
        resolve(null);
      };
      img.src = url;
    });
  }

  // 2. HTTP(S) URL: Try direct fetch -> blob -> object URL
  try {
    const res = await fetch(url, { mode: 'cors' });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && contentType.startsWith('image/')) {
      const blob = await res.blob();
      if (blob && blob.size > 0) {
        const objectUrl = URL.createObjectURL(blob);
        const img = await new Promise((resolve) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => resolve(null);
          i.src = objectUrl;
        });
        if (img) return img;
      }
    }
  } catch (err) {
    console.warn("Direct fetch for strip photo failed, trying proxy fallback...", redactUrl(url));
  }

  // 3. Backend image proxy fallback for cross-origin URLs
  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL || '';
    const proxyUrl = `${serverUrl}/api/proxy-image?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && contentType.startsWith('image/')) {
      const blob = await res.blob();
      if (blob && blob.size > 0) {
        const objectUrl = URL.createObjectURL(blob);
        const img = await new Promise((resolve) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => resolve(null);
          i.src = objectUrl;
        });
        if (img) return img;
      }
    } else {
      console.warn("Proxy response not a valid image:", redactUrl(url), `status: ${res.status}, type: ${contentType}`);
    }
  } catch (err) {
    console.warn("Proxy fetch for strip photo failed:", redactUrl(url), err.message);
  }

  // 4. Fallback: Image element with crossOrigin
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("All image load attempts failed for url:", redactUrl(url));
      resolve(null);
    };
    img.src = url;
  });
}

export async function renderStrip(layout, theme, photos, stickers, textElements) {
  // Wait for Google Fonts (e.g. Caveat) if available
  if (document.fonts && document.fonts.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise(resolve => setTimeout(resolve, 800)) // 800ms safety timeout
      ]);
    } catch (e) {
      console.warn("Font loading wait timed out or failed:", e);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");

  // 1. Draw Background
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Pre-load all photo images in parallel while strictly tracking their slot index
  const totalPhotos = Math.min(photos.length, layout.photoSlots.length);
  const loadedImages = await Promise.all(
    photos.slice(0, totalPhotos).map(p => loadHtmlImage(p.url))
  );

  const successfulImagesCount = loadedImages.filter(Boolean).length;
  if (totalPhotos > 0 && successfulImagesCount === 0) {
    throw new Error("Unable to render strip: none of the selected photos could be loaded.");
  }

  // 3. Draw Photos in their assigned slots
  for (let i = 0; i < totalPhotos; i++) {
    const slot = layout.photoSlots[i];
    const img = loadedImages[i];

    // Border around photo slot
    ctx.fillStyle = theme.borderColor;
    ctx.fillRect(slot.x - 5, slot.y - 5, slot.width + 10, slot.height + 10);

    if (img) {
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
    } else {
      // Slot placeholder if photo couldn't be loaded - explicit visible placeholder
      ctx.fillStyle = "#E2E8F0";
      ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
      ctx.fillStyle = "#718096";
      ctx.font = "bold 1.5rem sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("📷 Photo Unavailable", slot.x + slot.width / 2, slot.y + slot.height / 2);
    }
  }

  // 4. Draw stickers
  if (stickers && stickers.length > 0) {
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

  // 5. Draw texts
  if (textElements && textElements.length > 0) {
    textElements.forEach(textEl => {
      ctx.save();
      ctx.translate(textEl.x, textEl.y);
      ctx.rotate((textEl.rotation * Math.PI) / 180);
      ctx.scale(textEl.scale, textEl.scale);

      ctx.font = `bold 4rem 'Caveat', ${theme.fontFamily || 'cursive'}, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      ctx.fillStyle = theme.textColor || "#333";
      ctx.fillText(textEl.text, 0, 0);

      ctx.restore();
    });
  }

  return canvas.toDataURL("image/png");
}
