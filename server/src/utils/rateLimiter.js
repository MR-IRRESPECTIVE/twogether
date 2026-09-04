import { JOIN_RATE_LIMIT_MAX, JOIN_RATE_LIMIT_WINDOW_MS } from '../../../shared/constants.js';

export class RateLimiter {
  constructor() {
    this.attempts = new Map();
  }

  isRateLimited(ip) {
    const now = Date.now();
    this._cleanup(now);

    let entry = this.attempts.get(ip);
    if (!entry) {
      entry = { count: 0, firstAttemptAt: now };
      this.attempts.set(ip, entry);
    }

    if (now - entry.firstAttemptAt > JOIN_RATE_LIMIT_WINDOW_MS) {
      entry.count = 1;
      entry.firstAttemptAt = now;
      return false;
    }

    if (entry.count >= JOIN_RATE_LIMIT_MAX) {
      return true;
    }

    entry.count++;
    return false;
  }

  _cleanup(now) {
    for (const [ip, entry] of this.attempts.entries()) {
      if (now - entry.firstAttemptAt > JOIN_RATE_LIMIT_WINDOW_MS) {
        this.attempts.delete(ip);
      }
    }
  }
}
