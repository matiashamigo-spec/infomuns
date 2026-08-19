# Micro Historias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `microhistorias.muns.club` static page inside `infomuns-temp` that guides someone through recording a 3-step "micro historia" interview plus optional support photos/videos, and uploads everything directly to an n8n webhook.

**Architecture:** A dependency-free, no-build static page (`public/microhistorias/`) served by the existing Express app via `express.static`. Business logic that doesn't touch the DOM (step data, WhatsApp link building, MIME/capability picking, orientation detection, upload payload building) lives in small ES modules with Vitest unit tests. A single orchestrator module (`app.js`) wires that logic to the DOM, `MediaRecorder`, and `getUserMedia` — this part is verified manually per the design spec, since it depends on real camera/mic hardware.

**Tech Stack:** Plain HTML/CSS/JS (ES modules, no bundler, no React), Vitest + jsdom for unit tests, Express `express.static` for serving, native `MediaRecorder`/`getUserMedia`/`Screen Orientation` browser APIs.

## Global Constraints

- No build step for this feature — files in `public/microhistorias/` are served as-is; no Vite/React involved.
- Design spec: `docs/superpowers/specs/2026-08-19-microhistorias-design.md` — every requirement in this plan traces back to it.
- Node 20 (per `.nvmrc`) — global `fetch`, `FormData`, `Blob` are available without polyfills.
- Font: Nunito (Google Fonts). Official brand palette: background `#FEF8E7`, primary/heading blue `#4464AD`, secondary blue `#466995`, accent gold `#E2C061`, muted beige `#CBBBA0`, secondary text brown `#7B6A58`. Borders `4px solid #000`, card radius `40px`, button radius `20px` (border/radius values confirmed from the live InfoMuns site's computed styles).
- WhatsApp contact number: `+54 9 291 6419599` (click-to-chat only, no Business API).
- n8n webhook target (to be created manually per the spec's "Setup pendiente"): `https://n8n.wips.digital/webhook/microhistorias` — must match whatever path the Webhook node ends up using.
- Out of scope for this plan (per spec): the 19 fixed-duration B-roll shots, live/post video quality analysis, automatic WhatsApp sending, face-blur/audio-only identity protection, the n8n workflow itself, and DNS/Railway custom-domain setup.

---

## File Structure

```
public/microhistorias/
  index.html          — page skeleton, all screens, references styles.css + app.js
  styles.css           — InfoMuns visual identity (colors, Nunito, cards, buttons, camera frame)
  steps.js              — pure: the 3 interview steps + step-index helpers
  whatsapp.js            — pure: click-to-chat link builder
  media-support.js        — pure: MIME type picking + focus/exposure capability check
  orientation.js            — pure isPortrait() + DOM watchOrientation()
  upload.js                  — pure buildUploadFormData() + submitRecording()
  app.js                      — orchestrator: DOM + MediaRecorder + wiring (manual-tested)

test/microhistorias/
  smoke.test.js
  steps.test.js
  whatsapp.test.js
  media-support.test.js
  orientation.test.js
  upload.test.js

vitest.config.ts       (new)
package.json            (modified: + vitest, jsdom, "test" script)
server.ts                (modified: mount /microhistorias static route)
```

---

## Task 1: Add Vitest test runner to the project

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/microhistorias/smoke.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` command that every later task's tests rely on

- [ ] **Step 1: Add devDependencies and the test script to package.json**

Modify `package.json`:

```json
{
  "name": "infomuns",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build",
    "start": "NODE_ENV=production tsx server.ts",
    "preview": "vite preview",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@google/genai": "^1.38.0",
    "@types/multer": "^2.1.0",
    "@types/node-cron": "^3.0.11",
    "@vitejs/plugin-react": "^5.0.0",
    "axios": "^1.13.6",
    "cheerio": "^1.2.0",
    "express": "^5.2.1",
    "express-rate-limit": "^8.3.2",
    "multer": "^2.1.1",
    "node-cron": "^3.0.3",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "rss-parser": "^3.13.0",
    "tsx": "^4.21.0",
    "vite": "^6.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.14.0",
    "typescript": "~5.8.2",
    "vitest": "^2.1.9",
    "jsdom": "^25.0.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: installs `vitest` and `jsdom` with no errors, `package-lock.json` updates.

- [ ] **Step 3: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
  },
});
```

- [ ] **Step 4: Write a smoke test**

Create `test/microhistorias/smoke.test.js`:

```js
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test suite and confirm it passes**

