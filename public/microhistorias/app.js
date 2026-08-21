// Los imports locales llevan el mismo ?v= que este archivo en index.html:
// sin eso, un navegador que ya haya cacheado una copia vieja de upload.js
// (por ejemplo) puede seguir usándola aunque app.js se actualice — y si
// cambiaron los nombres exportados entre versiones, el import rompe todo
// el módulo en silencio, dejando la página sin mostrar ninguna pantalla
// (ni el formulario ni el aviso de girar el teléfono). Bumpear la versión
// acá es tan importante como bumpearla en el <script> de index.html.
import { INTERVIEW_STEPS, getStepByIndex, isLastStep } from './steps.js?v=29';
import { buildWhatsAppLink } from './whatsapp.js?v=29';
import { VIDEO_MIME_CANDIDATES, pickSupportedMimeType } from './media-support.js?v=29';
import { watchOrientation } from './orientation.js?v=29';
import {
  batchSupportFiles,
  buildClipBatchFormData,
  buildSupportBatchFormData,
  submitBatchesWithProgress,
} from './upload.js?v=29';

// Must match the path configured on the Webhook node once the n8n workflow exists
// (see "Setup pendiente" in the design spec) — update if that path differs.
const N8N_WEBHOOK_URL = 'https://n8n.wips.digital/webhook/microhistorias';
const WHATSAPP_NUMBER = '+54 9 291 6419599';
// El envío se parte en tandas (ver upload.js: batchSupportFiles) justamente
// para evitar el techo real, que es un bug de carrera adentro del nodo
// Webhook de n8n con payloads grandes de muchos archivos — no un tamaño
// fijo. Con las tandas bien chicas, lo único que queda como techo es el
// client_max_body_size de nginx (500M, configurado aparte), muy por encima
// de lo que cualquier tanda individual pesa. Esto es solo un freno de
// sanidad para un caso realmente descontrolado.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const el = (id) => document.getElementById(id);

const screens = {
  unsupported: el('mh-unsupported-screen'),
  start: el('mh-start-screen'),
  permissionError: el('mh-permission-error'),
  record: el('mh-record-screen'),
  preview: el('mh-preview-screen'),
  support: el('mh-support-screen'),
  final: el('mh-final-screen'),
  sent: el('mh-sent-screen'),
  error: el('mh-error-screen'),
};

// Pantallas donde la cámara es protagonista: se oculta el logo para que
// el video entre completo en la pantalla sin necesidad de hacer scroll.
const CAMERA_SCREENS = ['record', 'preview'];

// En iOS/Android, cerrar el teclado o un overlay de pantalla completa a
// veces deja la página con scroll residual, tapando el título de la
// siguiente pantalla. document.documentElement/body además de window
// porque el mobile Safari no siempre respeta uno solo de los tres.
function resetScroll() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

// Después de conceder el permiso de cámara, algunos navegadores mobile
// vuelven a mover el scroll un instante después de que el layout ya cambió
// (el aviso del permiso desaparece y el contenido se reacomoda) — un solo
// reset inmediato no alcanza, hace falta uno demorado también.
function resetScrollDeferred() {
  resetScroll();
  requestAnimationFrame(resetScroll);
  setTimeout(resetScroll, 150);
  setTimeout(resetScroll, 400);
}

// 100dvh/100vh no se comportaban igual en todos los celulares (algunos
// seguían contando la barra de direcciones como parte del alto visible),
// dejando la pantalla de grabación más alta de lo que en verdad se veía —
// por eso "aparecía scrolleada" y el botón "Grabar" quedaba tapado.
// window.innerHeight sí refleja el alto real visible en cada momento.
function fitRecordScreen() {
  el('mh-record-screen').style.height = `${window.innerHeight - 16}px`;
}
window.addEventListener('resize', () => {
  if (!el('mh-record-screen').classList.contains('mh-hidden')) fitRecordScreen();
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    if (!el('mh-record-screen').classList.contains('mh-hidden')) fitRecordScreen();
  }, 300);
});

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('mh-hidden'));
  screens[name].classList.remove('mh-hidden');
  el('mh-logo').classList.toggle('mh-hidden', CAMERA_SCREENS.includes(name));
  document.body.classList.toggle('mh-compact', name === 'record');
  // El botón de WhatsApp se oculta en las pantallas de cámara (donde queda
  // flotando encima de los botones de grabar/usar) y en la de error: ahí
  // ya hay un botón de WhatsApp inline en la tarjeta, y la burbuja fija
  // (bottom:16px; right:16px) podía terminar tapando el tap sobre "Guardar
  // mis videos en el celular", el botón del medio de esa pantalla.
  el('mh-whatsapp-start').classList.toggle('mh-hidden', CAMERA_SCREENS.includes(name) || name === 'error');
  if (name === 'record') fitRecordScreen();
  resetScrollDeferred();
}

