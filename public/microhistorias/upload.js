// Maps a Blob's `type` (e.g. "video/webm;codecs=vp9,opus" or "video/mp4") to a
// file extension. Falls back to 'webm' when the type is empty/unrecognized,
// matching the default candidate order in media-support.js.
export function getExtensionForMimeType(mimeType) {
  const subtype = (mimeType || '').split(';')[0].split('/')[1] || '';
  if (subtype === 'mp4') return 'mp4';
  return 'webm';
}

export function buildUploadFormData(interviewClips, supportFiles) {
  const fd = new FormData();
  interviewClips.forEach((blob, i) => {
    const ext = getExtensionForMimeType(blob.type);
    fd.append(`clip${i + 1}`, blob, `clip${i + 1}.${ext}`);
  });
  (supportFiles || []).forEach((file) => {
    fd.append('apoyo[]', file, file.name || 'apoyo');
  });
  return fd;
}

export async function submitRecording(webhookUrl, formData, fetchFn = fetch) {
  const res = await fetchFn(webhookUrl, { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(`Upload failed with status ${res.status}`);
  }
  return res;
}
