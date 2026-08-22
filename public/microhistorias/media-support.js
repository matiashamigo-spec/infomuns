// mp4 primero: Telegram trata un video mp4 como video reproducible inline,
// pero un webm a veces le llega como documento genérico (confirmado en
// prueba real desde Android). La mayoría de Android/Chrome igual no soporta
// grabar en mp4 y cae en webm — este orden no rompe nada ahí, solo mejora
// en los celulares donde mp4 sí está disponible.
export const VIDEO_MIME_CANDIDATES = [
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickSupportedMimeType(candidates, isTypeSupportedFn) {
  for (const type of candidates) {
    if (isTypeSupportedFn(type)) return type;
  }
  return null;
}

