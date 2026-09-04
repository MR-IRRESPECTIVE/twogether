// Shared constants for Twogether — used by both server and client.
// Keep this file free of Node.js or browser-specific APIs so it can be
// imported from either environment.

export const MAX_PARTICIPANTS = 4;
export const MIN_PARTICIPANTS = 2;
export const MAX_PHOTOS_PER_SESSION = 20;
export const RECONNECT_GRACE_MS = 90_000; // 90 seconds
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const ROOM_INACTIVITY_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const COUNTDOWN_SECONDS = 3;
export const ROOM_CODE_LENGTH = 6;

// Photo capture
export const PHOTO_MAX_DIMENSION = 1920; // max px on longest edge before relay upload
export const PHOTO_JPEG_QUALITY = 0.82;

// Cleanup sweep intervals (server-only usage, but defined here for visibility)
export const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
export const ROOM_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

// Rate limiting
export const JOIN_RATE_LIMIT_MAX = 10; // max join attempts
export const JOIN_RATE_LIMIT_WINDOW_MS = 60_000; // per minute

// Session stages (state machine)
export const STAGES = {
  LOBBY: 'LOBBY',
  FORMAT_SELECT: 'FORMAT_SELECT',
  BOOTH: 'BOOTH',
  SELECTION: 'SELECTION',
  CUSTOMIZE: 'CUSTOMIZE',
  REVEAL: 'REVEAL',
  ENDED: 'ENDED',
};

// Participant colours — preset palette for the colour picker
export const PARTICIPANT_COLORS = [
  '#F2665E', // coral (brand primary)
  '#7B9EC4', // soft blue
  '#6BCB77', // mint green
  '#FFD93D', // warm yellow
  '#C77DFF', // lavender
  '#FF8FA3', // rose
  '#4ECDC4', // teal
  '#FF6B35', // tangerine
];
