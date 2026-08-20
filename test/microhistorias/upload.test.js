import { describe, it, expect } from 'vitest';
import { buildUploadFormData, submitRecording, submitRecordingWithProgress, getExtensionForMimeType } from '../../public/microhistorias/upload.js';

function createFakeXhr({ status = 200, simulateNetworkError = false } = {}) {
  const uploadListeners = {};
  const xhrListeners = {};
  return {
    open: () => {},
    status,
    upload: {
      addEventListener: (event, cb) => {
        (uploadListeners[event] = uploadListeners[event] || []).push(cb);
      },
    },
    addEventListener: (event, cb) => {
      (xhrListeners[event] = xhrListeners[event] || []).push(cb);
    },
    send: () => {
      (uploadListeners.progress || []).forEach((cb) => cb({ lengthComputable: true, loaded: 50, total: 100 }));
      if (simulateNetworkError) {
        (xhrListeners.error || []).forEach((cb) => cb());
      } else {
        (xhrListeners.load || []).forEach((cb) => cb());
      }
    },
  };
}

describe('buildUploadFormData', () => {
  it('appends each interview clip as clip1, clip2, clip3', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const fd = buildUploadFormData(clips, []);
    expect(fd.get('clip1')).toBeInstanceOf(Blob);
    expect(fd.get('clip2')).toBeInstanceOf(Blob);
    expect(fd.get('clip3')).toBeInstanceOf(Blob);
    expect(fd.get('clip4')).toBeNull();
  });

  it('appends each support file under apoyo[]', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const supportFiles = [new Blob(['x']), new Blob(['y'])];
    const fd = buildUploadFormData(clips, supportFiles);
    expect(fd.getAll('apoyo[]')).toHaveLength(2);
  });

  it('works with no support files', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const fd = buildUploadFormData(clips, []);
    expect(fd.getAll('apoyo[]')).toHaveLength(0);
  });

  it('appends the phone number when provided', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const fd = buildUploadFormData(clips, [], '291 6419599');
    expect(fd.get('telefono')).toBe('291 6419599');
  });

  it('omits the phone field when not provided', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const fd = buildUploadFormData(clips, []);
    expect(fd.get('telefono')).toBeNull();
  });

  it('names webm clips with a .webm extension', () => {
    const clips = [new Blob(['a'], { type: 'video/webm;codecs=vp9,opus' })];
    const fd = buildUploadFormData(clips, []);
    expect(fd.get('clip1').name).toBe('clip1.webm');
  });

  it('names mp4 clips (Safari/iOS) with a .mp4 extension', () => {
    const clips = [new Blob(['a'], { type: 'video/mp4' })];
    const fd = buildUploadFormData(clips, []);
    expect(fd.get('clip1').name).toBe('clip1.mp4');
  });
});

describe('getExtensionForMimeType', () => {
  it('extracts webm from a codec-qualified webm type', () => {
    expect(getExtensionForMimeType('video/webm;codecs=vp9,opus')).toBe('webm');
  });

  it('extracts mp4 from a plain mp4 type', () => {
    expect(getExtensionForMimeType('video/mp4')).toBe('mp4');
  });

  it('falls back to webm for an empty type', () => {
    expect(getExtensionForMimeType('')).toBe('webm');
  });

  it('falls back to webm for an unrecognized type', () => {
    expect(getExtensionForMimeType('video/quicktime')).toBe('webm');
  });
});

describe('submitRecording', () => {
  it('resolves when the response is ok', async () => {
    const fakeFetch = async () => ({ ok: true, status: 200 });
    await expect(
      submitRecording('https://example.com/webhook', new FormData(), fakeFetch)
    ).resolves.toBeDefined();
  });

  it('throws when the response is not ok', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500 });
    await expect(
      submitRecording('https://example.com/webhook', new FormData(), fakeFetch)
    ).rejects.toThrow('Upload failed with status 500');
  });
});

describe('submitRecordingWithProgress', () => {
  it('resolves and reports progress when the response is ok', async () => {
    const progressUpdates = [];
    const fakeXhr = createFakeXhr({ status: 200 });
    await expect(
      submitRecordingWithProgress(
        'https://example.com/webhook',
        new FormData(),
        (percent) => progressUpdates.push(percent),
        () => fakeXhr
      )
    ).resolves.toBeDefined();
    expect(progressUpdates).toEqual([50]);
  });

  it('rejects when the response status is not 2xx', async () => {
    const fakeXhr = createFakeXhr({ status: 500 });
    await expect(
      submitRecordingWithProgress('https://example.com/webhook', new FormData(), () => {}, () => fakeXhr)
    ).rejects.toThrow('Upload failed with status 500');
  });

  it('rejects on network error', async () => {
    const fakeXhr = createFakeXhr({ simulateNetworkError: true });
    await expect(
      submitRecordingWithProgress('https://example.com/webhook', new FormData(), () => {}, () => fakeXhr)
    ).rejects.toThrow('Upload failed: network error');
  });
});
