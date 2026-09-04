import { io } from 'socket.io-client';

// In production: VITE_SERVER_URL = Render backend (e.g. https://twogether-api.onrender.com)
// In development: empty / unset → window.location.origin (uses Vite dev proxy)
const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;

export const socket = io(serverUrl, {
  autoConnect: true,
  reconnection: true,
});

export const emitWithAck = (event, data) => {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, data, (err, response) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
};
