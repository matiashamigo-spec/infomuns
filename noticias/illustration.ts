import axios from "axios";
import { GoogleGenAI } from "@google/genai";

const MUN_REF_URL = "https://muns.club/wp-content/uploads/2026/06/mun-crayon.png";
const MUN_VIOLETA_REF_URL = "https://muns.club/wp-content/uploads/2026/06/mun-violeta-crayon.png";
const OPAQ_REF_URL = "https://muns.club/wp-content/uploads/2026/06/Opaq-crayon.png";

// Cache de imágenes de referencia en base64
const refCache: Record<string, string> = {};

async function fetchRefBase64(url: string): Promise<string | null> {
  if (refCache[url]) return refCache[url];
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
    const b64 = Buffer.from(res.data).toString("base64");
    refCache[url] = b64;
    return b64;
  } catch {
    return null;
  }
}

// Detecta qué personajes aparecen en el cuento y devuelve la URL de referencia correcta
function detectCharacterRef(story: string): { url: string; label: string } | null {
  const s = story.toLowerCase();
  const hasMuns = /\blos muns\b|\bun mun\b|\bel mun\b|\blos muns\b/.test(s);
  const hasOpaq = /\bopaq\b/.test(s);
  const hasVioleta = /violeta/.test(s);

  if (hasOpaq && !hasMuns) return { url: OPAQ_REF_URL, label: "Opaq" };
  if (hasMuns && hasVioleta) return { url: MUN_VIOLETA_REF_URL, label: "a Mun with violet spots" };
  if (hasMuns) return { url: MUN_REF_URL, label: "a Mun" };
  return null;
}

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Draw this as a very basic crayon sketch made by a 4-year-old child on plain white paper. The image must be horizontal, 16:9 widescreen format.

STYLE — strict:
- Plain WHITE background — pure white, nothing else, no gradients, no texture
- OUTLINES ONLY: shapes are drawn with a single wobbly crayon line — no fill, no shading, no solid blocks of color
- If there is any color fill, it must be very sparse: a few loose scribble strokes inside the shape, leaving most of the interior white
- Lines are shaky, uneven, clearly hand-drawn by a small child
- People: circle head, rectangle body, stick arms and legs — nothing more
- Faces: two dots for eyes, one curved line for mouth — that's all
- Objects: simplest possible outline shape — a house is a square and a triangle, a tree is a circle on a stick
- Exactly 3 colors: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0)
- Each color used sparingly — mostly outlines, almost no fill
- The drawing looks unfinished and sparse, like a child who drew quickly and got bored halfway through

CONTENT RULES:
- Anonymous figures only, no recognizable characters or IP
- Maximum 2–3 elements total in the scene — do not crowd the drawing
- No text, labels or captions
- No violence, weapons, blood or dark content`;

export async function illustrateImage(imageUrl: string, apiKey: string): Promise<string | null> {
  console.log(`[illustration] Procesando: ${imageUrl}`);
  try {
    const photo = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const photoData = Buffer.from(photo.data).toString("base64");
    const photoMime = (photo.headers["content-type"] || "image/jpeg").split(";")[0];

    const res = await axios.post(
      `${API_BASE}${MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [
            { inlineData: { data: photoData, mimeType: photoMime } },
            { text: PROMPT },
          ],
        }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
      { timeout: 60000 }
    );

    for (const c of res.data?.candidates || []) {
      for (const p of c.content?.parts || []) {
        if (p.inlineData?.data) {
          console.log(`[illustration] OK`);
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }
    console.warn("[illustration] Sin imagen:", JSON.stringify(res.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text)));
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error:", err.message);
    return null;
  }
}

