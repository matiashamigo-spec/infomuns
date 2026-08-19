export function buildUploadFormData(interviewClips, supportFiles) {
  const fd = new FormData();
  interviewClips.forEach((blob, i) => {
    fd.append(`clip${i + 1}`, blob, `clip${i + 1}.webm`);
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
