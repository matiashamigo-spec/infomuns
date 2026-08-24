// Los imports locales llevan el mismo ?v= que este archivo en index.html:
// sin eso, un navegador que ya haya cacheado una copia vieja de upload.js
// (por ejemplo) puede seguir usándola aunque app.js se actualice — y si
// cambiaron los nombres exportados entre versiones, el import rompe todo
// el módulo en silencio, dejando la página sin mostrar ninguna pantalla
// (ni el formulario ni el aviso de girar el teléfono). Bumpear la versión
// acá es tan importante como bumpearla en el <script> de index.html.
import { INTERVIEW_STEPS, getStepByIndex, isLastStep } from './steps.js?v=46';
import { buildWhatsAppLink } from './whatsapp.js?v=46';
import { watchOrientation } from './orientation.js?v=46';
import { buildClipUploadUrl, submitBatchesWithProgress } from './upload.js?v=46';

// Historial de por qué esta app NO graba nada dentro de la página (ni con
// getUserMedia+MediaRecorder, ni con la cámara nativa vía <input capture>,
// ni con MediaRecorder sobre un canvas): las tres formas se probaron en
// sesiones reales y las tres fallaron por límites de navegador, no por
// bugs de implementación —
//   1. getUserMedia+MediaRecorder directo: frame rate real de solo ~2.5fps
//      en un dispositivo real pese a pedir 30fps (VFR severo, video ilegible).
//   2. <input capture> (cámara nativa "en la página"): Safari en iOS fuerza
//      360x480 en la grabación en vivo vía HTML media capture — decisión de
//      diseño de Apple, no arreglable desde HTML (confirmado real: un clip
//      llegó exactamente a esa resolución).
//   3. MediaRecorder sobre un canvas (para forzar frame rate constante):
//      roto en Safari/WebKit — bugs documentados (WebKit #229611 "produces
//      blank video", #181663 cuelga la página al cortar) — confirmado real:
//      "se rompió todo" al tocar Grabar en un iPhone.
// La salida: la persona graba con la Cámara nativa de su celular (fuera de
// esta página, a la calidad real del teléfono) y vuelve acá para ELEGIR ese
// video con un <input type="file">. La guía (título, consigna, tips,
// ejemplo de encuadre) se muestra ANTES de que la persona vaya a grabar,
// no durante.
//
// El límite #2 de arriba (360x480 en vivo) está confirmado real SOLO en
// iOS — en Android, grabar directo desde el input dio 1080x1920 sin
// problema (confirmado real también). Por eso el input se configura
// distinto según la plataforma: en Android se agrega `capture="user"`
// (un toque abre la cámara directo, sin el menú de opciones — no hace
// falta el rodeo de "grabá aparte y elegí Fototeca" porque ahí no hay
// nada que evitar); en iOS se deja SIN `capture`, así aparece el menú que
// permite llegar a Fototeca (el único camino de buena calidad ahí).
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

const N8N_WEBHOOK_URL = 'https://n8n.wips.digital/webhook/microhistorias';
const WHATSAPP_NUMBER = '+54 9 291 6419599';
// Cada clip se manda en su propio pedido (ver upload.js) — cada uno pega
// contra el client_max_body_size de nginx (500M) de forma INDEPENDIENTE,
// así que el chequeo tiene que ser por clip, no sobre la suma de los 3.
const MAX_CLIP_BYTES = 500 * 1024 * 1024;

const el = (id) => document.getElementById(id);

const screens = {
  start: el('mh-start-screen'),
  record: el('mh-record-screen'),
  preview: el('mh-preview-screen'),
  final: el('mh-final-screen'),
  sent: el('mh-sent-screen'),
  error: el('mh-error-screen'),
};

// Pantallas donde el video es protagonista: se oculta el logo para que
// entre completo en la pantalla sin necesidad de hacer scroll.
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

// Después de volver de elegir un archivo, algunos navegadores mobile
// vuelven a mover el scroll un instante después de que el layout ya cambió
// — un solo reset inmediato no alcanza, hace falta uno demorado también.
function resetScrollDeferred() {
  resetScroll();
  requestAnimationFrame(resetScroll);
  setTimeout(resetScroll, 150);
  setTimeout(resetScroll, 400);
}

