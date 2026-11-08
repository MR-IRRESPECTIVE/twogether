/**
 * stage transition request helper with guaranteed single settlement,
 * timeout protection, disconnect rejection, and cleanup.
 *
 * @param {object} socket - Socket.IO client instance
 * @param {string} event - Socket event name (e.g. 'session:end-booth', 'selection:confirm')
 * @param {object} payload - Request payload { roomCode, sessionId, ... }
 * @param {object} [options={}] - Configuration options
 * @param {number} [options.timeoutMs=5000] - Acknowledgement timeout in ms
 * @returns {Promise<{ success: boolean, [key: string]: any, error?: string }>}
 */
export function requestTransition(socket, event, payload, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;

  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ success: false, error: 'Socket disconnected' });
      return;
    }

    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof socket.off === 'function') {
        socket.off('disconnect', onDisconnect);
      } else if (typeof socket.removeListener === 'function') {
        socket.removeListener('disconnect', onDisconnect);
      }
    };

    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onDisconnect = (reason) => {
      settle({
        success: false,
        error: `Socket disconnected before transition acknowledgement: ${reason || 'transport close'}`
      });
    };

    if (typeof socket.on === 'function') {
      socket.on('disconnect', onDisconnect);
    }

    timer = setTimeout(() => {
      settle({ success: false, error: 'Transition timed out' });
    }, timeoutMs);

    try {
      socket.emit(event, payload, (response) => {
        // Late response after timeout or disconnect settlement
        if (settled) return;

        if (response && response.success === true) {
          settle({ success: true, ...response });
        } else if (response && response.error) {
          settle({ success: false, error: response.error });
        } else if (response && response.success === false) {
          settle({ success: false, error: response.error || 'Transition rejected' });
        } else {
          settle({ success: false, error: 'Malformed transition acknowledgement' });
        }
      });
    } catch (err) {
      settle({ success: false, error: err?.message || 'Failed to emit transition event' });
    }
  });
}
