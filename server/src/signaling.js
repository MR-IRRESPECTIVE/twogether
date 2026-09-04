export function registerSignalingHandlers(io, socket) {
  socket.on('signal:ready', ({ target, to, roomCode }) => {
    const targetId = target || to;
    if (targetId) {
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        targetSocket.emit('signal:ready', {
          from: socket.id
        });
      }
    } else if (roomCode) {
      socket.to(roomCode).emit('signal:ready', {
        from: socket.id
      });
    } else {
      socket.broadcast.emit('signal:ready', {
        from: socket.id
      });
    }
  });

  socket.on('signal:offer', ({ target, to, offer, sdp }) => {
    const targetId = target || to;
    const sdpData = offer || sdp;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('signal:offer', {
        from: socket.id,
        offer: sdpData,
        sdp: sdpData
      });
    }
  });

  socket.on('signal:answer', ({ target, to, answer, sdp }) => {
    const targetId = target || to;
    const sdpData = answer || sdp;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('signal:answer', {
        from: socket.id,
        answer: sdpData,
        sdp: sdpData
      });
    }
  });

  socket.on('signal:ice-candidate', ({ target, to, candidate }) => {
    const targetId = target || to;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket && candidate) {
      targetSocket.emit('signal:ice-candidate', {
        from: socket.id,
        candidate
      });
    }
  });
}


