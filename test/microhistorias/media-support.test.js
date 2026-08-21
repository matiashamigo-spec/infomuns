import { describe, it, expect } from 'vitest';
import {
  VIDEO_MIME_CANDIDATES,
  pickSupportedMimeType,
} from '../../public/microhistorias/media-support.js';

describe('pickSupportedMimeType', () => {
  it('returns the first supported candidate in priority order', () => {
    const isSupported = (type) => type === 'video/webm;codecs=vp9,opus' || type === 'video/webm';
    expect(pickSupportedMimeType(VIDEO_MIME_CANDIDATES, isSupported)).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls back to a later candidate when earlier ones are unsupported', () => {
    const isSupported = (type) => type === 'video/mp4';
    expect(pickSupportedMimeType(VIDEO_MIME_CANDIDATES, isSupported)).toBe('video/mp4');
  });

  it('returns null when nothing is supported', () => {
    expect(pickSupportedMimeType(VIDEO_MIME_CANDIDATES, () => false)).toBeNull();
  });
});
