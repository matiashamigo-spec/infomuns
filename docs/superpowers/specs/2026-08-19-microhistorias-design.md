# Micro Historias — Web app de grabación guiada

## Propósito

Página web en `microhistorias.muns.club` que guía a cualquier persona, paso a paso,
a grabar su "micro historia" (entrevista de 3 partes) siguiendo el instructivo del PDF
"Cómo contar tus Micro Historias" (Muns), y la envía automáticamente a un canal de
Telegram — sin que quien graba necesite tener Telegram instalado.

Hoy el proceso es 100% manual: la persona graba con su teléfono y manda el video por
WhatsApp a un número fijo. Esta app reemplaza esa fricción manteniendo el mismo espíritu
(cualquiera puede contar una historia) pero con guía en pantalla y envío automático.

## Alcance del MVP

**Incluido:**
- Los 3 pasos de la entrevista: frase de inicio, contá la historia, reflexión final.
- Tips en pantalla (texto/overlay) basados en el PDF: encuadre "plano entrevista",
  luz, verticalidad, ambiente silencioso.
- Grabación por pasos (se puede repetir cada paso individualmente).
- Paso de material de apoyo: después de la entrevista, se invita a compartir fotos
  y/o videos de lo que está contando — "Sacar foto/video ahora" (cámara) o "Elegir
  del carrete" (galería), sin cantidad mínima obligatoria, puede saltearse.
- Envío automático a Telegram vía n8n (video de entrevista + fotos/videos de apoyo).
- Botón de contacto por WhatsApp (click-to-chat, mismo número del PDF) para dudas.

**Explícitamente fuera de este MVP** (fase 2 o más adelante):
- Los 19 planos de apoyo con duración/tipo fijo del PDF (general, primer plano, corto,
  medio, creativo, entero) — reemplazados en el MVP por el paso simple de compartir
  fotos/videos libres descripto arriba.
- Análisis de calidad de video (en vivo o post-grabación) — solo tips estáticos por ahora.
- Envío automático por WhatsApp (solo queda el botón manual de contacto).
- Modo de protección de identidad para quien no quiera mostrar la cara. Evaluado y
  pospuesto — dos caminos posibles a futuro:
  - **Blur de cara en tiempo real** (MediaPipe Face Detection, client-side, gratis):
    más "profesional" pero con riesgo real de que un cuadro se escape sin blur si la
    detección falla un instante — inaceptable para algo que promete proteger identidad.
  - **Modo solo-audio** (sin cámara, ilustración fija de Muns en el video final):
    100% confiable porque la cara nunca se graba, más simple de construir. Preferido
    si se retoma esto más adelante.

## Arquitectura

```
[Navegador de quien graba]
   → graba 3 clips de entrevista con MediaRecorder API (getUserMedia)
   → agrega 0+ fotos/videos de apoyo (cámara o carrete)
   → POST directo (multipart/form-data) al webhook de n8n con todo junto

[n8n — https://n8n.wips.digital]
   → Webhook recibe los 3 clips de entrevista + el material de apoyo
   → Execute Command (ffmpeg concat) une los 3 clips de entrevista en 1 video final
   → Telegram node manda el video final al canal/chat configurado
   → Telegram node manda el material de apoyo aparte, como álbum, si hay
   → responde 200 al webhook apenas recibe los archivos (no espera ffmpeg/Telegram)

[DNS — muns.club ya está en Cloudflare]
   → CNAME `microhistorias.muns.club` → dominio custom de Railway

[infomuns-temp — Railway]
   → sirve la página estática (HTML/CSS/JS, sin build de React necesario) en el
     dominio custom `microhistorias.muns.club`
   → no procesa ni almacena los videos — van directo a n8n
```

Costo incremental: $0. Todo corre sobre infraestructura que ya existe (Railway, n8n
self-hosteado, Cloudflare free tier, Telegram Bot API gratis). Railway permite agregar
dominios custom gratis, solo hace falta el registro CNAME en Cloudflare.

