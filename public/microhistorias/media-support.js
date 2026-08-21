export const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function pickSupportedMimeType(candidates, isTypeSupportedFn) {
  for (const type of candidates) {
    if (isTypeSupportedFn(type)) return type;
  }
  return null;
}

