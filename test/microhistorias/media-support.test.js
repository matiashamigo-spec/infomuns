import { describe, it, expect } from 'vitest';
import {
  VIDEO_MIME_CANDIDATES,
  pickSupportedMimeType,
  getFocusExposureSupport,
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

describe('getFocusExposureSupport', () => {
  it('detects manual focus and exposure support (Android/Chrome-like capabilities)', () => {
    const result = getFocusExposureSupport({
      focusMode: ['continuous', 'manual'],
      exposureMode: ['continuous', 'manual'],
    });
    expect(result).toEqual({ canLockFocus: true, canLockExposure: true });
  });

  it('reports no support for an empty capabilities object (iPhone/Safari-like)', () => {
    expect(getFocusExposureSupport({})).toEqual({ canLockFocus: false, canLockExposure: false });
  });

  it('reports no support when given undefined', () => {
    expect(getFocusExposureSupport(undefined)).toEqual({ canLockFocus: false, canLockExposure: false });
  });

  it('reports no support when the mode list does not include manual', () => {
    const result = getFocusExposureSupport({ focusMode: ['continuous'], exposureMode: ['continuous'] });
    expect(result).toEqual({ canLockFocus: false, canLockExposure: false });
  });
});
