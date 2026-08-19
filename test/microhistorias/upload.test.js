import { describe, it, expect } from 'vitest';
import { buildUploadFormData, submitRecording, getExtensionForMimeType } from '../../public/microhistorias/upload.js';

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
