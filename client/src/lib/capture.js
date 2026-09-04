import { PHOTO_MAX_DIMENSION, PHOTO_JPEG_QUALITY } from "@shared/constants.js";

export async function captureCompositeFrame(captureItems, targetSlotAspect = 1.333) {
  const validItems = (Array.isArray(captureItems) ? captureItems : [captureItems]).filter(item => item && item.stream && item.stream.active);

  const count = validItems.length || 1;
  const canvas = document.createElement("canvas");

  // The composite image should match the layout slot aspect ratio exactly,
  // so no cropping occurs when placing it into the strip.
  // We use a high resolution base (e.g. 1200 height)
  const canvasH = 1200;
  const canvasW = Math.round(canvasH * targetSlotAspect);

  let slots = [];

  if (count <= 1) {
    slots = [{ x: 0, y: 0, w: canvasW, h: canvasH }];
  } else if (count === 2) {
    const halfW = canvasW / 2;
    slots = [
      { x: 0, y: 0, w: halfW, h: canvasH },
      { x: halfW, y: 0, w: halfW, h: canvasH }
    ];
  } else if (count === 3) {
    const halfW = canvasW / 2;
    const halfH = canvasH / 2;
    slots = [
      { x: 0, y: 0, w: halfW, h: halfH },
      { x: halfW, y: 0, w: halfW, h: halfH },
      { x: halfW / 2, y: halfH, w: halfW, h: halfH }
    ];
  } else {
    const halfW = canvasW / 2;
    const halfH = canvasH / 2;
    slots = [
      { x: 0, y: 0, w: halfW, h: halfH },
      { x: halfW, y: 0, w: halfW, h: halfH },
      { x: 0, y: halfH, w: halfW, h: halfH },
      { x: halfW, y: halfH, w: halfW, h: halfH }
    ];
  }

  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#1A1A2E";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Create temporary video elements for all streams
  const videoPromises = validItems.map(item => {
    return new Promise(resolve => {
      const vid = document.createElement("video");
      vid.muted = true;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.srcObject = item.stream;
      vid.onloadedmetadata = () => {
        vid.play().then(() => resolve({ video: vid, filter: item.filter })).catch(() => resolve({ video: vid, filter: item.filter }));
      };
      // fallback timeout
      setTimeout(() => resolve({ video: vid, filter: item.filter }), 1000);
    });
  });

  const vidsWithFilters = await Promise.all(videoPromises);

  vidsWithFilters.forEach((item, index) => {
    if (index >= slots.length) return;
    const { video, filter } = item;
    const slot = slots[index];
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    const targetAspect = slot.w / slot.h;
    const videoAspect = vw / vh;

    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;

    if (videoAspect > targetAspect) {
      sw = vh * targetAspect;
      sx = (vw - sw) / 2;
    } else {
      sh = vw / targetAspect;
      // 25% from the top for better headroom instead of dead center
      sy = (vh - sh) * 0.25;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, slot.w, slot.h);
    ctx.clip();

    if (filter && filter !== "none") {
      ctx.filter = filter;
    }

    ctx.translate(slot.x + slot.w, slot.y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, slot.w, slot.h);
    ctx.restore();
    
    video.srcObject = null; // cleanup
  });

  return new Promise((resolve) => {
    const timestamp = Date.now();
    const quality = PHOTO_JPEG_QUALITY || 0.85;
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    canvas.toBlob((blob) => {
      resolve({ blob, dataUrl, timestamp });
    }, "image/jpeg", quality);
  });
}

// Backward compatibility alias
export const captureFrame = captureCompositeFrame;

