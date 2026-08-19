import { describe, it, expect, vi } from 'vitest';
import { isPortrait, watchOrientation } from '../../public/microhistorias/orientation.js';

describe('isPortrait', () => {
  it('returns true when the media query matches', () => {
    expect(isPortrait({ matches: true })).toBe(true);
  });

  it('returns false when the media query does not match', () => {
    expect(isPortrait({ matches: false })).toBe(false);
  });

  it('returns false when given null', () => {
    expect(isPortrait(null)).toBe(false);
  });
});

describe('watchOrientation', () => {
  function createMockMql(initialMatches) {
    const listeners = [];
    return {
      matches: initialMatches,
      addEventListener: (_event, cb) => listeners.push(cb),
      removeEventListener: (_event, cb) => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      _fireChange(newMatches) {
        this.matches = newMatches;
        listeners.forEach((cb) => cb());
      },
      _listenerCount() {
        return listeners.length;
      },
    };
  }

  it('calls onChange immediately with the current orientation', () => {
    const mql = createMockMql(true);
    window.matchMedia = vi.fn(() => mql);
    const onChange = vi.fn();
    watchOrientation(onChange);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange again when orientation changes', () => {
    const mql = createMockMql(true);
    window.matchMedia = vi.fn(() => mql);
    const onChange = vi.fn();
    watchOrientation(onChange);
    mql._fireChange(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('stops calling onChange after the returned unwatch function is called', () => {
    const mql = createMockMql(true);
    window.matchMedia = vi.fn(() => mql);
    const onChange = vi.fn();
    const unwatch = watchOrientation(onChange);
    unwatch();
    expect(mql._listenerCount()).toBe(0);
    mql._fireChange(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