Run: `npm test`
Expected: `1 passed`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test/microhistorias/smoke.test.js
git commit -m "test: add vitest harness for microhistorias"
```

---

## Task 2: `steps.js` — interview step data

**Files:**
- Create: `public/microhistorias/steps.js`
- Test: `test/microhistorias/steps.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `INTERVIEW_STEPS` (array of `{id, title, prompt, suggestedMaxSeconds}`), `getStepByIndex(index): step|null`, `isLastStep(index): boolean` — used by `app.js` in Task 9.

- [ ] **Step 1: Write the failing test**

Create `test/microhistorias/steps.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- steps`
Expected: FAIL — `Cannot find module '../../public/microhistorias/steps.js'`

- [ ] **Step 3: Write the implementation**

Create `public/microhistorias/steps.js`:

```js
export const INTERVIEW_STEPS = [
  {
    id: 'frase-inicio',
    title: 'Frase de inicio',
    prompt: 'Soy (nombre o apodo) y hoy te voy a contar el día que... (emoción o historia)',
    suggestedMaxSeconds: 10,
  },
  {
    id: 'historia',
    title: 'Contá la historia',
    prompt: 'Contá tu historia con tus propias palabras.',
    suggestedMaxSeconds: null,
  },
  {
    id: 'reflexion',
    title: 'Reflexión final',
    prompt: 'Contanos qué sentiste cuando te pasó.',
    suggestedMaxSeconds: null,
  },
];

export function getStepByIndex(index) {
  if (index < 0 || index >= INTERVIEW_STEPS.length) return null;
  return INTERVIEW_STEPS[index];
}

export function isLastStep(index) {
  return index === INTERVIEW_STEPS.length - 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- steps`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add public/microhistorias/steps.js test/microhistorias/steps.test.js
git commit -m "feat: add interview step data for microhistorias"
```

---

## Task 3: `whatsapp.js` — click-to-chat link builder

**Files:**
- Create: `public/microhistorias/whatsapp.js`
- Test: `test/microhistorias/whatsapp.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `buildWhatsAppLink(phone, message?): string` — used by `app.js` in Task 9.

- [ ] **Step 1: Write the failing test**

Create `test/microhistorias/whatsapp.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildWhatsAppLink } from '../../public/microhistorias/whatsapp.js';

describe('buildWhatsAppLink', () => {
  it('strips spaces and the plus sign from the phone number', () => {
    expect(buildWhatsAppLink('+54 9 291 6419599')).toBe('https://wa.me/5492916419599');
  });

  it('returns a plain link when no message is given', () => {
    expect(buildWhatsAppLink('+5492916419599')).toBe('https://wa.me/5492916419599');
  });

  it('appends a url-encoded text param when a message is given', () => {
    expect(buildWhatsAppLink('+5492916419599', 'Tengo una duda')).toBe(
      'https://wa.me/5492916419599?text=Tengo%20una%20duda'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- whatsapp`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `public/microhistorias/whatsapp.js`:

```js
export function buildWhatsAppLink(phone, message) {
  const digits = phone.replace(/[^0-9]/g, '');
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- whatsapp`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add public/microhistorias/whatsapp.js test/microhistorias/whatsapp.test.js
git commit -m "feat: add WhatsApp click-to-chat link builder for microhistorias"
```

---

## Task 4: `media-support.js` — MIME type + focus/exposure capability picking

**Files:**
- Create: `public/microhistorias/media-support.js`
- Test: `test/microhistorias/media-support.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `VIDEO_MIME_CANDIDATES` (array of strings), `pickSupportedMimeType(candidates, isTypeSupportedFn): string|null`, `getFocusExposureSupport(capabilities): {canLockFocus, canLockExposure}` — used by `app.js` in Task 9.

- [ ] **Step 1: Write the failing test**