// 100dvh/100vh no se comportaban igual en todos los celulares (algunos
// seguían contando la barra de direcciones como parte del alto visible),
// dejando la pantalla más alta de lo que en verdad se veía. window.innerHeight
// sí refleja el alto real visible en cada momento.
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
  // flotando encima de los botones) y en la de error: ahí ya hay un botón
  // de WhatsApp inline en la tarjeta.
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

// Configuración por plataforma (ver el comentario largo sobre IS_IOS más
// arriba). Corre una sola vez, no cambia durante la sesión.
if (IS_IOS) {
  el('mh-camera-capture-input').removeAttribute('capture');
  el('mh-record-btn').textContent = 'Grabar o elegir video';
  el('mh-record-instruction').textContent = 'Grabá con tu Cámara y elegí Fototeca acá.';
  el('mh-tips-quality-tip').innerHTML =
    'Grabá cada paso con la Cámara de tu celular y, en cada pantalla, elegí <strong>Fototeca</strong> para usar ese video — así sale en mejor calidad.';
} else {
  el('mh-camera-capture-input').setAttribute('capture', 'user');
  el('mh-record-btn').textContent = 'Grabar';
  el('mh-record-instruction').textContent = 'Tocá el botón para grabar este paso.';
  el('mh-tips-quality-tip').textContent = 'En cada paso vas a poder grabar directo desde acá, con la cámara frontal.';
}

showScreen('start');

// App state
let currentStepIndex = 0;
const recordedClips = [];
let pendingClipBlob = null;
let previewObjectUrl = null;
// submissionId identifica esta entrega para que los 3 clips (cada uno un
// pedido HTTP separado, cada uno una ejecución de n8n aislada) se puedan
// agrupar del lado del servidor. Se genera una sola vez, al primer intento
// de envío, y se reusa en los reintentos (generar uno nuevo en un retry
// dejaría huérfanos los clips ya mandados con el id viejo). nextBatchIndex
// es lo que permite que un reintento arranque justo donde falló, en vez de
// repetir desde cero.
let submissionId = null;
let nextBatchIndex = 0;

function goToFirstStep() {
  renderStep();
  showScreen('record');
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
    timerEl.textContent = `No te recomendamos pasarte de ${formatSuggestedDuration(step.suggestedMaxSeconds)}: un video muy largo puede quedar demasiado pesado para subirlo.`;
    timerEl.classList.remove('mh-hidden');
  } else {
    timerEl.classList.add('mh-hidden');
  }
  // Los tips generales (luz, ruido, encuadre, ejemplo de plano) solo se
  // muestran antes del primer paso, en el popup — repetirlos en la pantalla
  // de cada paso (o incluso solo en el paso 1) resultaba redundante.
  if (currentStepIndex === 0) {
    el('mh-tips-overlay').classList.add('is-visible');
  }
}

// "Ya lo grabé, elegir video" abre el selector de archivos (sin capture:
// ver el comentario largo al principio del archivo sobre por qué).
function openFilePicker() {
  el('mh-camera-capture-input').click();
}

// No hay forma de saber duración/calidad mientras la persona graba (pasa
// fuera de esta página) — se leen del archivo YA elegido, con un solo probe
// para las dos cosas. La duración es solo informativa (no bloquea). La
// resolución SÍ bloquea "Usar este y seguir": el techo conocido de iOS al
// grabar en vivo (en vez de elegir de Fototeca) es 360x480 — si el video
// viene por debajo de eso, seguro pasó por ese camino, y en vez de confiar
// en que la persona haya leído la explicación del menú, el sistema lo
// agarra solo y pide repetirlo.
const MIN_ACCEPTABLE_DIMENSION = 640;

function checkClipMetadata(file) {
  const durationWarningEl = el('mh-duration-warning');
  const qualityErrorEl = el('mh-clip-quality-error');
  durationWarningEl.classList.add('mh-hidden');
  qualityErrorEl.classList.add('mh-hidden');
  const step = getStepByIndex(currentStepIndex);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  const probeUrl = URL.createObjectURL(file);
  probe.src = probeUrl;
  probe.addEventListener('loadedmetadata', () => {
    URL.revokeObjectURL(probeUrl);
    if (step.suggestedMaxSeconds && probe.duration > step.suggestedMaxSeconds + 10) {
      durationWarningEl.textContent = `Este paso sugería ${formatSuggestedDuration(step.suggestedMaxSeconds)} y grabaste más — no pasa nada, pero va a tardar más en subir. Si preferís, repetilo más corto.`;
      durationWarningEl.classList.remove('mh-hidden');
    }
    if (Math.max(probe.videoWidth, probe.videoHeight) < MIN_ACCEPTABLE_DIMENSION) {
      qualityErrorEl.textContent = `Este video salió en baja calidad (${probe.videoWidth}x${probe.videoHeight}) — parece que se grabó con "Tomar foto o video" en vez de elegirlo de Fototeca. Repetí el paso: grabá primero con la Cámara, después tocá el botón acá y elegí Fototeca.`;
      qualityErrorEl.classList.remove('mh-hidden');
      el('mh-continue-btn').classList.add('mh-hidden');
    }
  });
}

