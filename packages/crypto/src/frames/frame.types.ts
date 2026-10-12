import type { Cipher } from '../ciphers/cipher.types.js';

/** @internal */
export interface FrameMatch {
  start: number;
  end: number;
  cipher: Cipher;
  text: string;
}

/** @internal */
export interface FrameScanResult {
  matches: FrameMatch[];
  occupied: Array<readonly [start: number, end: number]>;
}