Create `test/microhistorias/media-support.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  VIDEO_MIME_CANDIDATES,
  pickSupportedMimeType,
  getFocusExposureSupport,
} from '../../public/microhistorias/media-support.js';

describe('pickSupportedMimeType', () => {
  it('returns the first supported candidate in priority order', () => {
    const isSupported = (type) => type === 'video/webm;codecs=vp9,opus' || type === 'video/webm';
    expect(pickSupportedMimeType(VIDEO_MIME_CANDIDATES, isSupported)).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls back to a later candidate when earlier ones are unsupported', () => {
    const isSupported = (type) => type === 'video/mp4';
    expect(pickSupportedMimeType(VIDEO_MIME_CANDIDATES, isSupported)).toBe('video/mp4');
  });

  it('returns null when nothing is supported', () => {
    expect(pickSupportedMimeType(VIDEO_MIME_CANDIDATES, () => false)).toBeNull();
  });
});

describe('getFocusExposureSupport', () => {
  it('detects manual focus and exposure support (Android/Chrome-like capabilities)', () => {
    const result = getFocusExposureSupport({
      focusMode: ['continuous', 'manual'],
      exposureMode: ['continuous', 'manual'],
    });
    expect(result).toEqual({ canLockFocus: true, canLockExposure: true });
  });

  it('reports no support for an empty capabilities object (iPhone/Safari-like)', () => {
    expect(getFocusExposureSupport({})).toEqual({ canLockFocus: false, canLockExposure: false });
  });

  it('reports no support when given undefined', () => {
    expect(getFocusExposureSupport(undefined)).toEqual({ canLockFocus: false, canLockExposure: false });
  });

  it('reports no support when the mode list does not include manual', () => {
    const result = getFocusExposureSupport({ focusMode: ['continuous'], exposureMode: ['continuous'] });
    expect(result).toEqual({ canLockFocus: false, canLockExposure: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- media-support`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `public/microhistorias/media-support.js`:

```js
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

export function getFocusExposureSupport(capabilities) {
  const c = capabilities || {};
  const focusModes = Array.isArray(c.focusMode) ? c.focusMode : [];
  const exposureModes = Array.isArray(c.exposureMode) ? c.exposureMode : [];
  return {
    canLockFocus: focusModes.includes('manual'),
    canLockExposure: exposureModes.includes('manual'),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- media-support`
Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add public/microhistorias/media-support.js test/microhistorias/media-support.test.js
git commit -m "feat: add MIME type and focus/exposure capability picking for microhistorias"
```

---

## Task 5: `orientation.js` — portrait detection + lock overlay logic

**Files:**
- Create: `public/microhistorias/orientation.js`
- Test: `test/microhistorias/orientation.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `isPortrait(mediaQueryList): boolean`, `watchOrientation(onChange): unwatchFn` — used by `app.js` in Task 9 to toggle the orientation-lock overlay.

- [ ] **Step 1: Write the failing test**

Create `test/microhistorias/orientation.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- orientation`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `public/microhistorias/orientation.js`:

```js
export function isPortrait(mediaQueryList) {
  return !!(mediaQueryList && mediaQueryList.matches);
}

export function watchOrientation(onChange) {
  const mql = window.matchMedia('(orientation: portrait)');
  const handleChange = () => onChange(isPortrait(mql));
  handleChange();
  mql.addEventListener('change', handleChange);
  return function unwatch() {
    mql.removeEventListener('change', handleChange);
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- orientation`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add public/microhistorias/orientation.js test/microhistorias/orientation.test.js
git commit -m "feat: add portrait-orientation detection for microhistorias"
```

---

## Task 6: `upload.js` — upload payload building and submission

**Files:**
- Create: `public/microhistorias/upload.js`
- Test: `test/microhistorias/upload.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `buildUploadFormData(interviewClips, supportFiles): FormData`, `submitRecording(webhookUrl, formData, fetchFn?): Promise<Response>` — used by `app.js` in Task 9.

- [ ] **Step 1: Write the failing test**