// WhatsApp links
el('mh-whatsapp-start').href = buildWhatsAppLink(WHATSAPP_NUMBER, 'Tengo una duda con Micro Historias');
el('mh-whatsapp-error').href = buildWhatsAppLink(WHATSAPP_NUMBER, 'Tuve un error al enviar mi Micro Historia');

// Orientation lock
watchOrientation((portrait) => {
  el('mh-orientation-lock').classList.toggle('is-visible', !portrait);
});

// Browser support check
const isSupported =
  typeof window.MediaRecorder !== 'undefined' &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

if (!isSupported) {
  showScreen('unsupported');
} else {
  showScreen('start');
}

// App state
let stream = null;
let recordingStream = null;
let track = null;
let currentStepIndex = 0;
const recordedClips = [];
const supportFiles = [];
let mediaRecorder = null;
let recordedChunks = [];
let pendingClipBlob = null;
let previewObjectUrl = null;
// submissionCtx guarda el folderId que devuelve la tanda de clips (para
// que las tandas de apoyo sepan a qué carpeta subir). nextBatchIndex es lo
// que permite que un reintento arranque justo donde falló, en vez de
// repetir desde cero (y duplicar el video final ya subido en Drive).
let submissionCtx = {};
let nextBatchIndex = 0;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Pedir width+height juntos define una relación de aspecto exacta —
      // eso fue lo que disparó el zoom (confirmado en dispositivo real,
      // con y sin resizeMode:'none', que no evitó el recorte). Pedir SOLO
      // la altura no define una "forma" de dos dimensiones, así que el
      // navegador no tiene una relación exacta que forzar recortando —
      // en teoría alcanza resolución más alta sin ese recorte. 'ideal'
      // (no 'exact') para no fallar duro si el dispositivo no lo soporta.
      // Pendiente: el video puede salir de costado en algunos Android.
      video: {
        facingMode: 'user',
        height: { ideal: 1920 },
      },
      audio: true,
    });
    track = stream.getVideoTracks()[0];
    recordingStream = stream;
    const video = el('mh-camera-video');
    video.srcObject = stream;
    const settings = track.getSettings();
    console.log('microhistorias: camera track settings', settings);
    el('mh-camera-debug').textContent = `${settings.width || '?'}x${settings.height || '?'}`;
    renderStep();
    showScreen('record');
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      console.error(err);
    } else {
      // The MVP has a single screen for camera/mic failures, so it can't tell
      // the person apart "permission denied" from "no camera found", "camera
      // in use", or an insecure context — only this log distinguishes it,
      // for whoever reads the console.
      console.error('microhistorias: getUserMedia failed (not a permission denial):', err.name, err);
    }
    showScreen('permissionError');
  }
}