## Flujo de grabación (UX)

**Pantalla de inicio:**
- Título + explicación breve ("vas a grabar 3 pasos cortos").
- Ícono de WhatsApp (`wa.me/5492916419599`) para dudas antes de arrancar.
- Botón "Empezar" → pide permiso de cámara/micrófono.
- Si el navegador no soporta `MediaRecorder`/`getUserMedia`: mensaje pidiendo usar Chrome,
  antes de mostrar nada más.

**Detección de orientación:** la app chequea en todo momento si el teléfono está en
vertical (`matchMedia("(orientation: portrait)")` / `screen.orientation`). Si detecta
horizontal, tapa la pantalla con un aviso "Girá tu teléfono" que bloquea el flujo
(no deja grabar en horizontal) hasta que vuelva a vertical — reemplaza al tip pasivo
de "poné tu teléfono vertical" del PDF por una verificación activa.

**Por cada uno de los 3 pasos** (Frase de inicio / Contá la historia / Reflexión final):
- Guía visual superpuesta sobre la cámara (encuadre de referencia "plano entrevista").
- Tips fijos: lugar silencioso, sin luz fuerte detrás.
- Para el paso 1: texto modelo ("Soy [nombre] y hoy te voy a contar...") con un contador
  de tiempo que es **solo referencia visual** (sugerencia de no pasarse de 10s) — nunca
  corta la grabación ni bloquea nada.
- Grabar → Cortar → vista previa del clip → "Repetir" o "Usar este y seguir".
- Barra de progreso (Paso 1 de 3).

**Paso de material de apoyo** (después de los 3 clips de entrevista):
- Invitación a compartir fotos y/o videos de lo que está contando — nada obligatorio.
- Dos botones: "Sacar foto/video ahora" (abre la cámara directo) o "Elegir del
  carrete" (abre el selector de archivos del teléfono, fotos y videos ya existentes).
- Sin cantidad mínima ni máxima estricta — se puede agregar más de uno o ninguno y
  seguir.

**Pantalla final:**
- Resumen de los 3 clips de entrevista + el material de apoyo agregado.
- Botón "Enviar mi historia" → sube todo (clips de entrevista + fotos/videos de
  apoyo) al webhook de n8n.
- Confirmación inmediata ("¡Listo! Tu historia está en camino") sin esperar a que n8n
  termine de procesar (ffmpeg + Telegram pueden tardar unos segundos más).

## Diseño visual

Mobile-first (vertical) — es el formato real de uso: alguien parado, con el teléfono
en vertical, siguiendo los pasos.

Reusar la identidad visual que ya tiene InfoMuns, para que se sienta parte del mismo
sitio y no un formulario genérico pegado con cinta:
- Mismo fondo crema del sitio.
- Mismas tarjetas/paneles con borde negro grueso (4px) y esquinas muy redondeadas
  (border-radius ~40px) — el mismo lenguaje visual de las tarjetas de notas y de los
  botones Aa/AA que ya están en la home.
- Mismo celeste de acento (`#AEE1F5` aprox.) para el estado activo/CTA principal
  ("Grabar", "Usar este y seguir", "Enviar mi historia").
- Tipografía **Nunito** (Google Fonts, gratis) para todos los textos de la app —
  redondeada y amigable, en línea con el logo Muns.
- Logo Muns visible en el header de la página, como en el resto del sitio.

**Encuadre de cámara:** guía visual superpuesta sobre el preview de la cámara con el
mismo estilo de borde negro grueso redondeado (no un rectángulo genérico de sistema),
mostrando dónde debería quedar la cara/torso para el "plano entrevista".

**Botones grandes y táctiles:** todo pensado para dedo gordo en celular, nada de
elementos chicos tipo desktop — consistente con los botones pill que ya usa el sitio
(ej. el "..." celeste de las tarjetas).

