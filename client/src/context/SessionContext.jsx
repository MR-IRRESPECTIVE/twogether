import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { socket, emitWithAck } from "../lib/socket";
import { requestTransition } from "../lib/transitions";
import { STAGES } from "@shared/constants.js";
import { useRoom } from "./RoomContext";

const SessionContext = createContext();

export function SessionProvider({ children }) {
  const { roomCode, rejoinedSession } = useRoom();
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const [stage, setStage] = useState(STAGES.LOBBY);
  const [layoutId, setLayoutId] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [mySelections, setMySelections] = useState([]);
  const [participantStages, setParticipantStages] = useState(new Map());
  const [finalStripDataUrl, setFinalStripDataUrl] = useState(null);
  const [publishedStrips, setPublishedStrips] = useState([]);
  const [pendingUploads, setPendingUploads] = useState(0);
  const outstandingUploadsRef = useRef(new Map()); // photoId -> { resolve, timer, settled: false }

  const settleUpload = useCallback((photoId, result) => {
    const item = outstandingUploadsRef.current.get(photoId);
    if (!item || item.settled) return;

    item.settled = true;
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
    }
    outstandingUploadsRef.current.delete(photoId);
    setPendingUploads(prev => Math.max(0, prev - 1));
    item.resolve(result);
  }, []);

  useEffect(() => {
    const onDisconnect = (reason) => {
      console.warn("[SESSION] Socket disconnected:", reason);
      // Immediately settle all in-flight uploads on disconnect
      const outstanding = Array.from(outstandingUploadsRef.current.keys());
      for (const photoId of outstanding) {
        settleUpload(photoId, { success: false, error: `Socket disconnected: ${reason}` });
      }
    };

    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("disconnect", onDisconnect);
    };
  }, [settleUpload]);

  useEffect(() => {
    return () => {
      for (const item of outstandingUploadsRef.current.values()) {
        if (item.timer) clearTimeout(item.timer);
      }
      outstandingUploadsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (rejoinedSession) {
      setSessionId(rejoinedSession.id);
      setStage(rejoinedSession.stage);
      if (rejoinedSession.layoutId) setLayoutId(rejoinedSession.layoutId);

      // Request photos if in BOOTH or later
      if (rejoinedSession.stage !== STAGES.FORMAT_SELECT) {
        socket.emit("photo:request-all", { sessionId: rejoinedSession.id });
      }

      // Request strips if in REVEAL
      if (rejoinedSession.stage === STAGES.REVEAL) {
        socket.emit("reveal:request-strips", { sessionId: rejoinedSession.id }, (res) => {
          if (res && res.strips) setPublishedStrips(res.strips);
        });
      }
    }
  }, [rejoinedSession]);

  useEffect(() => {
    const onStageChanged = (data) => {
      console.log("[SESSION] stage-changed:", data.stage);
      setStage(data.stage);
      if (data.sessionId) {
        setSessionId(data.sessionId);
      } else if (data.session && data.session.id) {
        setSessionId(data.session.id);
      }

      // Synchronize canonical room state for new round
      if (data.layoutId !== undefined) {
        setLayoutId(data.layoutId);
      }
      if (data.photos !== undefined) {
        setPhotos(prev => {
          // If server explicitly resets photos (e.g. empty array on new round), honor it
          if (Array.isArray(data.photos) && data.photos.length === 0) {
            return [];
          }
          const map = new Map(prev.map(p => [p.id, p]));
          for (const p of (data.photos || [])) {
            const photoId = p.metadata?.id || p.id;
            const photoUrl = p.data || p.url;
            if (!photoId) continue;
            const existing = map.get(photoId);
            if (!existing) {
              if (photoUrl) {
                map.set(photoId, {
                  id: photoId,
                  url: photoUrl,
                  metadata: p.metadata
                });
              }
            } else if (!existing.url && photoUrl) {
              map.set(photoId, {
                ...existing,
                url: photoUrl,
                metadata: p.metadata || existing.metadata
              });
            }
          }
          return Array.from(map.values());
        });
      }
      if (data.mySelections !== undefined) {
        setMySelections(data.mySelections);
      }
      if (data.finalStripDataUrl !== undefined) {
        setFinalStripDataUrl(data.finalStripDataUrl);
      }
      if (data.publishedStrips !== undefined) {
        setPublishedStrips(data.publishedStrips);
      }
      if (data.photos && data.photos.length === 0) {
        setParticipantStages(new Map());
      }
    };

    const onPhotoNew = (payload) => {
      console.log("[SESSION] photo:new received:", payload.photoId);
      setPhotos((prev) => {
        let filtered = prev;
        if (payload.supersededPhotoId) {
          filtered = filtered.filter(p => p.id !== payload.supersededPhotoId);
        }
        if (payload.slotIndex !== undefined) {
          filtered = filtered.filter(p => !(p.metadata?.slotIndex === payload.slotIndex && p.id !== payload.photoId));
        }
        const existing = filtered.find(p => p.id === payload.photoId);
        if (existing) {
          if (!existing.url && payload.photoData) {
            return filtered.map(p => p.id === payload.photoId ? { ...p, url: payload.photoData, metadata: payload.metadata || p.metadata } : p);
          }
          return filtered;
        }
        return [...filtered, {
          id: payload.photoId,
          url: payload.photoData,
          metadata: payload.metadata
        }];
      });
    };

    const onPhotoAll = (payload) => {
      if (payload && payload.photos) {
        setPhotos(() => {
          const map = new Map();
          for (const p of payload.photos) {
            const photoId = p.metadata?.id || p.id;
            const photoUrl = p.data || p.url;
            if (!photoId || !photoUrl) continue;
            map.set(photoId, {
              id: photoId,
              url: photoUrl,
              metadata: p.metadata
            });
          }
          return Array.from(map.values());
        });
      }
    };

    const onLayoutSet = (data) => {
      setLayoutId(data.layoutId);
    };

    const onNewStrip = (data) => {
      setPublishedStrips(prev => {
        if (prev.some(s => s.id === data.strip.id)) return prev;
        return [...prev, data.strip];
      });
    };

    const onSelectionConfirmed = ({ participantId }) => {
      setParticipantStages((prev) => new Map(prev).set(participantId, STAGES.CUSTOMIZE));
    };

    const onCustomizeDone = ({ participantId }) => {
      setParticipantStages((prev) => new Map(prev).set(participantId, STAGES.REVEAL));
    };

    socket.on("session:stage-changed", onStageChanged);
    socket.on("photo:new", onPhotoNew);
    socket.on("photo:all", onPhotoAll);
    socket.on("session:layout-changed", onLayoutSet);
    socket.on("reveal:new-strip", onNewStrip);
    socket.on("selection:confirmed", onSelectionConfirmed);
    socket.on("customize:done", onCustomizeDone);

    return () => {
      socket.off("session:stage-changed", onStageChanged);
      socket.off("photo:new", onPhotoNew);
      socket.off("photo:all", onPhotoAll);
      socket.off("session:layout-changed", onLayoutSet);
      socket.off("reveal:new-strip", onNewStrip);
      socket.off("selection:confirmed", onSelectionConfirmed);
      socket.off("customize:done", onCustomizeDone);
    };
  }, []);

  const startSession = (targetRoomCode) => {
    const code = targetRoomCode || roomCode;
    return emitWithAck("session:start", { roomCode: code });
  };

  const setLayout = (id) => {
    socket.emit("session:set-layout", { roomCode, sessionId, layoutId: id });
  };

  const startCountdown = () => {
    socket.emit("photo:trigger", { roomCode });
  };

  const uploadPhoto = useCallback((photoData, metadata) => {
    const photoId = metadata?.id || Date.now().toString();
    const meta = metadata || { id: photoId, timestamp: Date.now() };

    // Optimistically preserve captured photo locally so it is never lost
    setPhotos(prev => {
      const existing = prev.find(p => p.id === photoId);
      if (existing) {
        if (!existing.url && photoData) {
          return prev.map(p => p.id === photoId ? { ...p, url: photoData } : p);
        }
        return prev;
      }
      return [...prev, { id: photoId, url: photoData, metadata: meta }];
    });

    if (!socket.connected) {
      return Promise.resolve({ success: false, error: 'Socket disconnected' });
    }

    // If an upload for this photoId is already in flight, settle it first before re-registering
    if (outstandingUploadsRef.current.has(photoId)) {
      settleUpload(photoId, { success: false, error: 'Upload superseded by retry' });
    }

    setPendingUploads(prev => prev + 1);

    return new Promise((resolve) => {
      // 10-second acknowledgement timeout
      const timer = setTimeout(() => {
        console.warn(`[SESSION] Upload timeout for photo: ${photoId}`);
        settleUpload(photoId, { success: false, error: 'Upload acknowledgement timed out' });
      }, 10000);

      outstandingUploadsRef.current.set(photoId, {
        resolve,
        timer,
        settled: false,
      });

      socket.emit("photo:upload", { sessionId, photoData, metadata: meta }, (response) => {
        if (response && (response.error || response.stale || response.success === false)) {
          const errMsg = response.error || (response.stale ? 'Stale upload rejected' : 'Upload failed');
          console.warn("[SESSION] Photo upload failed or rejected:", errMsg);
          if (meta.slotIndex !== undefined) {
            setPhotos(prev => prev.filter(p => p.id !== photoId));
          }
          settleUpload(photoId, { success: false, error: errMsg, stale: !!response.stale });
        } else {
          if (response?.photoUrl) {
            setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, url: response.photoUrl } : p));
          }
          settleUpload(photoId, {
            success: true,
            photoId: response?.photoId || photoId,
            photoUrl: response?.photoUrl,
            revision: response?.revision,
            slotIndex: response?.slotIndex
          });
        }
      });
    });
  }, [sessionId, settleUpload]);

  const requestAllPhotos = useCallback(() => {
    return new Promise((resolve) => {
      if (!sessionId || !socket.connected) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      socket.emit("photo:request-all", { sessionId }, (res) => {
        if (res && res.photos) {
          resolve({ success: true, photos: res.photos });
        } else {
          resolve({ success: false, error: res?.error || 'Failed to fetch photos' });
        }
      });
    });
  }, [sessionId]);

  const endBooth = useCallback(async () => {
    return requestTransition(socket, "session:end-booth", { roomCode, sessionId }, { timeoutMs: 5000 });
  }, [roomCode, sessionId]);

  const confirmSelection = useCallback(async (photoIds) => {
    const targetSessionId = sessionId;
    const res = await requestTransition(
      socket,
      "selection:confirm",
      { roomCode, sessionId: targetSessionId, photoIds },
      { timeoutMs: 5000 }
    );

    if (res.success) {
      setMySelections(photoIds);
      if (sessionIdRef.current === targetSessionId) {
        setStage(STAGES.CUSTOMIZE);
      }
      return { success: true, stage: STAGES.CUSTOMIZE };
    }

    console.warn("[SESSION] confirmSelection failed:", res.error);
    return res;
  }, [roomCode, sessionId]);

  const finishCustomize = (dataUrl) => {
    setFinalStripDataUrl(dataUrl);
    setStage(STAGES.REVEAL);
    socket.emit("customize:done", { roomCode, sessionId });
    // Synchronize strips for this client when entering REVEAL
    socket.emit("reveal:request-strips", { sessionId }, (res) => {
      if (res && res.strips) setPublishedStrips(res.strips);
    });
  };

  const publishStrip = (stripDataUrl) => {
    socket.emit("reveal:publish-strip", { roomCode, sessionId, stripData: stripDataUrl }, (res) => {
      if (res?.error) {
        console.error("Error publishing strip:", res.error);
      } else {
        socket.emit("reveal:request-strips", { sessionId }, (syncRes) => {
          if (syncRes && syncRes.strips) setPublishedStrips(syncRes.strips);
        });
      }
    });
  };

  const makeAnother = () => {
    socket.emit("session:make-another", { roomCode, sessionId });
  };

  return (
    <SessionContext.Provider
      value={{
        sessionId,
        stage,
        layoutId,
        photos,
        mySelections,
        participantStages,
        finalStripDataUrl,
        publishedStrips,
        pendingUploads,
        uploadPhoto,
        requestAllPhotos,
        startSession,
        setLayout,
        startCountdown,
        endBooth,
        confirmSelection,
        finishCustomize,
        publishStrip,
        makeAnother
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

