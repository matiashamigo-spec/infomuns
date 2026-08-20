import { INTERVIEW_STEPS, getStepByIndex, isLastStep } from './steps.js';
import { buildWhatsAppLink } from './whatsapp.js';
import { VIDEO_MIME_CANDIDATES, pickSupportedMimeType, getFocusExposureSupport } from './media-support.js';
import { watchOrientation } from './orientation.js';
import { buildUploadFormData, submitRecordingWithProgress } from './upload.js';

// Must match the path configured on the Webhook node once the n8n workflow exists
// (see "Setup pendiente" in the design spec) — update if that path differs.
const N8N_WEBHOOK_URL = 'https://n8n.wips.digital/webhook/microhistorias';
const WHATSAPP_NUMBER = '+54 9 291 6419599';
// The final video no longer goes to Telegram directly (Telegram's Bot API
// caps uploads at 50MB regardless of video/document, which a 7-minute
// interview blows past at any usable quality) — it's uploaded to Google
// Drive instead, so this is just a sanity ceiling against a runaway payload,
// not a hard downstream limit.
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

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('mh-hidden'));
  screens[name].classList.remove('mh-hidden');
  el('mh-logo').classList.toggle('mh-hidden', CAMERA_SCREENS.includes(name));
  document.body.classList.toggle('mh-compact', name === 'record');
  // El botón de WhatsApp se oculta solo en las pantallas de cámara (donde
  // queda flotando encima de los botones de grabar/usar). En el resto —
  // inicio, material de apoyo, envío, etc. — queda visible por si hay dudas.
  el('mh-whatsapp-start').classList.toggle('mh-hidden', CAMERA_SCREENS.includes(name));
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
let focusExposureButtonsWired = false;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Sin width/height/aspectRatio: cualquier hint de forma le pide al
      // navegador recortar el sensor para llegar a esa relación, dando zoom
      // no deseado. Se probó corregir la orientación con un canvas de por
      // medio (dibujar cada cuadro antes de grabarlo), pero eso sobrecarga
      // el procesador del celular y deja toda la app lenta — peor que el
      // problema que intentaba arreglar. Se graba el stream crudo directo;
      // el video puede salir de costado en algunos Android, pendiente.
      video: { facingMode: 'user' },
      audio: true,
    });
    track = stream.getVideoTracks()[0];
    recordingStream = stream;
    const video = el('mh-camera-video');
    video.srcObject = stream;
    setupFocusExposureButtons();
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

function setupFocusExposureButtons() {
  if (focusExposureButtonsWired) return;
  const focusBtn = el('mh-focus-lock-btn');
  const exposureBtn = el('mh-exposure-lock-btn');
  if (!track || typeof track.getCapabilities !== 'function') return;
  const capabilities = track.getCapabilities();
  const support = getFocusExposureSupport(capabilities);

  if (support.canLockFocus) {
    focusBtn.classList.remove('mh-hidden');
    focusBtn.addEventListener('click', () => {
      track.applyConstraints({ advanced: [{ focusMode: 'manual' }] });
    });
  }
  if (support.canLockExposure) {
    exposureBtn.classList.remove('mh-hidden');
    exposureBtn.addEventListener('click', () => {
      track.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
    });
  }
  focusExposureButtonsWired = true;
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
    const formData = buildUploadFormData(recordedClips, supportFiles, phone);
    await submitRecordingWithProgress(N8N_WEBHOOK_URL, formData, (percent) => {
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `Subiendo... ${percent}%`;
    });
    showScreen('sent');
  } catch (err) {
    console.error(err);
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
function saveClipsToDevice() {
  // Todas sincrónicas, sin setTimeout: Safari en iOS solo trata como
  // "iniciada por el usuario" la descarga que dispara en el mismo tick del
  // click — cualquiera diferida con setTimeout (aunque sea 0ms) la bloquea
  // en silencio. Por eso antes solo bajaba el clip 1.
  recordedClips.forEach((blob, index) => {
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `microhistoria-paso${index + 1}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
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