Create `test/microhistorias/upload.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildUploadFormData, submitRecording } from '../../public/microhistorias/upload.js';

describe('buildUploadFormData', () => {
  it('appends each interview clip as clip1, clip2, clip3', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const fd = buildUploadFormData(clips, []);
    expect(fd.get('clip1')).toBeInstanceOf(Blob);
    expect(fd.get('clip2')).toBeInstanceOf(Blob);
    expect(fd.get('clip3')).toBeInstanceOf(Blob);
    expect(fd.get('clip4')).toBeNull();
  });

  it('appends each support file under apoyo[]', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const supportFiles = [new Blob(['x']), new Blob(['y'])];
    const fd = buildUploadFormData(clips, supportFiles);
    expect(fd.getAll('apoyo[]')).toHaveLength(2);
  });

  it('works with no support files', () => {
    const clips = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const fd = buildUploadFormData(clips, []);
    expect(fd.getAll('apoyo[]')).toHaveLength(0);
  });
});

describe('submitRecording', () => {
  it('resolves when the response is ok', async () => {
    const fakeFetch = async () => ({ ok: true, status: 200 });
    await expect(
      submitRecording('https://example.com/webhook', new FormData(), fakeFetch)
    ).resolves.toBeDefined();
  });

  it('throws when the response is not ok', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500 });
    await expect(
      submitRecording('https://example.com/webhook', new FormData(), fakeFetch)
    ).rejects.toThrow('Upload failed with status 500');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- upload`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `public/microhistorias/upload.js`:

```js
export function buildUploadFormData(interviewClips, supportFiles) {
  const fd = new FormData();
  interviewClips.forEach((blob, i) => {
    fd.append(`clip${i + 1}`, blob, `clip${i + 1}.webm`);
  });
  (supportFiles || []).forEach((file) => {
    fd.append('apoyo[]', file, file.name || 'apoyo');
  });
  return fd;
}

export async function submitRecording(webhookUrl, formData, fetchFn = fetch) {
  const res = await fetchFn(webhookUrl, { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(`Upload failed with status ${res.status}`);
  }
  return res;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- upload`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add public/microhistorias/upload.js test/microhistorias/upload.test.js
git commit -m "feat: add upload payload building and submission for microhistorias"
```

---

## Task 7: `styles.css` — visual design

**Files:**
- Create: `public/microhistorias/styles.css`

**Interfaces:**
- Consumes: nothing
- Produces: CSS classes referenced by `index.html` in Task 8: `.mh-logo`, `.mh-card`, `.mh-btn`, `.mh-btn--primary`, `.mh-camera-wrap`, `.mh-frame-guide`, `.mh-tip`, `.mh-progress`, `.mh-whatsapp-btn`, `.mh-orientation-lock` / `.is-visible`, `.mh-hidden`.

This file has no independent runtime to verify — it has no effect until `index.html` (Task 8) references it. Its correctness is confirmed visually once Task 9 makes the full page interactive.

- [ ] **Step 1: Write the stylesheet**

Create `public/microhistorias/styles.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap');

:root {
  --mh-bg: #FEF8E7;
  --mh-heading: #4464AD;
  --mh-secondary: #466995;
  --mh-accent: #E2C061;
  --mh-muted: #CBBBA0;
  --mh-text-secondary: #7B6A58;
  --mh-border: #000;
  --mh-radius-card: 40px;
  --mh-radius-btn: 20px;
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--mh-bg);
  font-family: 'Nunito', sans-serif;
  color: #1a1a1a;
  min-height: 100vh;
}

body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 96px;
}

.mh-logo {
  max-width: 160px;
  margin-bottom: 16px;
}

h1, h2, h3 {
  color: var(--mh-heading);
  font-weight: 900;
  text-align: center;
  margin: 0 0 12px;
}

p {
  line-height: 1.5;
}

.mh-card {
  background: #fff;
  border: 4px solid var(--mh-border);
  border-radius: var(--mh-radius-card);
  padding: 24px;
  width: 100%;
  max-width: 420px;
  margin-bottom: 16px;
}

.mh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 4px solid var(--mh-border);
  border-radius: var(--mh-radius-btn);
  background: #fff;
  padding: 12px 28px;
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 18px;
  cursor: pointer;
  min-height: 56px;
  width: 100%;
  max-width: 420px;
  margin-bottom: 12px;
}

.mh-btn--primary {
  background: var(--mh-accent);
}

.mh-btn--primary:hover {
  background: var(--mh-secondary);
  color: #fff;
}

.mh-btn:disabled {
  background: var(--mh-muted);
  opacity: 0.6;
  cursor: not-allowed;
}

.mh-camera-wrap {
  position: relative;
  width: 100%;
  max-width: 420px;
  aspect-ratio: 9 / 16;
  border: 4px solid var(--mh-border);
  border-radius: var(--mh-radius-card);
  overflow: hidden;
  background: #000;
  margin-bottom: 16px;
}

