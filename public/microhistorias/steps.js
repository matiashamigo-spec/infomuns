export const INTERVIEW_STEPS = [
  {
    id: 'frase-inicio',
    title: 'Frase de inicio',
    prompt: 'Soy (nombre o apodo) y hoy te voy a contar el día que... (emoción o historia)',
    suggestedMaxSeconds: 60,
  },
  {
    id: 'historia',
    title: 'Contá la historia',
    prompt: 'Contá tu historia con tus propias palabras.',
    suggestedMaxSeconds: 300,
  },
  {
    id: 'reflexion',
    title: 'Reflexión final',
    prompt: 'Contanos qué sentiste cuando te pasó.',
    suggestedMaxSeconds: 60,
  },
];

export function getStepByIndex(index) {
  if (index < 0 || index >= INTERVIEW_STEPS.length) return null;
  return INTERVIEW_STEPS[index];
}

export function isLastStep(index) {
  return index === INTERVIEW_STEPS.length - 1;
}
