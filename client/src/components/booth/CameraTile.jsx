import React, { useRef, useEffect } from "react";

export default function CameraTile({ stream, name, filterCss, targetAspect = 1600/1200 }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      // Explicitly set these DOM properties for iOS Safari WebKit compatibility
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.srcObject = stream || null;
      if (stream) {
        videoRef.current.play().catch(err => {
          console.warn("Video play interrupted or muted autoplay required:", err);
        });
      }
    }
  }, [stream]);

  return (
    <div style={{
      position: "relative",
      width: "100%",
      maxHeight: "100%",
      backgroundColor: "#000",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      border: "2px solid var(--soft-blue)",
      boxShadow: "var(--shadow-lg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      aspectRatio: targetAspect,
    }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ 
          filter: filterCss, 
          transform: "scaleX(-1)",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center 25%"
        }}
      />
      
      {/* Safe Area Visual Guide */}
      <div style={{
        position: "absolute",
        inset: "4%",
        border: "1px dashed rgba(255,255,255,0.4)",
        borderRadius: "var(--radius-sm)",
        pointerEvents: "none",
        zIndex: 5
      }}>
        <div style={{
          position: "absolute", top: "-1px", left: "-1px", width: "10px", height: "10px", borderTop: "2px solid rgba(255,255,255,0.7)", borderLeft: "2px solid rgba(255,255,255,0.7)"
        }} />
        <div style={{
          position: "absolute", top: "-1px", right: "-1px", width: "10px", height: "10px", borderTop: "2px solid rgba(255,255,255,0.7)", borderRight: "2px solid rgba(255,255,255,0.7)"
        }} />
        <div style={{
          position: "absolute", bottom: "-1px", left: "-1px", width: "10px", height: "10px", borderBottom: "2px solid rgba(255,255,255,0.7)", borderLeft: "2px solid rgba(255,255,255,0.7)"
        }} />
        <div style={{
          position: "absolute", bottom: "-1px", right: "-1px", width: "10px", height: "10px", borderBottom: "2px solid rgba(255,255,255,0.7)", borderRight: "2px solid rgba(255,255,255,0.7)"
        }} />
      </div>

      <div style={{
        position: "absolute",
        bottom: "8px",
        left: "8px",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "4px 12px",
        borderRadius: "var(--radius-sm)",
        color: "white",
        fontSize: "0.875rem",
        fontWeight: "600",
        letterSpacing: "0.025em",
        zIndex: 10
      }}>
        {name}
      </div>
      
      {!stream && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--soft-blue)",
          backgroundColor: "#161626",
          gap: "12px",
          zIndex: 15
        }}>
          <span>Connecting video...</span>
        </div>
      )}
    </div>
  );
}

