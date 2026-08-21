import { describe, it, expect } from 'vitest';
import {
  buildUploadFormData,
  submitRecording,
  submitRecordingWithProgress,
  getExtensionForMimeType,
  batchSupportFiles,
  buildClipsBatchFormData,
  buildSupportBatchFormData,
  submitBatchesWithProgress,
  SUPPORT_BATCH_MAX_BYTES,
  SUPPORT_BATCH_MAX_FILES,
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

describe('batchSupportFiles', () => {
  it('returns no batches for an empty list', () => {
    expect(batchSupportFiles([])).toEqual([]);
  });

  it('groups small files into a single batch', () => {
    const files = [{ size: 1024 }, { size: 1024 }, { size: 1024 }];
    const batches = batchSupportFiles(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('splits into a new batch once the file-count cap is hit', () => {
    const files = Array.from({ length: SUPPORT_BATCH_MAX_FILES + 1 }, () => ({ size: 1024 }));
    const batches = batchSupportFiles(files);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(SUPPORT_BATCH_MAX_FILES);
    expect(batches[1]).toHaveLength(1);
  });

  it('splits into a new batch once the byte cap would be exceeded', () => {
    const files = [
      { size: SUPPORT_BATCH_MAX_BYTES - 100 },
      { size: 200 },
    ];
    const batches = batchSupportFiles(files);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual([files[0]]);
    expect(batches[1]).toEqual([files[1]]);
  });

  it('keeps a single file larger than the byte cap in its own batch instead of dropping it', () => {
    const hugeFile = { size: SUPPORT_BATCH_MAX_BYTES * 3 };
    const batches = batchSupportFiles([hugeFile]);
    expect(batches).toEqual([[hugeFile]]);
  });
});

describe('buildClipsBatchFormData / buildSupportBatchFormData', () => {
  it('tags the clips batch with kind=clips and isLastBatch', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const fd = buildClipsBatchFormData(clips, '291 6419599', true);
    expect(fd.get('kind')).toBe('clips');
    expect(fd.get('isLastBatch')).toBe('true');
    expect(fd.get('telefono')).toBe('291 6419599');
    expect(fd.get('clip1')).toBeInstanceOf(Blob);
    expect(fd.getAll('apoyo[]')).toHaveLength(0);
  });

  it('tags a support batch with kind=apoyo, its files, the folderId and phone', () => {
    const files = [new Blob(['x']), new Blob(['y'])];
    const fd = buildSupportBatchFormData(files, 'folder-abc', '291 6419599', false);
    expect(fd.get('kind')).toBe('apoyo');
    expect(fd.get('folderId')).toBe('folder-abc');
    expect(fd.get('isLastBatch')).toBe('false');
    expect(fd.get('telefono')).toBe('291 6419599');
    expect(fd.getAll('apoyo[]')).toHaveLength(2);
  });

  it('omits the phone field on a support batch when not provided', () => {
    const files = [new Blob(['x'])];
    const fd = buildSupportBatchFormData(files, 'folder-abc', '', true);
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
    await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 0, {}, xhrFactory);
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
      {},
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
      await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 0, {}, xhrFactory);
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
    await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 1, {}, () => fakeXhr);
    expect(sentBodies).toEqual(['batch-1']);
  });

  it('extracts folderId from the first batch response and passes it to the next batch builder', async () => {
    const receivedFolderIds = [];
    const xhrs = [
      createFakeXhr({ status: 200, responseText: JSON.stringify({ id: 'folder-xyz' }) }),
      createFakeXhr({ status: 200 }),
    ];
    let call = 0;
    const xhrFactory = () => xhrs[call++];
    const batches = [
      { buildFormData: () => ({}), sizeBytes: 50 },
      {
        buildFormData: (ctx) => {
          receivedFolderIds.push(ctx.folderId);
          return {};
        },
        sizeBytes: 50,
      },
    ];
    const ctx = await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 0, {}, xhrFactory);
    expect(receivedFolderIds).toEqual(['folder-xyz']);
    expect(ctx.folderId).toBe('folder-xyz');
  });

  it('does not overwrite an already-known folderId with a later response', async () => {
    const xhrs = [
      createFakeXhr({ status: 200, responseText: JSON.stringify({ id: 'should-not-be-used' }) }),
    ];
    const ctx = { folderId: 'already-known' };
    let call = 0;
    const xhrFactory = () => xhrs[call++];
    const batches = [{ buildFormData: () => ({}), sizeBytes: 50 }];
    await submitBatchesWithProgress('https://example.com/webhook', batches, () => {}, 0, ctx, xhrFactory);
    expect(ctx.folderId).toBe('already-known');
  });
});
