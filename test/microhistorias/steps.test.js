import { describe, it, expect } from 'vitest';
import { INTERVIEW_STEPS, getStepByIndex, isLastStep } from '../../public/microhistorias/steps.js';

describe('INTERVIEW_STEPS', () => {
  it('has exactly the 3 steps from the PDF, in order', () => {
    expect(INTERVIEW_STEPS.map((s) => s.id)).toEqual(['frase-inicio', 'historia', 'reflexion']);
  });
});

describe('getStepByIndex', () => {
  it('returns the step at a valid index', () => {
    expect(getStepByIndex(0).id).toBe('frase-inicio');
    expect(getStepByIndex(2).id).toBe('reflexion');
  });

  it('returns null for an out-of-range index', () => {
    expect(getStepByIndex(3)).toBeNull();
    expect(getStepByIndex(-1)).toBeNull();
  });
});

describe('isLastStep', () => {
  it('is true only on the last index', () => {
    expect(isLastStep(0)).toBe(false);
    expect(isLastStep(1)).toBe(false);
    expect(isLastStep(2)).toBe(true);
  });
});
