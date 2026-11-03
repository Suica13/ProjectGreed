"use strict";
// Coalesce states before encoding; never discard an already encoded delta.
function createStateOutbox({ encode, highWater = 128 * 1024, hardLimit = 8 * 1024 * 1024, pollMs = 50 }) {
  const pending = new Map();
  function cancel(socket) {
    const entry = pending.get(socket);
    if (entry) clearTimeout(entry.timer);
    pending.delete(socket);
  }
  function writable(socket) {
    if (socket?.readyState !== 1) { cancel(socket); return false; }
    if (socket.bufferedAmount > hardLimit) { cancel(socket); socket.terminate(); return false; }
    return true;
  }
  function transmit(socket, data) {
    if (!writable(socket)) return;
    try { socket.send(encode(socket, data)); }
    catch { cancel(socket); socket.terminate(); }
  }
  function flush(socket) {
    const entry = pending.get(socket);
    if (!entry || !writable(socket)) return;
    clearTimeout(entry.timer);
    if (socket.bufferedAmount > highWater) {
      entry.timer = setTimeout(() => flush(socket), pollMs);
      entry.timer.unref?.();
      return;
    }
    pending.delete(socket);
    transmit(socket, entry.state);
  }
  return {
    send(socket, data) {
      if (!writable(socket)) return;
      if (data.type === "state" && (pending.has(socket) || socket.bufferedAmount > highWater)) {
        const old = pending.get(socket);
        if (old) clearTimeout(old.timer);
        // Freeze the already privacy-filtered view before engine actors mutate.
        pending.set(socket, { state: JSON.parse(JSON.stringify(data)), timer: null });
        flush(socket);
      } else transmit(socket, data);
    },
    close() { for (const socket of pending.keys()) cancel(socket); },
    get pending() { return pending.size; },
  };
}
module.exports = { createStateOutbox };
