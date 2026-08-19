import { INTERVIEW_STEPS, getStepByIndex, isLastStep } from './steps.js';
import { buildWhatsAppLink } from './whatsapp.js';
import { VIDEO_MIME_CANDIDATES, pickSupportedMimeType, getFocusExposureSupport } from './media-support.js';
import { watchOrientation } from './orientation.js';
import { buildUploadFormData, submitRecording } from './upload.js';

// Must match the path configured on the Webhook node once the n8n workflow exists
// (see "Setup pendiente" in the design spec) — update if that path differs.
const N8N_WEBHOOK_URL = 'https://n8n.wips.digital/webhook/microhistorias';
const WHATSAPP_NUMBER = '+54 9 291 6419599';

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

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('mh-hidden'));
  screens[name].classList.remove('mh-hidden');
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
let track = null;
let currentStepIndex = 0;
const recordedClips = [];
const supportFiles = [];
let mediaRecorder = null;
let recordedChunks = [];
let pendingClipBlob = null;
let previewObjectUrl = null;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: true,
    });
    track = stream.getVideoTracks()[0];
    const video = el('mh-camera-video');
    video.srcObject = stream;
    setupFocusExposureButtons();
    renderStep();
    showScreen('record');
  } catch (err) {
    showScreen('permissionError');
  }
}

function setupFocusExposureButtons() {
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
}

function renderStep() {
  const step = getStepByIndex(currentStepIndex);
  el('mh-step-progress').textContent = `Paso ${currentStepIndex + 1} de ${INTERVIEW_STEPS.length}`;
  el('mh-step-title').textContent = step.title;
  el('mh-step-prompt').textContent = step.prompt;
  const timerEl = el('mh-step-timer');
  if (step.suggestedMaxSeconds) {
    timerEl.textContent = `Sugerencia: no más de ${step.suggestedMaxSeconds} segundos (no es obligatorio).`;
    timerEl.classList.remove('mh-hidden');
  } else {
    timerEl.classList.add('mh-hidden');
  }
  el('mh-record-btn').classList.remove('mh-hidden');
  el('mh-stop-btn').classList.add('mh-hidden');
}

function startRecording() {
  const mimeType = pickSupportedMimeType(VIDEO_MIME_CANDIDATES, (t) => MediaRecorder.isTypeSupported(t));
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', () => {
    pendingClipBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
    }
    previewObjectUrl = URL.createObjectURL(pendingClipBlob);
    const previewVideo = el('mh-preview-video');
    previewVideo.src = previewObjectUrl;
    showScreen('preview');
  });
  mediaRecorder.start();
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
  recordedClips.push(pendingClipBlob);
  pendingClipBlob = null;
  if (isLastStep(currentStepIndex)) {
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
  supportFiles.forEach((file) => {
    const li = document.createElement('li');
    li.textContent = file.name || 'Archivo agregado';
    list.appendChild(li);
  });
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

async function sendRecording() {
  const formData = buildUploadFormData(recordedClips, supportFiles);
  try {
    await submitRecording(N8N_WEBHOOK_URL, formData);
    showScreen('sent');
  } catch (err) {
    showScreen('error');
  }
}

// Event wiring
el('mh-start-btn').addEventListener('click', startCamera);
el('mh-permission-retry-btn').addEventListener('click', startCamera);
el('mh-record-btn').addEventListener('click', startRecording);
el('mh-stop-btn').addEventListener('click', stopRecording);
el('mh-repeat-btn').addEventListener('click', repeatClip);
el('mh-continue-btn').addEventListener('click', useClipAndContinue);
el('mh-support-camera-input').addEventListener('change', (e) => addSupportFiles(e.target.files));
el('mh-support-gallery-input').addEventListener('change', (e) => addSupportFiles(e.target.files));
el('mh-support-continue-btn').addEventListener('click', goToFinalScreen);
el('mh-send-btn').addEventListener('click', sendRecording);
el('mh-retry-upload-btn').addEventListener('click', sendRecording);
