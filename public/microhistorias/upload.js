// Maps a Blob's/File's `type` to a file extension. 'quicktime' (.mov) is the
// container the native camera app on iOS actually produces — sin esto,
// cualquier clip grabado con la cámara nativa de un iPhone caía en el
// fallback 'webm', un contenedor que ese archivo ni siquiera es.
export function getExtensionForMimeType(mimeType) {
  const subtype = (mimeType || '').split(';')[0].split('/')[1] || '';
  if (subtype === 'mp4') return 'mp4';
  if (subtype === 'quicktime') return 'mov';
  return 'webm';
}

// Cada clip va en SU PROPIO pedido, no los 3 juntos: un solo paso largo
// puede pesar bastante más de 100MB él solo a buena calidad.
//
// El binario va como body CRUDO de la request, sin envolver en
// multipart/form-data — los metadatos (clipIndex, submissionId, etc.) van
// en la URL como query params en vez de como campos del multipart.
// Motivo: un clip real de ~412MB enviado como multipart (binario + 4
// campos de texto) disparó el bug de carrera documentado en el nodo
// Webhook de n8n al parsear los límites del multipart — confirmado real
// (ejecución 646670: el body llegó vacío, sin ninguno de los campos que sí
// mandó el cliente). Sacar el multipart del todo, no solo reducir campos,
// es la forma más segura de evitar ese parseo frágil con archivos grandes.
export function buildClipUploadUrl(baseUrl, clipIndex, phone, submissionId, isLastClip, sizeBytes) {
  const url = new URL(baseUrl);
  url.searchParams.set('clipIndex', String(clipIndex));
  url.searchParams.set('submissionId', submissionId);
  url.searchParams.set('isLastClip', isLastClip ? 'true' : 'false');
  // El servidor manda cada clip a Telegram apenas llega. Le mandamos el
  // tamaño ya calculado acá para que n8n decida el destino sin tener que
  // leer el archivo del disco.
  url.searchParams.set('sizeBytes', String(sizeBytes));
  if (phone) url.searchParams.set('telefono', phone);
  return url.toString();
}

export async function submitRecording(uploadUrl, file, fetchFn = fetch) {
  const res = await fetchFn(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed with status ${res.status}`);
  }
  return res;
}

// fetch() has no native upload-progress event, so the final send screen (which
// needs a live percentage) goes through XMLHttpRequest instead. xhrFactory is
// injectable so tests can supply a fake XHR without touching the network.
export function submitRecordingWithProgress(uploadUrl, file, onProgress, xhrFactory = () => new XMLHttpRequest()) {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
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
    xhr.send(file);
  });
}

function sendOneBatch(uploadUrl, file, xhrFactory, onBatchProgress) {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onBatchProgress(e.loaded);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')));
    xhr.send(file);
  });
}

// Manda los clips uno por uno, en orden. Cada elemento de `batches` es
// `{ url, file, sizeBytes }` — la URL ya trae los query params de ese clip.
//
// Si un clip falla, el error lleva `failedAtIndex` para que un reintento
// pueda arrancar justo ahí, en vez de repetir desde cero.
export async function submitBatchesWithProgress(batches, onProgress, startIndex = 0, xhrFactory = () => new XMLHttpRequest()) {
  const totalBytes = batches.reduce((sum, b) => sum + b.sizeBytes, 0) || 1;
  let bytesDoneBefore = batches.slice(0, startIndex).reduce((sum, b) => sum + b.sizeBytes, 0);
  for (let i = startIndex; i < batches.length; i++) {
    const batch = batches[i];
    try {
      await sendOneBatch(batch.url, batch.file, xhrFactory, (loaded) => {
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