async function generateSingleScene(scenePrompt: string, apiKey: string, refImageBase64?: string): Promise<string | null> {
  try {
    const parts: any[] = [];
    if (refImageBase64) {
      parts.push({ inlineData: { data: refImageBase64, mimeType: "image/png" } });
      parts.push({ text: "Use the character in the reference image above as the exact visual model. Keep its design identical — same shape, same colors, same spots. Only change its pose or action as described below. Do not add or remove any features.\n\n" + scenePrompt });
    } else {
      parts.push({ text: scenePrompt });
    }
    const res = await axios.post(
      `${API_BASE}${MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
      { timeout: 60000 }
    );
    for (const c of res.data?.candidates || []) {
      for (const p of c.content?.parts || []) {
        if (p.inlineData?.data) {
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error en escena:", err.message);
    return null;
  }
}

export async function generateIllustrationFromText(title: string, story: string, apiKey: string): Promise<string | null> {
  console.log(`[illustration] Generando desde cuento: "${title}"`);
  const scenePrompt = `Draw this children's story scene as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}

STORY SUMMARY (use this to decide WHAT to draw):
${story.substring(0, 600)}

Based on the story above, identify the most visual and emotionally meaningful scene — a character, a place, an object or a moment — and draw it in the childlike crayon style described below. The drawing must illustrate the STORY, not a news photo.

${PROMPT}`;

  const result = await generateSingleScene(scenePrompt, apiKey);
  if (result) console.log(`[illustration] OK (desde cuento)`);
  else console.warn(`[illustration] Sin imagen desde cuento: "${title}"`);
  return result;
}

async function extractSceneDescriptions(title: string, story: string, apiKey: string): Promise<string[]> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Read this children's story and identify 4 visually distinct moments to illustrate as crayon drawings.

STORY TITLE: ${title}
STORY: ${story.substring(0, 800)}

Return exactly 4 scene descriptions. Each must be visually and compositionally DIFFERENT from the others:
- Scene 1: a wide establishing shot of the main location (no characters, just the place)
- Scene 2: the key character(s) doing the most important action in the story
- Scene 3: the single most important object in the story, alone, centered
- Scene 4: the final moment — what's left when the story ends

For each scene write ONE specific sentence: what is drawn, who or what is there, what are they doing. Be specific to THIS story — not generic descriptions.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object" as any,
          properties: {
            scenes: { type: "array" as any, items: { type: "string" as any } }
          },
          required: ["scenes"]
        }
      }
    });
    const text = response.text;
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.scenes) ? parsed.scenes.slice(0, 4) : [];
  } catch (err: any) {
    console.warn("[illustration] Error extrayendo escenas:", err.message);
    return [];
  }
}

export async function generateIllustrationSet(title: string, story: string, apiKey: string): Promise<string[]> {
  console.log(`[illustration] Extrayendo 4 escenas específicas para: "${title}"`);

  const scenes = await extractSceneDescriptions(title, story, apiKey);
  if (scenes.length === 0) {
    console.warn("[illustration] No se pudieron extraer escenas, usando descripciones genéricas");
  }

  const fallback = [
    "Wide shot of the main location where the story happens — no characters, just the place.",
    "The main character(s) doing the most important action in the story.",
    "The single most important object from the story, alone and centered.",
    "The final moment of the story — what remains when it ends.",
  ];

  const descriptions = scenes.length >= 4 ? scenes : fallback;

  // Detectar personaje y precargar referencia
  const charRef = detectCharacterRef(story);
  let refBase64: string | null = null;
  if (charRef) {
    refBase64 = await fetchRefBase64(charRef.url);
    console.log(`[illustration] Referencia de personaje: ${charRef.label}`);
  }

  const prompts = descriptions.map((scene, i) => `Draw scene ${i + 1} of 4 from this children's story as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}

SCENE TO DRAW — be very specific to this description, do not mix with other scenes:
${scene}

This scene must look DIFFERENT from any other illustration of this story. Focus only on what this scene describes.

${PROMPT}`);

  const results = await Promise.all(
    prompts.map((p, i) => {
      // Escenas 1 y 3 son lugar/objeto — sin personaje. Escenas 2 y 4 llevan referencia si hay personaje
      const useRef = refBase64 && (i === 1 || i === 3);
      return generateSingleScene(p, apiKey, useRef ? refBase64! : undefined);
    })
  );
  const valid = results.filter((r): r is string => r !== null);
  console.log(`[illustration] ${valid.length}/4 escenas generadas para "${title}"`);
  return valid;
}

export async function generateSingleIllustration(title: string, story: string, apiKey: string, exclude: number[] = []): Promise<string | null> {
  console.log(`[illustration] Generando 1 escena nueva para: "${title}"`);
  const scenes = await extractSceneDescriptions(title, story, apiKey);
  if (scenes.length === 0) return null;

  const available = scenes.map((_, i) => i).filter(i => !exclude.includes(i));
  const idx = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : Math.floor(Math.random() * scenes.length);

  const charRef = detectCharacterRef(story);
  let refBase64: string | null = null;
  if (charRef) refBase64 = await fetchRefBase64(charRef.url);

  const prompt = `Draw this specific scene from a children's story as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}
SCENE TO DRAW: ${scenes[idx]}

${PROMPT}`;

  return generateSingleScene(prompt, apiKey, refBase64 || undefined);
}
