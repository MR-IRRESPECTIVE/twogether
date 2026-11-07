import React, { useRef, useState, useEffect } from "react";
import CameraTile from "./CameraTile";

export default function CameraGrid({ localStream, remoteStreams, participants, myId, myFilterCss, targetSlotAspect = 1.333 }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      if (clientWidth > 0 && clientHeight > 0) {
        setDimensions({ width: clientWidth, height: clientHeight });
      }
    };

    updateSize();

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);
  
  const allTiles = (participants && participants.length > 0)
    ? participants.map(p => {
        const isLocal = p.id === myId;
        const stream = isLocal ? localStream : (remoteStreams.get(p.id) || null);
        const name = p.name ? (isLocal ? `${p.name} (You)` : p.name) : (isLocal ? "You" : "Guest");
        const filter = isLocal ? myFilterCss : (p.filter || "none");
        return { id: p.id, name, stream, isLocal, filter };
      })
    : (localStream ? [{ id: myId || "local", name: "You", stream: localStream, isLocal: true, filter: myFilterCss }] : []);

  remoteStreams.forEach((stream, id) => {
    if (!allTiles.some(t => t.id === id)) {
      allTiles.push({ id, name: "Guest", stream, isLocal: false, filter: "none" });
    }
  });

  const count = allTiles.length || 1;
  const gap = 16;
  
  // Calculate what ONE person's bounding box aspect ratio is inside the composite photo
  let targetAspect = targetSlotAspect;
  let cols = 1;
  let rows = 1;

  if (count === 2) {
    targetAspect = targetSlotAspect / 2;
    cols = 2;
    rows = 1;
  } else if (count >= 3) {
    targetAspect = targetSlotAspect; // 2x2 grid in capture.js means w/2 and h/2, so aspect remains the same!
    cols = 2;
    rows = 2;
  }

  let tileWidth = 0;
  let tileHeight = 0;

  if (dimensions.width > 0 && dimensions.height > 0) {
    const availW = Math.max(0, dimensions.width - (cols - 1) * gap);
    const availH = Math.max(0, dimensions.height - (rows - 1) * gap);

    const maxW = availW / cols;
    const maxH = availH / rows;

    const wFromH = maxH * targetAspect;
    if (wFromH <= maxW) {
      tileWidth = Math.floor(wFromH);
      tileHeight = Math.floor(maxH);
    } else {
      tileWidth = Math.floor(maxW);
      tileHeight = Math.floor(maxW / targetAspect);
    }
  }

  console.log(`[CAMERAGRID] user=${myId} dim=${dimensions.width}x${dimensions.height} tile=${tileWidth}x${tileHeight} targetAspect=${targetAspect}`);

  const fallbackMaxWidth = cols > 1 ? `calc(${100 / cols}% - ${gap * (cols - 1) / cols}px)` : "100%";

  return (
    <div 
      ref={containerRef}
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        alignContent: "center",
        gap: `${gap}px`,
        width: "100%",
        height: "100%",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden"
      }}
    >
      {allTiles.map((item) => (
        <CameraTile 
          key={item.id} 
          stream={item.stream} 
          name={item.name} 
          filterCss={item.filter}
          targetAspect={targetAspect}
          width={tileWidth || undefined}
          height={tileHeight || undefined}
          maxWidth={tileWidth ? undefined : fallbackMaxWidth}
        />
      ))}
    </div>
  );
}

