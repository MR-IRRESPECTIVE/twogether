import crypto from 'crypto';
import { ROOM_CODE_LENGTH } from '../../../shared/constants.js';

export function generateRoomCode(existingCodes) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    const randomBytes = crypto.randomBytes(ROOM_CODE_LENGTH);
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += characters[randomBytes[i] % characters.length];
    }
    
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  
  throw new Error('Failed to generate a unique room code after 10 attempts');
}
