import { describe, it, expect } from 'vitest';
import {
  submitRecording,
  submitRecordingWithProgress,
  getExtensionForMimeType,
  buildClipBatchFormData,
  submitBatchesWithProgress,
} from '../../public/microhistorias/upload.js';

function createFakeXhr({ status = 200, simulateNetworkError = false, responseText = '' } = {}) {
  const uploadListeners = {};
  const xhrListeners = {};
  return {
    open: () => {},
    status,
    responseText,
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
    expect(getExtensionForMimeType('video/x-msvideo')).toBe('webm');
  });

  it('extracts mov from the quicktime type the native iOS camera produces', () => {
    expect(getExtensionForMimeType('video/quicktime')).toBe('mov');
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

describe('buildClipBatchFormData', () => {
  it('tags a clip batch with its index, submissionId and isLastClip', () => {
    const clip = new Blob(['a'], { type: 'video/webm' });
    const fd = buildClipBatchFormData(clip, 2, '291 6419599', 'submission-abc', false);
    expect(fd.get('clipIndex')).toBe('2');
    expect(fd.get('submissionId')).toBe('submission-abc');
    expect(fd.get('isLastClip')).toBe('false');
    expect(fd.get('telefono')).toBe('291 6419599');
    expect(fd.get('clip')).toBeInstanceOf(Blob);
  });

  it('marks the last clip with isLastClip=true', () => {
    const clip = new Blob(['a'], { type: 'video/mp4' });
    const fd = buildClipBatchFormData(clip, 3, '291 6419599', 'submission-abc', true);
    expect(fd.get('isLastClip')).toBe('true');
    expect(fd.get('clip').name).toBe('clip3.mp4');
  });

  it('omits the phone field when not provided', () => {
    const clip = new Blob(['a'], { type: 'video/webm' });
    const fd = buildClipBatchFormData(clip, 1, '', 'submission-abc', false);
    expect(fd.get('telefono')).toBeNull();
  });
});

describe('submitBatchesWithProgress', () => {
  it('sends every batch in order and resolves once all succeed', async () => {
    const sentBodies = [];
    const xhrs = [createFakeXhr({ status: 200 }), createFakeXhr({ status: 200 })];
    let call = 0;
    const xhrFactory = () => xhrs[call++];
    const batches = [
      { buildFormData: () => 'batch-0', sizeBytes: 50 },
      { buildFormData: () => 'batch-1', sizeBytes: 50 },
    ];
    xhrs.forEach((x) => {
      const originalSend = x.send;
      x.send = function (body) {
        sentBodies.push(body);
        originalSend.call(this);
      };
    });
    await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 0, xhrFactory);
    expect(sentBodies).toEqual(['batch-0', 'batch-1']);
  });

  it('reports overall progress weighted across all batches, not just the current one', async () => {
    const progressUpdates = [];
    const xhrs = [createFakeXhr({ status: 200 }), createFakeXhr({ status: 200 })];
    let call = 0;
    const xhrFactory = () => xhrs[call++];
    const batches = [
      { buildFormData: () => ({}), sizeBytes: 50 },
      { buildFormData: () => ({}), sizeBytes: 50 },
    ];
    await submitBatchesWithProgress(
      'https://example.com/webhook',
      batches,
      (percent) => progressUpdates.push(percent),
      0,
      xhrFactory
    );
    // Cada tanda reporta dos veces: una en vivo (evento "progress" del fake
    // xhr, loaded:50) y otra al terminar (fallback por si el navegador no
    // dispara el evento final con el 100% exacto de esa tanda) — con 2
    // tandas de 50 bytes cada una (100 en total), ambas caen en 50% y
    // 100% respectivamente, dos veces cada una.
    expect(progressUpdates).toEqual([50, 50, 100, 100]);
  });

  it('rejects with failedAtIndex set to the batch that failed', async () => {
    const xhrs = [createFakeXhr({ status: 200 }), createFakeXhr({ status: 500 })];
    let call = 0;
    const xhrFactory = () => xhrs[call++];
    const batches = [
      { buildFormData: () => ({}), sizeBytes: 50 },
      { buildFormData: () => ({}), sizeBytes: 50 },
    ];
    let caught;
    try {
      await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 0, xhrFactory);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.failedAtIndex).toBe(1);
  });

  it('resumes from startIndex, skipping already-sent batches', async () => {
    const sentBodies = [];
    const fakeXhr = createFakeXhr({ status: 200 });
    const originalSend = fakeXhr.send;
    fakeXhr.send = function (body) {
      sentBodies.push(body);
      originalSend.call(this);
    };
    const batches = [
      { buildFormData: () => 'batch-0', sizeBytes: 50 },
      { buildFormData: () => 'batch-1', sizeBytes: 50 },
    ];
    await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 1, () => fakeXhr);
    expect(sentBodies).toEqual(['batch-1']);
  });
});