**Ícono de WhatsApp:** presente pero discreto (esquina, no interrumpe el flujo) en la
pantalla de inicio; más protagonista (llamado a la acción) en la pantalla de error.

Los valores exactos de color/tipografía se toman del CSS en vivo del sitio al momento
de implementar, no se inventan nuevos.

## Control de foco y exposición (donde el navegador lo permita)

Botones opcionales "Bloquear foco" / "Bloquear exposición" durante el preview de
cámara, para evitar que el celular reenfoque o reajuste la luz en medio de la
grabación (típico problema cuando alguien se mueve un poco frente a cámara).

Implementación: `track.getCapabilities()` para chequear si el dispositivo/navegador
expone `focusMode`/`exposureMode` manual; si existe, se muestra el botón y al tocarlo
se llama `track.applyConstraints({advanced:[{focusMode:'manual'}]})` (ídem exposición)
fijando los valores actuales. Si no existe la capability, el botón directamente **no
se muestra** — no hay fallback roto.

Soporte real conocido: Android/Chrome sí expone estos controles vía la Image Capture
API. iPhone/Safari no los expone en absoluto (limitación de Apple en la plataforma
web, no algo resolvible desde el código) — en iPhone esta sección del UI queda oculta.

## Manejo de errores

- **Permiso denegado:** mensaje explicando por qué hace falta el permiso + botón reintentar.
- **Navegador no soportado:** chequeo temprano, antes de mostrar el flujo de grabación.
- **Formato de video:** cada navegador graba en el formato que soporta (webm en
  Chrome/Android, mp4 en Safari/iOS) vía `MediaRecorder.isTypeSupported`; no se
  normaliza en el navegador — ffmpeg en n8n lo resuelve al concatenar.
- **Falla de red al subir:** los 3 clips de entrevista y el material de apoyo quedan
  en memoria del navegador (no se pierden), se muestra el ícono de WhatsApp + botón
  "Reintentar envío".
- **Falla dentro de n8n** (ffmpeg o Telegram fallan después del 200 OK): el workflow de
  n8n debe tener una notificación aparte (ej. aviso a un chat de Telegram/mail de
  administración) para que una historia no se pierda en silencio.

## n8n — Workflow

1. **Webhook** (POST, `multipart/form-data`): recibe `clip1`, `clip2`, `clip3` (entrevista)
   + `apoyo[]` (0 o más fotos/videos de apoyo) + metadata opcional (nombre, fecha).
2. **Execute Command (ffmpeg):** concatena los 3 clips de entrevista en orden en un único
   archivo final (filtro `concat`, con reencode para tolerar pequeñas diferencias de
   codec/resolución entre clips). El material de apoyo NO se toca con ffmpeg.
3. **Telegram (`sendVideo`):** manda el video final de la entrevista al canal/chat
   configurado.
4. **Telegram (`sendMediaGroup`):** si hay material de apoyo, lo manda aparte como
   álbum (soporta mezcla de fotos y videos) al mismo canal.
5. **Respond to Webhook:** responde 200 apenas recibe los archivos, antes de que termine
   el resto del workflow.
6. **(Recomendado) Notificación de error:** rama de error que avise si ffmpeg o Telegram
   fallan.

## Setup pendiente (no es diseño, son tareas de configuración)

- Crear bot de Telegram con @BotFather y decidir canal/chat destino.
- Agregar `microhistorias.muns.club` como dominio custom en Railway y crear el CNAME
  correspondiente en Cloudflare.
- Armar el workflow descripto arriba en n8n (`n8n.wips.digital`).

## Testing

No hay mucho lugar para tests automatizados dado que depende 100% de cámara/mic reales.
Validación manual:
- Probar en un Android (Chrome) y un iPhone (Safari) — los dispositivos reales del público.
- Grabar los 3 pasos completos, forzar una falla de red a propósito para validar el reintento.
- Confirmar que el video final llega completo y en buena calidad al canal de Telegram.