function formatSuggestedDuration(seconds) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} segundos`;
}

function renderStep() {
  const step = getStepByIndex(currentStepIndex);
  el('mh-step-progress').textContent = `Paso ${currentStepIndex + 1} de ${INTERVIEW_STEPS.length}`;
  el('mh-step-title').textContent = step.title;
  el('mh-step-prompt').textContent = step.prompt;
  const timerEl = el('mh-step-timer');
  if (step.suggestedMaxSeconds) {
    timerEl.textContent = `Sugerencia: hasta ${formatSuggestedDuration(step.suggestedMaxSeconds)}.`;
    timerEl.classList.remove('mh-hidden');
  } else {
    timerEl.classList.add('mh-hidden');
  }
  el('mh-record-btn').classList.remove('mh-hidden');
  el('mh-stop-btn').classList.add('mh-hidden');
  // Los tips generales (luz, ruido, encuadre) solo se muestran antes del
  // primer paso — repetirlos antes de cada paso resultaba redundante.
  if (currentStepIndex === 0) {
    el('mh-tips-overlay').classList.add('is-visible');
  }
}

let recordingTimerInterval = null;
let recordingStartTime = null;

function formatElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function startRecordingTimer() {
  recordingStartTime = Date.now();
  el('mh-recording-timer').textContent = '0:00';
  el('mh-recording-indicator').classList.remove('mh-hidden');
  recordingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    el('mh-recording-timer').textContent = formatElapsed(elapsed);
  }, 1000);
}

function stopRecordingTimer() {
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
  el('mh-recording-indicator').classList.add('mh-hidden');
}

function startRecording() {
  const mimeType = pickSupportedMimeType(VIDEO_MIME_CANDIDATES, (t) => MediaRecorder.isTypeSupported(t));
  recordedChunks = [];
  // El video final se sube a Drive (no a Telegram), así que no hay que
  // recortar la calidad para entrar en el límite de 50MB de Telegram — las
  // historias se reusan en redes, así que priorizamos nitidez.
  const recorderOptions = { videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 };
  if (mimeType) recorderOptions.mimeType = mimeType;
  mediaRecorder = new MediaRecorder(recordingStream, recorderOptions);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', () => {
    stopRecordingTimer();
    pendingClipBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
    }
    previewObjectUrl = URL.createObjectURL(pendingClipBlob);
    const previewVideo = el('mh-preview-video');
    previewVideo.src = previewObjectUrl;
    showScreen('preview');
  });
  mediaRecorder.addEventListener('error', (e) => {
    console.error('microhistorias: mediaRecorder error', e.error || e);
    stopRecordingTimer();
    // 'stop' never fires after a recorder error, so without this the person
    // is stuck on the record screen with "Cortar" showing and no way out but
    // a reload. Reset to the initial record-screen state so they can retry.
    el('mh-record-btn').classList.remove('mh-hidden');
    el('mh-stop-btn').classList.add('mh-hidden');
  });
  mediaRecorder.start();
  startRecordingTimer();
  el('mh-record-btn').classList.add('mh-hidden');
  el('mh-stop-btn').classList.remove('mh-hidden');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function repeatClip() {
  pendingClipBlob = null;
  showScreen('record');
  renderStep();
}

function useClipAndContinue() {
  if (!pendingClipBlob) return;
  recordedClips.push(pendingClipBlob);
  pendingClipBlob = null;
  if (isLastStep(currentStepIndex)) {
    // No path leads back to recording from the support-material screen, so
    // it's safe to unconditionally release the camera/mic here.
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    showScreen('support');
  } else {
    currentStepIndex += 1;
    renderStep();
    showScreen('record');
  }
}

function renderSupportList() {
  const list = el('mh-support-list');
  list.innerHTML = '';
  supportFiles.forEach((file, index) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = file.name || 'Archivo agregado';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'mh-support-remove-btn';
    removeBtn.setAttribute('aria-label', 'Sacar este archivo');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeSupportFile(index));
    li.appendChild(label);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

function removeSupportFile(index) {
  supportFiles.splice(index, 1);
  renderSupportList();
}

function addSupportFiles(fileList) {
  Array.from(fileList || []).forEach((file) => supportFiles.push(file));
  renderSupportList();
}

function goToFinalScreen() {
  el('mh-final-summary').textContent =
    `Grabaste ${recordedClips.length} pasos de tu historia` +
    (supportFiles.length ? ` y agregaste ${supportFiles.length} archivo(s) de apoyo.` : '.');
  showScreen('final');
}

function getTotalUploadBytes() {
  const clipBytes = recordedClips.reduce((sum, blob) => sum + (blob ? blob.size : 0), 0);
  const supportBytes = supportFiles.reduce((sum, file) => sum + (file ? file.size : 0), 0);
  return clipBytes + supportBytes;
}

// Arma la lista de tandas a mandar: cada clip por separado primero (el
// clip 1 crea la carpeta del lado de n8n; los clips 2 y 3 usan el
// ctx.folderId que dejó la respuesta del clip 1), después el material de
// apoyo partido en tandas chicas. Nunca se mandan los 3 clips juntos en un
// solo pedido — un paso largo grabado a buena calidad puede pesar bastante
// más de 100MB él solo. El form-data de cada tanda se arma recién al
// mandarla (usa ctx.folderId) — por eso son funciones (buildFormData), no
// FormData ya armado. Se reconstruye igual en cada intento — mismo orden
// siempre — para que nextBatchIndex pueda saltarse las tandas ya mandadas.
function buildBatches(phone) {
  const supportBatchesFiles = batchSupportFiles(supportFiles);
  const hasSupport = supportBatchesFiles.length > 0;
  const batches = recordedClips.map((blob, index) => {
    const clipIndex = index + 1;
    const isLastClip = clipIndex === recordedClips.length;
    const isLastBatch = isLastClip && !hasSupport;
    return {
      buildFormData: (ctx) => buildClipBatchFormData(blob, clipIndex, phone, ctx.folderId, isLastClip, isLastBatch),
      sizeBytes: blob ? blob.size : 0,
    };
  });
  supportBatchesFiles.forEach((files, index) => {
    const isLast = index === supportBatchesFiles.length - 1;
    const bytes = files.reduce((sum, f) => sum + (f ? f.size : 0), 0);
    batches.push({
      buildFormData: (ctx) => buildSupportBatchFormData(files, ctx.folderId, phone, isLast),
      sizeBytes: bytes,
    });
  });
  return batches;
}

async function sendRecording() {
  const sendBtn = el('mh-send-btn');
  const retryBtn = el('mh-retry-upload-btn');
  const sizeMessage = el('mh-error-size-message');
  const errorDetail = el('mh-error-detail');
  errorDetail.classList.add('mh-hidden');
  const progressWrap = el('mh-progress-bar-wrap');
  const progressFill = el('mh-progress-bar-fill');
  const progressText = el('mh-progress-text');
  sendBtn.disabled = true;
  retryBtn.disabled = true;

  if (getTotalUploadBytes() > MAX_UPLOAD_BYTES) {
    console.error('microhistorias: upload skipped, payload exceeds size guard', getTotalUploadBytes());
    sizeMessage.classList.remove('mh-hidden');
    showScreen('error');
    sendBtn.disabled = false;
    retryBtn.disabled = false;
    return;
  }
  sizeMessage.classList.add('mh-hidden');

  // Reintentar desde la pantalla de error vuelve acá para que la barra de
  // progreso (que vive en la pantalla final) sea visible durante la subida.
  showScreen('final');
  progressWrap.classList.remove('mh-hidden');
  progressText.classList.remove('mh-hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'Subiendo... 0%';

  try {
    const phone = el('mh-phone-input').value.trim();
    const batches = buildBatches(phone);
    await submitBatchesWithProgress(
      N8N_WEBHOOK_URL,
      batches,
      (percent) => {
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `Subiendo... ${percent}%`;
      },
      nextBatchIndex,
      submissionCtx,
    );
    nextBatchIndex = 0;
    submissionCtx = {};
    showScreen('sent');
  } catch (err) {
    console.error(err);
    // Si ya se mandaron tandas antes de que esta fallara, un reintento
    // arranca desde la que falló — no desde cero — para no duplicar el
    // video final (y cualquier apoyo ya subido) en la carpeta de Drive.
    if (typeof err.failedAtIndex === 'number') nextBatchIndex = err.failedAtIndex;
    errorDetail.textContent = `Detalle técnico: ${err.name || 'Error'} — ${err.message || 'sin mensaje'}`;
    errorDetail.classList.remove('mh-hidden');
    showScreen('error');
    sendBtn.disabled = false;
    retryBtn.disabled = false;
  } finally {
    progressWrap.classList.add('mh-hidden');
    progressText.classList.add('mh-hidden');
  }
}

// El botón "Empezar" queda deshabilitado hasta que carguen el teléfono y acepten los términos
function updateStartButtonState() {
  const hasPhone = el('mh-phone-input').value.trim().length > 0;
  const hasAcceptedTerms = el('mh-terms-checkbox').checked;
  el('mh-start-btn').disabled = !(hasPhone && hasAcceptedTerms);
}
el('mh-phone-input').addEventListener('input', updateStartButtonState);
el('mh-terms-checkbox').addEventListener('change', updateStartButtonState);

// Respaldo por si el envío falla: cada clip grabado solo existe en memoria
// del navegador (nunca se guarda solo), así que si el envío no anda, la
// persona necesita una forma de sacarlos del celular para mandarlos a mano.
function downloadClipsSeparately() {
  // El atributo download NO es confiable para video en Safari/iOS (WebKit
  // suele ignorarlo y no pasa nada, o abre el video sin bajarlo) — es una
  // limitación del navegador, no hay forma de forzar una descarga real de
  // ahí. target="_blank" abre cada clip en su propia pestaña con el
  // reproductor nativo, y desde ahí el ícono de compartir/guardar de esa
  // pestaña SÍ deja guardarlo en Fotos — un toque más, pero el único
  // camino que funciona de verdad en iOS. Todas sincrónicas, sin
  // setTimeout: Safari solo trata como "iniciado por el usuario" lo que
  // dispara en el mismo tick del click.
  recordedClips.forEach((blob, index) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}

// Sin esto la persona no tiene forma de saber si tocar el botón hizo algo
// o no — "no pasó nada visible" fue justamente el reporte que llegó antes
// de agregar este feedback en pantalla.
function showSaveDeviceStatus(text) {
  const status = el('mh-save-device-status');
  status.textContent = text;
  status.classList.remove('mh-hidden');
}

async function saveClipsToDevice() {
  const status = el('mh-save-device-status');
  status.classList.add('mh-hidden');
  const files = recordedClips.map((blob, index) => {
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    return new File([blob], `microhistoria-paso${index + 1}.${ext}`, { type: blob.type });
  });
  console.log('microhistorias: saveClipsToDevice', {
    canShare: !!navigator.canShare,
    canShareFiles: !!(navigator.canShare && navigator.canShare({ files })),
    clipCount: files.length,
  });
  // El share nativo (si el navegador lo soporta con archivos) abre el menú
  // de "Compartir" del celular con los 3 videos juntos en una sola acción,
  // y desde ahí se puede elegir "Guardar en Fotos/Carrete" para los tres a
  // la vez. OJO: que navigator.share() resuelva sin error solo confirma que
  // el sistema operativo aceptó el pedido y lo entregó a la app elegida —
  // NO que esa app (p.ej. Fotos) haya terminado de guardar de verdad. No
  // hay forma de saber desde acá si el guardado final se completó, así que
  // además se dispara SIEMPRE la descarga directa como respaldo (por más
  // que el cartel nativo se haya cerrado "bien"), para que quede un camino
  // garantizado además del share.
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: 'Micro Historia' });
      downloadClipsSeparately();
      showSaveDeviceStatus('Se abrió el cartel para guardar tus 3 videos, y además se abrió cada uno en una pestaña nueva por las dudas — desde ahí tocá el ícono de compartir/guardar para mandarlo a Fotos.');
      return;
    } catch (err) {
      // El usuario canceló el cartel de compartir, o el navegador lo
      // rechazó a último momento: no es un error real, no hace falta avisar.
      if (err.name === 'AbortError') return;
      console.error('microhistorias: navigator.share failed, falling back', err);
    }
  }
  downloadClipsSeparately();
  showSaveDeviceStatus('Se abrió cada video en una pestaña nueva — tocá el ícono de compartir/guardar del reproductor en cada una para mandarlo a Fotos.');
}

// Event wiring
el('mh-start-btn').addEventListener('click', startCamera);
el('mh-permission-retry-btn').addEventListener('click', startCamera);
// El diagnóstico mostró que el toque caía sobre el fondo del popup
// (DIV#mh-tips-overlay), no sobre el botón — por eso el listener puesto
// solo en el botón nunca se disparaba. Escuchando en el overlay entero
// alcanza (el click en el botón también burbujea hasta acá), y de paso
// cualquier toque en el fondo del popup también lo cierra.
el('mh-tips-overlay').addEventListener('click', () => {
  el('mh-tips-overlay').classList.remove('is-visible');
  resetScrollDeferred();
});
el('mh-record-btn').addEventListener('click', startRecording);
el('mh-stop-btn').addEventListener('click', stopRecording);
el('mh-repeat-btn').addEventListener('click', repeatClip);
el('mh-continue-btn').addEventListener('click', useClipAndContinue);
el('mh-support-camera-input').addEventListener('change', (e) => {
  addSupportFiles(e.target.files);
  e.target.value = '';
});
el('mh-support-gallery-input').addEventListener('change', (e) => {
  addSupportFiles(e.target.files);
  e.target.value = '';
});
el('mh-support-continue-btn').addEventListener('click', goToFinalScreen);
el('mh-final-back-btn').addEventListener('click', () => showScreen('support'));
el('mh-send-btn').addEventListener('click', sendRecording);
el('mh-retry-upload-btn').addEventListener('click', sendRecording);
el('mh-save-device-btn').addEventListener('click', saveClipsToDevice);
