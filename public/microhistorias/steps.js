export const INTERVIEW_STEPS = [
  {
    id: 'frase-inicio',
    title: 'Frase de inicio',
    prompt: 'Soy (tu nombre o apodo) y hoy te voy a contar el día que (me sentí... ó un título gancho)',
    suggestedMaxSeconds: 15,
  },
  {
    id: 'historia',
    title: 'Contá tu historia',
    prompt: 'Antes de grabar, organizá en tu cabeza lo que querés contar.',
    suggestedMaxSeconds: 240,
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
