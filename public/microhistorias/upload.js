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

// n8n rompe con ENOENT cuando le llegan muchos archivos juntos en un mismo
// pedido (bug de carrera interno, confirmado con pruebas contra el webhook
// de producción: no es un límite configurable, es la copia interna de n8n
// perdiendo la carrera contra la limpieza de sus propios temp files). No
// se puede evitar con un timer — pasa en menos de un segundo, y ocurre
// adentro del nodo Webhook antes de que corra cualquier nodo nuestro, así
// que no hay forma de meter una espera en el medio. La única forma real de
// evitarlo es no mandarle tantos archivos juntos de una: se parte el envío
// en varios pedidos chicos, todos a la misma carpeta de Drive.
//
// Techo empírico seguro por tanda: en las pruebas contra producción, 100MB
// en 5 archivos pasó siempre limpio y 200MB en 10 archivos rompió siempre.
// Se deja bastante margen debajo de ese punto (no es un límite exacto, es
// una condición de carrera cuya probabilidad crece con tamaño y cantidad).
export const SUPPORT_BATCH_MAX_BYTES = 40 * 1024 * 1024;
export const SUPPORT_BATCH_MAX_FILES = 4;

export function batchSupportFiles(supportFiles) {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  (supportFiles || []).forEach((file) => {
    const wouldOverflow =
      current.length > 0 &&
      (current.length >= SUPPORT_BATCH_MAX_FILES || currentBytes + file.size > SUPPORT_BATCH_MAX_BYTES);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.size;
  });
  if (current.length > 0) batches.push(current);
  return batches;
}

// La tanda de clips siempre va primero: crea la carpeta en Drive del lado
// de n8n, que responde con esa carpeta (su `id` incluido) apenas la crea
// — sin esperar a que termine ffmpeg. El teléfono va en TODAS las tandas
// (no solo en la de clips): cada tanda es una ejecución de n8n aislada, y
// el mensaje de Telegram final puede terminar disparándose desde la última
// tanda de apoyo, que necesita el teléfono disponible en su propia data.
export function buildClipsBatchFormData(interviewClips, phone, isLastBatch) {
  const fd = buildUploadFormData(interviewClips, [], phone);
  fd.append('kind', 'clips');
  fd.append('isLastBatch', isLastBatch ? 'true' : 'false');
  return fd;
}

// Cada tanda de apoyo va sola, sin clips, con el folderId que devolvió la
// tanda de clips (o una tanda de apoyo anterior, da igual — siempre es el
// mismo valor recibido en la respuesta de esa primera tanda).
export function buildSupportBatchFormData(files, folderId, phone, isLastBatch) {
  const fd = new FormData();
  (files || []).forEach((file) => {
    fd.append('apoyo[]', file, file.name || 'apoyo');
  });
  fd.append('folderId', folderId);
  fd.append('kind', 'apoyo');
  fd.append('isLastBatch', isLastBatch ? 'true' : 'false');
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

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Manda las tandas una por una, en orden (la de clips va primero: crea la
// carpeta y devuelve su `id`, que las tandas de apoyo siguientes necesitan
// para saber a dónde subir). Cada elemento de `batches` es
// `{ buildFormData(ctx), sizeBytes }` — el form-data se arma recién antes
// de mandar esa tanda, no antes, porque las tandas de apoyo necesitan el
// `folderId` que trae `ctx` después de que la tanda de clips respondió.
//
// Si una tanda falla, el error lleva `failedAtIndex` para que un reintento
// pueda arrancar justo ahí (con el mismo `ctx`, ya con el folderId adentro)
// — repetir desde cero duplicaría el video final en la carpeta de Drive.
export async function submitBatchesWithProgress(webhookUrl, batches, onProgress, startIndex = 0, ctx = {}, xhrFactory = () => new XMLHttpRequest()) {
  const totalBytes = batches.reduce((sum, b) => sum + b.sizeBytes, 0) || 1;
  let bytesDoneBefore = batches.slice(0, startIndex).reduce((sum, b) => sum + b.sizeBytes, 0);
  for (let i = startIndex; i < batches.length; i++) {
    const batch = batches[i];
    const formData = batch.buildFormData(ctx);
    let responseText;
    try {
      responseText = await sendOneBatch(webhookUrl, formData, xhrFactory, (loaded) => {
        if (onProgress) onProgress(Math.round(((bytesDoneBefore + loaded) / totalBytes) * 100));
      });
    } catch (err) {
      err.failedAtIndex = i;
      throw err;
    }
    const body = parseJsonSafe(responseText);
    if (body && body.id && !ctx.folderId) ctx.folderId = body.id;
    bytesDoneBefore += batch.sizeBytes;
    if (onProgress) onProgress(Math.round((bytesDoneBefore / totalBytes) * 100));
  }
  return ctx;
}
