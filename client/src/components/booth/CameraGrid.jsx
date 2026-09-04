import React from "react";
import CameraTile from "./CameraTile";

export default function CameraGrid({ localStream, remoteStreams, participants, myId, myFilterCss, targetSlotAspect = 1.333 }) {
  
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
  
  // Calculate what ONE person's bounding box aspect ratio is inside the composite photo
  let targetAspect = targetSlotAspect;
  if (count === 2) {
    targetAspect = targetSlotAspect / 2;
  } else if (count >= 3) {
    targetAspect = targetSlotAspect; // 2x2 grid in capture.js means w/2 and h/2, so aspect remains the same!
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: allTiles.length > 1 ? "1fr 1fr" : "1fr",
      gap: "16px",
      width: "100%",
      height: "100%",
      justifyItems: "center",
      alignItems: "center"
    }}>
      {allTiles.map((item) => (
        <CameraTile 
          key={item.id} 
          stream={item.stream} 
          name={item.name} 
          filterCss={item.filter}
          targetAspect={targetAspect}
        />
      ))}
    </div>
  );
}

