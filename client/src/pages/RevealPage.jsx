import React, { useState } from "react";
import { useSession } from "../context/SessionContext";
import { useRoom } from "../context/RoomContext";
import { Button } from "../components/ui/Button";

export default function RevealPage() {
  const { isHost } = useRoom();
  const { finalStripDataUrl, publishedStrips, publishStrip, makeAnother } = useSession();
  const [isPublishing, setIsPublishing] = useState(false);
  const [hasPublished, setHasPublished] = useState(false);

  const handleDownload = async (url, filename) => {
    try {
      let downloadUrl = url;
      // If it's a signed HTTP URL instead of a data URL, fetch it to a blob first
      // to avoid CORS download issues or browser navigating away
      if (url.startsWith("http")) {
        const response = await fetch(url);
        const blob = await response.blob();
        downloadUrl = URL.createObjectURL(blob);
      }
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      if (url.startsWith("http")) {
        URL.revokeObjectURL(downloadUrl);
      }
    } catch (e) {
      console.error("Download failed", e);
    }
  };

  const handlePublish = () => {
    if (!finalStripDataUrl) return;
    setIsPublishing(true);
    publishStrip(finalStripDataUrl);
    setHasPublished(true);
    setIsPublishing(false);
  };

  return (
    <div style={{ padding: "24px", textAlign: "center", minHeight: "100dvh", backgroundColor: "var(--cream)", display: "flex", flexDirection: "column" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "3rem", color: "var(--coral)", marginBottom: "2rem" }}>
        YOUR MEMORIES ARE READY ?
      </h1>

      <div style={{ display: "flex", gap: "2rem", justifyContent: "center", flexWrap: "wrap", flex: 1 }}>
        {/* User own strip */}
        {finalStripDataUrl && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", flex: "1 1 300px", maxWidth: "400px" }}>
            <h3 style={{ fontFamily: "var(--font-ui)", color: "var(--near-black)" }}>Your Strip</h3>
            <img 
              src={finalStripDataUrl} 
              alt="Your photobooth strip" 
              style={{ width: "100%", height: "auto", maxHeight: "60vh", objectFit: "contain", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)" }} 
            />
            <Button 
              variant="primary" 
              onClick={() => handleDownload(finalStripDataUrl, `twogether-strip-${Date.now()}.png`)}
            >
              DOWNLOAD YOURS
            </Button>
            {!hasPublished && (
              <Button variant="secondary" onClick={handlePublish} disabled={isPublishing}>
                PUBLISH TO ROOM GALLERY
              </Button>
            )}
          </div>
        )}

        <div style={{ width: "2px", backgroundColor: "rgba(0,0,0,0.1)", margin: "0 1rem" }} />

        {/* Room Gallery */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", flex: "2 1 500px" }}>
          <h3 style={{ fontFamily: "var(--font-ui)", color: "var(--soft-blue)" }}>Everyone's Strips</h3>
          {publishedStrips.length === 0 ? (
            <div style={{ padding: "2rem", color: "var(--near-black)", opacity: 0.6 }}>No strips published yet.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", justifyContent: "center" }}>
              {publishedStrips.map(strip => (
                <div key={strip.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", width: "200px" }}>
                  <img 
                    src={strip.imageData} 
                    alt={`${strip.ownerName} strip`} 
                    style={{ width: "100%", height: "auto", maxHeight: "40vh", objectFit: "contain", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-md)" }} 
                  />
                  <div style={{ fontWeight: 600, color: "var(--near-black)" }}>{strip.ownerName}</div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleDownload(strip.imageData, `twogether-${strip.ownerName}-${Date.now()}.png`)}
                  >
                    DOWNLOAD
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isHost && (
        <div style={{ marginTop: "3rem", paddingBottom: "2rem" }}>
          <Button variant="secondary" onClick={makeAnother} size="lg">
            MAKE ANOTHER ONE ?
          </Button>
        </div>
      )}
    </div>
  );
}

