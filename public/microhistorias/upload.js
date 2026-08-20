// Maps a Blob's `type` (e.g. "video/webm;codecs=vp9,opus" or "video/mp4") to a
// file extension. Falls back to 'webm' when the type is empty/unrecognized,
// matching the default candidate order in media-support.js.
export function getExtensionForMimeType(mimeType) {
  const subtype = (mimeType || '').split(';')[0].split('/')[1] || '';
  if (subtype === 'mp4') return 'mp4';
  return 'webm';
}

export function buildUploadFormData(interviewClips, supportFiles, phone) {
  const fd = new FormData();
  interviewClips.forEach((blob, i) => {
    const ext = getExtensionForMimeType(blob.type);
    fd.append(`clip${i + 1}`, blob, `clip${i + 1}.${ext}`);
  });
  (supportFiles || []).forEach((file) => {
    fd.append('apoyo[]', file, file.name || 'apoyo');
  });
  if (phone) {
    fd.append('telefono', phone);
  }
  return fd;
}

export async function submitRecording(webhookUrl, formData, fetchFn = fetch) {
  const res = await fetchFn(webhookUrl, { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(`Upload failed with status ${res.status}`);
  }
  return res;
}

// fetch() has no native upload-progress event, so the final send screen (which
// needs a live percentage) goes through XMLHttpRequest instead. xhrFactory is
// injectable so tests can supply a fake XHR without touching the network.
export function submitRecordingWithProgress(webhookUrl, formData, onProgress, xhrFactory = () => new XMLHttpRequest()) {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('POST', webhookUrl);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr);
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')));
    xhr.send(formData);
  });
}
