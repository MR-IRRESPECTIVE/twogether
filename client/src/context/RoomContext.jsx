import React, { createContext, useContext, useState, useEffect } from 'react';
import { socket, emitWithAck } from '../lib/socket';

const RoomContext = createContext(null);

export const useRoom = () => useContext(RoomContext);

export const RoomProvider = ({ children }) => {
  const [roomCode, setRoomCode] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [myId, setMyId] = useState(null);
  const [myName, setMyName] = useState(null);
  const [myColor, setMyColor] = useState(null);
  const [hostId, setHostId] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const [rejoinedSession, setRejoinedSession] = useState(null);

  const isHost = myId === hostId;

  useEffect(() => {
    socket.on('connect', () => {
      setConnectionStatus('connected');
      if (roomCode && myName) {
        // Attempt rejoin
        socket.emit('room:join', { roomCode, name: myName, color: myColor, previousId: myId }, (response) => {
          if (response.roomCode) {
            setParticipants(response.room.participants);
            setHostId(response.room.hostId);
            setMyId(socket.id);
            if (response.session) {
              setRejoinedSession(response.session);
            }
          }
        });
      }
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('room:participant-joined', (data) => {
      if (data?.room?.participants) {
        setParticipants(data.room.participants);
        setHostId(data.room.hostId);
      } else if (data?.participant) {
        setParticipants((prev) => {
          if (prev.some((p) => p.id === data.participant.id)) return prev;
          return [...prev, data.participant];
        });
      } else if (data?.id) {
        setParticipants((prev) => {
          if (prev.some((p) => p.id === data.id)) return prev;
          return [...prev, data];
        });
      }
    });

    socket.on('room:camera-ready', (data) => {
      if (data?.room?.participants) {
        setParticipants(data.room.participants);
        setHostId(data.room.hostId);
      } else if (data?.participantId) {
        setParticipants((prev) =>
          prev.map((p) => (p.id === data.participantId ? { ...p, cameraReady: data.ready } : p))
        );
      }
    });

    socket.on('room:participant-left', (data) => {
      if (data?.room?.participants) {
        setParticipants(data.room.participants);
        setHostId(data.room.hostId);
      } else if (data?.participantId) {
        setParticipants((prev) => prev.filter((p) => p.id !== data.participantId));
      }
    });

    socket.on('room:participant-reconnecting', ({ participantId }) => {
      setParticipants((prev) =>
        prev.map((p) => (p.id === participantId ? { ...p, isReconnecting: true } : p))
      );
    });

    socket.on('room:update', ({ room }) => {
      if (room) {
        setParticipants(room.participants || []);
        setHostId(room.hostId);
      }
    });

    socket.on('room:host-transferred', ({ newHostId }) => {
      setHostId(newHostId);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room:participant-joined');
      socket.off('room:camera-ready');
      socket.off('room:participant-left');
      socket.off('room:participant-reconnecting');
      socket.off('room:update');
      socket.off('room:host-transferred');
    };
  }, [roomCode, myName, myColor, myId]);

  const createRoom = async (name, color, expectedCount) => {
    const response = await emitWithAck('room:create', { name, color, expectedCount });
    if (response.error) {
      throw new Error(response.error);
    }
    if (response.roomCode) {
      setRoomCode(response.room.code);
      setParticipants(response.room.participants);
      setHostId(response.room.hostId);
      setMyId(socket.id);
      setMyName(name);
      setMyColor(color);
      return response.room.code;
    }
    throw new Error('Unexpected response format');
  };

  const joinRoom = async (code, name, color) => {
    const response = await emitWithAck('room:join', { roomCode: code, name, color });
    if (response.error) {
      throw new Error(response.error);
    }
    if (response.roomCode) {
      setRoomCode(response.roomCode);
      setParticipants(response.room.participants);
      setHostId(response.room.hostId);
      setMyId(socket.id);
      setMyName(name);
      setMyColor(color);
      return response.roomCode;
    }
    throw new Error('Unexpected response format');
  };

  const leaveRoom = () => {
    socket.emit('room:leave');
    setRoomCode(null);
    setParticipants([]);
    setHostId(null);
    setMyId(null);
    setMyName(null);
    setMyColor(null);
  };

  return (
    <RoomContext.Provider
      value={{
        roomCode,
        participants,
        isHost,
        myId,
        myName,
        myColor,
        connectionStatus,
        createRoom,
        joinRoom,
        leaveRoom,
        rejoinedSession
      }}
    >
      {children}
    </RoomContext.Provider>
  );
};