function handleCapturedFile(file) {
  pendingClipBlob = file;
  checkClipMetadata(file);
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }
  previewObjectUrl = URL.createObjectURL(pendingClipBlob);
  const previewVideo = el('mh-preview-video');
  previewVideo.src = previewObjectUrl;

  // Chequeo por clip (no por el total de los 3): así se manda cada uno,
  // así lo limita nginx. Si este clip solo ya pasa el techo, ni tiene
  // sentido dejar avanzar — no hay forma de que ese pedido llegue a n8n.
  const sizeErrorEl = el('mh-clip-size-error');
  if (file.size > MAX_CLIP_BYTES) {
    const sizeMB = Math.round(file.size / (1024 * 1024));
    sizeErrorEl.textContent = `Este clip pesa ${sizeMB}MB, demasiado para enviarlo (máx. 500MB). Repetí el paso más corto.`;
    sizeErrorEl.classList.remove('mh-hidden');
    el('mh-continue-btn').classList.add('mh-hidden');
  } else {
    sizeErrorEl.classList.add('mh-hidden');
    el('mh-continue-btn').classList.remove('mh-hidden');
  }

  showScreen('preview');
}

function repeatClip() {
  pendingClipBlob = null;
  el('mh-duration-warning').classList.add('mh-hidden');
  el('mh-clip-size-error').classList.add('mh-hidden');
  el('mh-clip-quality-error').classList.add('mh-hidden');
  el('mh-continue-btn').classList.remove('mh-hidden');
  showScreen('record');
  renderStep();
}

function useClipAndContinue() {
  if (!pendingClipBlob) return;
  recordedClips.push(pendingClipBlob);
  pendingClipBlob = null;
  if (isLastStep(currentStepIndex)) {
    goToFinalScreen();
  } else {
    currentStepIndex += 1;
    renderStep();
    showScreen('record');
  }
}

function goToFinalScreen() {
  el('mh-final-summary').textContent = `Grabaste ${recordedClips.length} pasos de tu historia.`;
  showScreen('final');
}

// Arma la lista de tandas a mandar: cada clip en su propio pedido — nunca
// los 3 juntos, un solo paso largo grabado a buena calidad puede pesar
// bastante más de 100MB él solo. Se reconstruye igual en cada intento —
// mismo orden siempre — para que nextBatchIndex pueda saltarse las tandas
// ya mandadas.
function buildBatches(phone) {
  return recordedClips.map((blob, index) => {
    const clipIndex = index + 1;
    const isLastClip = clipIndex === recordedClips.length;
    return {
      url: buildClipUploadUrl(N8N_WEBHOOK_URL, clipIndex, phone, submissionId, isLastClip, blob.size),
      file: blob,
      sizeBytes: blob ? blob.size : 0,
    };
  });
}