.mh-camera-wrap video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mh-frame-guide {
  position: absolute;
  inset: 12%;
  border: 4px dashed rgba(255, 255, 255, 0.85);
  border-radius: 24px;
  pointer-events: none;
}

.mh-tip {
  font-size: 14px;
  line-height: 1.4;
  margin: 4px 0;
  color: var(--mh-text-secondary);
}

.mh-progress {
  font-weight: 700;
  color: var(--mh-heading);
  margin-bottom: 8px;
}

.mh-whatsapp-btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 4px solid var(--mh-border);
  background: #25D366;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  text-decoration: none;
  z-index: 20;
}

.mh-orientation-lock {
  position: fixed;
  inset: 0;
  background: var(--mh-bg);
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 50;
  text-align: center;
  padding: 24px;
}

.mh-orientation-lock.is-visible {
  display: flex;
}

.mh-hidden {
  display: none !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/microhistorias/styles.css
git commit -m "feat: add InfoMuns-consistent visual design for microhistorias"
```

---

## Task 8: `index.html` — page skeleton

**Files:**
- Create: `public/microhistorias/index.html`

**Interfaces:**
- Consumes: `styles.css` (Task 7)
- Produces: the DOM element IDs that `app.js` (Task 9) attaches behavior to — see the ID list inside the file below. Every ID used in Task 9 MUST match one defined here exactly.

This file has no independent runtime to verify on its own (no `app.js` yet, buttons won't do anything) — it's confirmed visually in Task 9's manual verification once the page is fully wired.

- [ ] **Step 1: Write the page skeleton**

Create `public/microhistorias/index.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Micro Historias — Muns</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <img class="mh-logo" src="https://info.muns.club/wp-content/uploads/2026/01/logo.png" alt="Muns" />

  <!-- Orientation lock overlay -->
  <div id="mh-orientation-lock" class="mh-orientation-lock">
    <h2>Girá tu teléfono</h2>
    <p>Esta app se usa con el teléfono en vertical, como en el instructivo.</p>
  </div>

  <!-- Unsupported browser screen -->
  <section id="mh-unsupported-screen" class="mh-card mh-hidden">
    <h2>Tu navegador no soporta grabación</h2>
    <p>Probá abrir este link desde Chrome (Android) o Safari (iPhone) actualizado.</p>
  </section>

  <!-- Start screen -->
  <section id="mh-start-screen" class="mh-card mh-hidden">
    <h1>Contá tu micro historia</h1>
    <p>Vas a grabar 3 pasos cortos: una frase de inicio, tu historia, y una reflexión final.</p>
    <button id="mh-start-btn" class="mh-btn mh-btn--primary" type="button">Empezar</button>
  </section>

  <!-- Camera permission error -->
  <section id="mh-permission-error" class="mh-card mh-hidden">
    <h2>Necesitamos tu cámara y micrófono</h2>
    <p>Para grabar tu historia hace falta que le des permiso al navegador. Volvé a intentarlo.</p>
    <button id="mh-permission-retry-btn" class="mh-btn mh-btn--primary" type="button">Reintentar</button>
  </section>

  <!-- Recording screen -->
  <section id="mh-record-screen" class="mh-card mh-hidden">
    <p id="mh-step-progress" class="mh-progress"></p>
    <h2 id="mh-step-title"></h2>
    <p id="mh-step-prompt" class="mh-tip"></p>
    <p id="mh-step-timer" class="mh-tip mh-hidden"></p>
    <p class="mh-tip">Buscá un lugar silencioso y evitá tener una luz fuerte detrás tuyo.</p>
    <div class="mh-camera-wrap">
      <video id="mh-camera-video" autoplay playsinline muted></video>
      <div class="mh-frame-guide"></div>
    </div>
    <button id="mh-focus-lock-btn" class="mh-btn mh-hidden" type="button">Bloquear foco</button>
    <button id="mh-exposure-lock-btn" class="mh-btn mh-hidden" type="button">Bloquear exposición</button>
    <button id="mh-record-btn" class="mh-btn mh-btn--primary" type="button">Grabar</button>
    <button id="mh-stop-btn" class="mh-btn mh-hidden" type="button">Cortar</button>
  </section>

  <!-- Clip preview screen -->
  <section id="mh-preview-screen" class="mh-card mh-hidden">
    <h2>¿Cómo quedó?</h2>
    <div class="mh-camera-wrap">
      <video id="mh-preview-video" controls playsinline></video>
    </div>
    <button id="mh-repeat-btn" class="mh-btn" type="button">Repetir</button>
    <button id="mh-continue-btn" class="mh-btn mh-btn--primary" type="button">Usar este y seguir</button>
  </section>

  <!-- Support material screen -->
  <section id="mh-support-screen" class="mh-card mh-hidden">
    <h2>Material de apoyo</h2>
    <p class="mh-tip">Si querés, compartí fotos o videos de lo que estás contando. No es obligatorio.</p>
    <label class="mh-btn mh-btn--primary" for="mh-support-camera-input">Sacar foto/video ahora</label>
    <input id="mh-support-camera-input" type="file" accept="image/*,video/*" capture="environment" class="mh-hidden" />
    <label class="mh-btn" for="mh-support-gallery-input">Elegir del carrete</label>
    <input id="mh-support-gallery-input" type="file" accept="image/*,video/*" multiple class="mh-hidden" />
    <ul id="mh-support-list"></ul>
    <button id="mh-support-continue-btn" class="mh-btn mh-btn--primary" type="button">Seguir</button>
  </section>

  <!-- Final / send screen -->
  <section id="mh-final-screen" class="mh-card mh-hidden">
    <h2>Todo listo</h2>
    <p id="mh-final-summary" class="mh-tip"></p>
    <button id="mh-send-btn" class="mh-btn mh-btn--primary" type="button">Enviar mi historia</button>
  </section>

  <!-- Sent confirmation -->
  <section id="mh-sent-screen" class="mh-card mh-hidden">
    <h2>¡Listo!</h2>
    <p>Tu historia está en camino. ¡Gracias por contarla!</p>
  </section>

  <!-- Upload error screen -->
  <section id="mh-error-screen" class="mh-card mh-hidden">
    <h2>No se pudo enviar</h2>
    <p>Tu historia sigue guardada acá, no se perdió. Probá de nuevo.</p>
    <button id="mh-retry-upload-btn" class="mh-btn mh-btn--primary" type="button">Reintentar envío</button>
    <a id="mh-whatsapp-error" class="mh-btn" href="#" target="_blank" rel="noopener">Escribinos por WhatsApp</a>
  </section>

  <a id="mh-whatsapp-start" class="mh-whatsapp-btn" href="#" target="_blank" rel="noopener" aria-label="Dudas por WhatsApp">💬</a>

  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/microhistorias/index.html
git commit -m "feat: add page skeleton for microhistorias"
```

---

## Task 9: `app.js` — orchestrator (camera, recording, upload flow)

**Files:**
- Create: `public/microhistorias/app.js`

**Interfaces:**
- Consumes: `INTERVIEW_STEPS`, `getStepByIndex`, `isLastStep` (Task 2); `buildWhatsAppLink` (Task 3); `VIDEO_MIME_CANDIDATES`, `pickSupportedMimeType`, `getFocusExposureSupport` (Task 4); `watchOrientation` (Task 5); `buildUploadFormData`, `submitRecording` (Task 6); the exact DOM IDs defined in `index.html` (Task 8).
- Produces: the fully working page. No other task consumes this file's exports (it has none — it's the top-level orchestrator).

This file depends on real camera/microphone hardware and cannot be meaningfully unit tested (consistent with the design spec's own Testing section). Verification is manual, at the end of this task.

- [ ] **Step 1: Write the orchestrator**

Create `public/microhistorias/app.js`:

```js
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
    const previewVideo = el('mh-preview-video');
    previewVideo.src = URL.createObjectURL(pendingClipBlob);
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
```

- [ ] **Step 2: Manual verification — run the dev server**

Run: `npm run dev`
Expected: `Server running on port 3000` (or `$PORT` if set) with no startup errors.

- [ ] **Step 3: Manual verification — open the page**

Open `http://localhost:3000/microhistorias/` in a desktop Chrome browser.

Expected:
- Page loads with the cream background, Muns logo, and "Contá tu micro historia" start screen.
- No errors in the browser console.
- Clicking "Empezar" prompts for camera/microphone permission; after granting, the recording screen appears with the live camera preview and "Paso 1 de 3".
- Clicking "Grabar" then "Cortar" shows the preview screen with a playable clip and "Repetir"/"Usar este y seguir" buttons.
- Repeating this for all 3 steps reaches the "Material de apoyo" screen, then "Seguir" reaches "Todo listo".
- Clicking "Enviar mi historia" shows the error screen (expected at this stage, since the real n8n webhook doesn't exist yet) with a working "Reintentar envío" button and a WhatsApp link that opens `wa.me/5492916419599` with a prefilled message.

- [ ] **Step 4: Commit**

```bash
git add public/microhistorias/app.js
git commit -m "feat: wire microhistorias recording flow (camera, steps, upload)"
```

---

## Task 10: Serve `/microhistorias` from the Express app

**Files:**
- Modify: `server.ts`

**Interfaces:**
- Consumes: `public/microhistorias/` (Tasks 7–9)
- Produces: `http://<host>/microhistorias/*` serving the static page in both dev and production.

- [ ] **Step 1: Add the static route**

Modify `server.ts` — add this block right after the noticias router (after line `app.use("/api/noticias", createNoticiasRouter());`) and before the `/cargarnoticias` admin routes:

```ts
  // ── Noticias Muns ─────────────────────────────────────────────────────────
  app.use("/api/noticias", createNoticiasRouter());

  // ── Micro Historias ──────────────────────────────────────────────────────
  app.use("/microhistorias", express.static(path.join(process.cwd(), "public", "microhistorias")));

  // Panel admin — protegido con HTTP Basic Auth, servido ANTES del catch-all del frontend
```

This must be placed before the Vite dev-middleware / `dist` catch-all block further down (`app.use(vite.middlewares)` / `app.use(express.static("dist"))`), so it isn't shadowed by the React SPA fallback. Since it's inserted right after the noticias router, which is already above that block, this ordering is correct.

- [ ] **Step 2: Run the dev server**

Run: `npm run dev`
Expected: starts without errors.

- [ ] **Step 3: Verify the route serves the page**

Run: `curl -s http://localhost:3000/microhistorias/ | head -5`
Expected: output starts with `<!DOCTYPE html>` and includes `<title>Micro Historias — Muns</title>` further down.

- [ ] **Step 4: Verify static assets are served with the right content type**

Run: `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/microhistorias/app.js`
Expected: `200` status and a JavaScript content type (e.g. `text/javascript; charset=UTF-8`).

Run: `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/microhistorias/styles.css`
Expected: `200` status and `text/css; charset=UTF-8`.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat: serve microhistorias static page from Express"
```

---

## After this plan

Code-complete at this point covers everything in scope. Remaining work is configuration, already documented in the design spec's "Setup pendiente" section, not code:

- Create the Telegram bot (@BotFather) and choose the destination channel/chat.
- Add `microhistorias.muns.club` as a custom domain in Railway and create the matching CNAME in Cloudflare.
- Build the n8n workflow at `n8n.wips.digital` (Webhook → ffmpeg concat → Telegram `sendVideo` + `sendMediaGroup`) with the webhook path matching `N8N_WEBHOOK_URL` in `app.js` — update that constant if the actual path differs once the workflow exists.
  - **CORS is required.** The browser POSTs cross-origin, from `microhistorias.muns.club` to `n8n.wips.digital`, using the direct browser → n8n webhook architecture (no Express proxy). The Webhook node's response must include `Access-Control-Allow-Origin: https://microhistorias.muns.club`, or the browser's `fetch` will reject with a network-level error even though n8n received the files successfully. Verify whether the n8n Webhook node handles the `OPTIONS` preflight automatically for multipart POSTs, or whether it needs to be configured explicitly — don't assume.
- The client-side ~45MB payload size guard (in `app.js`, `MAX_UPLOAD_BYTES`) assumes Telegram Bot API's ~50MB video upload ceiling as the binding constraint. If that assumption changes (e.g. Telegram raises/lowers its limit, or the upload no longer goes straight to Telegram), the threshold in `app.js` needs to change too.
- Once all three are done, redo the manual walkthrough from Task 9 on a real Android (Chrome) and iPhone (Safari) device, per the design spec's Testing section, confirming the video actually lands in Telegram in good quality.
