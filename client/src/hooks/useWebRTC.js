import { useEffect, useState, useRef } from 'react';
import { WebRTCManager } from '../lib/webrtc';
import { socket } from '../lib/socket';
import { useRoom } from '../context/RoomContext';

export function useWebRTC(localStream) {
  const { participants, myId } = useRoom();
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const managerRef = useRef(null);

  // Initialize manager and socket event listeners once
  useEffect(() => {
    console.log(`[useWebRTC] MOUNTED for myId: ${myId}`);
    const currentId = socket.id || myId;
    if (!currentId) return;

    if (!managerRef.current) {
      managerRef.current = new WebRTCManager(currentId, setRemoteStreams);
    } else {
      managerRef.current.myId = currentId;
    }

    const onReady = ({ from }) => {
      managerRef.current?.handleReady(from);
    };
    const onOffer = ({ from, offer, sdp }) => {
      managerRef.current?.handleOffer(from, offer || sdp);
    };
    const onAnswer = ({ from, answer, sdp }) => {
      managerRef.current?.handleAnswer(from, answer || sdp);
    };
    const onIce = ({ from, candidate }) => {
      managerRef.current?.handleIceCandidate(from, candidate);
    };
    const onParticipantLeft = (data) => {
      const peerId = data?.participantId || data?.socketId || data;
      if (typeof peerId === 'string') {
        managerRef.current?.removePeer(peerId);
      }
    };

    socket.on('signal:ready', onReady);
    socket.on('signal:offer', onOffer);
    socket.on('signal:answer', onAnswer);
    socket.on('signal:ice-candidate', onIce);
    socket.on('room:participant-left', onParticipantLeft);

    // Initial ready broadcast
    socket.emit('signal:ready', { from: currentId });

    return () => {
      console.log(`[useWebRTC] UNMOUNTED for myId: ${myId}`);
      socket.off('signal:ready', onReady);
      socket.off('signal:offer', onOffer);
      socket.off('signal:answer', onAnswer);
      socket.off('signal:ice-candidate', onIce);
      socket.off('room:participant-left', onParticipantLeft);
      managerRef.current?.cleanup();
      managerRef.current = null;
    };
  }, [myId]);

  // Update local stream tracks when localStream changes or manager is recreated
  useEffect(() => {
    if (managerRef.current && localStream) {
      managerRef.current.updateLocalStream(localStream);
    }
  }, [localStream, myId]);

  // Update participants list without tearing down existing calls
  useEffect(() => {
    if (managerRef.current && participants && participants.length > 0) {
      managerRef.current.updateParticipants(participants);
    }
  }, [participants, myId]);

  return { remoteStreams };
}