async function sendRecording() {
  const sendBtn = el('mh-send-btn');
  const retryBtn = el('mh-retry-upload-btn');
  const errorDetail = el('mh-error-detail');
  errorDetail.classList.add('mh-hidden');
  const progressWrap = el('mh-progress-bar-wrap');
  const progressFill = el('mh-progress-bar-fill');
  const progressText = el('mh-progress-text');
  const progressPatience = el('mh-progress-patience');
  sendBtn.disabled = true;
  retryBtn.disabled = true;

  // El chequeo de tamaño ya se hizo por clip, apenas se eligió cada uno
  // (ver handleCapturedFile) — a esta altura ningún clip en recordedClips
  // puede superar MAX_CLIP_BYTES, así que no hace falta revalidar acá.

  // Reintentar desde la pantalla de error vuelve acá para que la barra de
  // progreso (que vive en la pantalla final) sea visible durante la subida.
  showScreen('final');
  progressWrap.classList.remove('mh-hidden');
  progressText.classList.remove('mh-hidden');
  progressPatience.classList.remove('mh-hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'Subiendo... 0%';

  try {
    if (!submissionId) submissionId = crypto.randomUUID();
    const phone = el('mh-phone-input').value.trim();
    const batches = buildBatches(phone);
    await submitBatchesWithProgress(
      batches,
      (percent) => {
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `Subiendo... ${percent}%`;
      },
      nextBatchIndex,
    );
    nextBatchIndex = 0;
    submissionId = null;
    showScreen('sent');
  } catch (err) {
    console.error(err);
    // Si ya se mandaron clips antes de que este fallara, un reintento
    // arranca desde el que falló — no desde cero — para no duplicar
    // trabajo ya hecho del lado del servidor.
    if (typeof err.failedAtIndex === 'number') nextBatchIndex = err.failedAtIndex;
    errorDetail.textContent = `Detalle técnico: ${err.name || 'Error'} — ${err.message || 'sin mensaje'}`;
    errorDetail.classList.remove('mh-hidden');
    showScreen('error');
    sendBtn.disabled = false;
    retryBtn.disabled = false;
  } finally {
    progressWrap.classList.add('mh-hidden');
    progressText.classList.add('mh-hidden');
    progressPatience.classList.add('mh-hidden');
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

// Respaldo por si el envío falla: el clip elegido solo existe en memoria
// del navegador (nunca se guarda aparte), así que si el envío no anda, la
// persona necesita una forma de sacarlos del celular para mandarlos a mano.
// Esto es independiente de si el video quedó guardado en la Galería por la
// Cámara nativa (normalmente sí queda, al ser la app de Cámara del sistema
// la que grabó) — este camino funciona igual, no depende de eso.
function downloadClipsSeparately() {
  // El atributo download NO es confiable para video en Safari/iOS (WebKit
  // suele ignorarlo y no pasa nada, o abre el video sin bajarlo) — es una
  // limitación del navegador, no hay forma de forzar una descarga real de
  // ahí. target="_blank" abre cada clip en su propia pestaña con el
  // reproductor nativo — desde ahí, mantener el dedo apretado sobre el
  // video (no tocar un ícono: es un long-press) abre el menú nativo de
  // iOS con la opción "Guardar video", que sí lo manda a Fotos. Es el
  // único camino que funciona de verdad en iOS. Todas sincrónicas, sin
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
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('quicktime') ? 'mov' : 'webm';
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
      showSaveDeviceStatus('Se abrió el cartel para guardar tus 3 videos, y además se abrió cada uno en una pestaña nueva por las dudas — en cada una, mantené el dedo apretado sobre el video y elegí "Guardar video" para mandarlo a Fotos.');
      return;
    } catch (err) {
      // El usuario canceló el cartel de compartir, o el navegador lo
      // rechazó a último momento: no es un error real, no hace falta avisar.
      if (err.name === 'AbortError') return;
      console.error('microhistorias: navigator.share failed, falling back', err);
    }
  }
  downloadClipsSeparately();
  showSaveDeviceStatus('Se abrió cada video en una pestaña nueva — mantené el dedo apretado sobre el video en cada una y elegí "Guardar video" para mandarlo a Fotos.');
}

// Event wiring
el('mh-start-btn').addEventListener('click', goToFirstStep);
// El diagnóstico mostró que el toque caía sobre el fondo del popup
// (DIV#mh-tips-overlay), no sobre el botón — por eso el listener puesto
// solo en el botón nunca se disparaba. Escuchando en el overlay entero
// alcanza (el click en el botón también burbujea hasta acá), y de paso
// cualquier toque en el fondo del popup también lo cierra.
el('mh-tips-overlay').addEventListener('click', () => {
  el('mh-tips-overlay').classList.remove('is-visible');
  resetScrollDeferred();
});
el('mh-record-btn').addEventListener('click', openFilePicker);
el('mh-camera-capture-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  // Reset inmediato: si no, elegir el MISMO archivo una segunda vez no
  // dispara 'change' de nuevo, porque el browser considera que el value
  // no cambió.
  e.target.value = '';
  if (!file) return; // canceló el selector sin elegir nada
  handleCapturedFile(file);
});
el('mh-repeat-btn').addEventListener('click', repeatClip);
el('mh-continue-btn').addEventListener('click', useClipAndContinue);
el('mh-send-btn').addEventListener('click', sendRecording);
el('mh-retry-upload-btn').addEventListener('click', sendRecording);
el('mh-save-device-btn').addEventListener('click', saveClipsToDevice);
