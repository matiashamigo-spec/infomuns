// Maps a Blob's `type` (e.g. "video/webm;codecs=vp9,opus" or "video/mp4") to a
// file extension. Falls back to 'webm' when the type is empty/unrecognized,
// matching the default candidate order in media-support.js.
export function getExtensionForMimeType(mimeType) {
  const subtype = (mimeType || '').split(';')[0].split('/')[1] || '';
  if (subtype === 'mp4') return 'mp4';
  return 'webm';
}

// Cada clip va en SU PROPIO pedido, no los 3 juntos: un solo paso largo
// puede pesar bastante más de 100MB él solo a buena calidad, y disparar un
// bug de carrera en el nodo Webhook de n8n con payloads grandes. submissionId
// se genera una sola vez del lado del cliente (no lo devuelve el servidor)
// y viaja en los 3 pedidos, para que n8n sepa que son la misma entrega
// aunque lleguen en 3 ejecuciones separadas. El teléfono va en todos los
// pedidos: cada uno es una ejecución de n8n aislada.
export function buildClipBatchFormData(clipBlob, clipIndex, phone, submissionId, isLastClip) {
  const fd = new FormData();
  const ext = getExtensionForMimeType(clipBlob.type);
  fd.append('clip', clipBlob, `clip${clipIndex}.${ext}`);
  fd.append('clipIndex', String(clipIndex));
  fd.append('submissionId', submissionId);
  fd.append('isLastClip', isLastClip ? 'true' : 'false');
  if (phone) fd.append('telefono', phone);
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

function sendOneBatch(webhookUrl, formData, xhrFactory, onBatchProgress) {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('POST', webhookUrl);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onBatchProgress(e.loaded);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')));
    xhr.send(formData);
  });
}

// Manda los clips uno por uno, en orden. Cada elemento de `batches` es
// `{ buildFormData(), sizeBytes }`.
//
// Si un clip falla, el error lleva `failedAtIndex` para que un reintento
// pueda arrancar justo ahí, en vez de repetir desde cero.
export async function submitBatchesWithProgress(webhookUrl, batches, onProgress, startIndex = 0, xhrFactory = () => new XMLHttpRequest()) {
  const totalBytes = batches.reduce((sum, b) => sum + b.sizeBytes, 0) || 1;
  let bytesDoneBefore = batches.slice(0, startIndex).reduce((sum, b) => sum + b.sizeBytes, 0);
  for (let i = startIndex; i < batches.length; i++) {
    const batch = batches[i];
    const formData = batch.buildFormData();
    try {
      await sendOneBatch(webhookUrl, formData, xhrFactory, (loaded) => {
        if (onProgress) onProgress(Math.round(((bytesDoneBefore + loaded) / totalBytes) * 100));
      });
    } catch (err) {
      err.failedAtIndex = i;
      throw err;
    }
    bytesDoneBefore += batch.sizeBytes;
    if (onProgress) onProgress(Math.round((bytesDoneBefore / totalBytes) * 100));
  }
}
