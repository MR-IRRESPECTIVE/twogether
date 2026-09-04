import React, { createContext, useContext, useState, useEffect } from "react";
import { socket } from "../lib/socket";
import { STAGES } from "@shared/constants.js";
import { useRoom } from "./RoomContext";

const SessionContext = createContext();

export function SessionProvider({ children }) {
  const { roomCode, rejoinedSession } = useRoom();
  const [sessionId, setSessionId] = useState(null);
  const [stage, setStage] = useState(STAGES.LOBBY);
  const [layoutId, setLayoutId] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [mySelections, setMySelections] = useState([]);
  const [participantStages, setParticipantStages] = useState(new Map());
  const [finalStripDataUrl, setFinalStripDataUrl] = useState(null);
  const [publishedStrips, setPublishedStrips] = useState([]);

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
        setPhotos(data.photos);
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
      setPhotos((prev) => {
        if (prev.some(p => p.id === payload.photoId)) return prev;
        return [...prev, {
          id: payload.photoId,
          url: payload.photoData,
          metadata: payload.metadata
        }];
      });
    };

    const onPhotoAll = (payload) => {
      if (payload.photos) {
        setPhotos(payload.photos.map(p => ({
          id: p.metadata.id,
          url: p.data,
          metadata: p.metadata
        })));
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

  const startSession = () => {
    socket.emit("session:start", { roomCode });
  };

  const setLayout = (id) => {
    socket.emit("session:set-layout", { roomCode, sessionId, layoutId: id });
  };

  const startCountdown = () => {
    socket.emit("photo:trigger", { roomCode });
  };

  const endBooth = () => {
    socket.emit("session:end-booth", { roomCode, sessionId });
  };

  const confirmSelection = (photoIds) => {
    setMySelections(photoIds);
    setStage(STAGES.CUSTOMIZE);
    socket.emit("selection:confirm", { roomCode, sessionId, photoIds });
  };

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

