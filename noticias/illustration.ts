import axios from "axios";
import { GoogleGenAI } from "@google/genai";

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

async function generateSingleScene(scenePrompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await axios.post(
      `${API_BASE}${MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: scenePrompt }] }],
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
      contents: `Read this children's story and identify 4 visually distinct moments to illustrate as crayon drawings. Each scene MUST have a different composition and framing — no two scenes can look similar.

STORY TITLE: ${title}
STORY: ${story.substring(0, 800)}

Return exactly 4 scene descriptions following these strict rules:

- Scene 1 — WIDE ESTABLISHING SHOT: the main location of the story, seen from far away. NO characters. Just the place, the environment, the atmosphere. Describe exactly what's in this specific location (buildings, objects, landscape).
- Scene 2 — CHARACTER CLOSE-UP: one or more Muns (small round white creatures with grey spots) OR Opaq (round violet creature with dark violet spots) reacting to what's happening in the story. Show their expression or body language. This MUST include Muns or Opaq as the main subject.
- Scene 3 — SINGLE OBJECT, EXTREME CLOSE-UP: the single most important object from this specific story, alone, centered, filling most of the frame. No characters, no background — just the object.
- Scene 4 — FINAL MOMENT, MEDIUM SHOT: the last image of the story — what's happening or what remains. Can include characters or just the scene. Must feel like an ending.

CRITICAL: Each scene must be compositionally DIFFERENT (different framing, different subject, different distance). Be very specific to THIS story — use concrete details from the story, not generic descriptions. Write ONE sentence per scene.`,
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
    "Wide establishing shot of the main location — no characters, just the environment and objects in the scene.",
    "A Mun (small round white creature with grey spots) standing and looking at what happened, seen up close, their expression showing curiosity or sadness.",
    "The single most important object from this story, alone, centered, filling most of the frame — no characters, no background.",
    "The final moment of the story — the place or characters as the story ends, medium shot.",
  ];

  const descriptions = scenes.length >= 4 ? scenes : fallback;

  const compositions = [
    "COMPOSITION: wide shot, landscape framing, no characters — only the place and its objects.",
    "COMPOSITION: close-up or medium shot centered on the character(s) — Muns or Opaq must be the main subject, large in the frame.",
    "COMPOSITION: extreme close-up of a single object, centered, filling most of the image — no characters, minimal or no background.",
    "COMPOSITION: medium shot showing the final state of the scene — can include characters or just the environment.",
  ];

  const prompts = descriptions.map((scene, i) => `Draw scene ${i + 1} of 4 from this children's story as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}

SCENE TO DRAW:
${scene}

${compositions[i]}

This is ONE of 4 illustrations — it must look visually DIFFERENT from the others in framing, subject and distance. Draw ONLY what this scene describes.

${PROMPT}`);

  const results = await Promise.all(prompts.map(p => generateSingleScene(p, apiKey)));
  const valid = results.filter((r): r is string => r !== null);
  console.log(`[illustration] ${valid.length}/4 escenas generadas para "${title}"`);
  return valid;
}

export async function generateSingleIllustration(title: string, story: string, apiKey: string, exclude: number[] = []): Promise<string | null> {
  console.log(`[illustration] Generando 1 escena nueva para: "${title}"`);
  const scenes = await extractSceneDescriptions(title, story, apiKey);
  if (scenes.length === 0) return null;

  // Elegir una escena que no esté en los índices excluidos
  const available = scenes.map((_, i) => i).filter(i => !exclude.includes(i));
  const idx = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : Math.floor(Math.random() * scenes.length);

  const prompt = `Draw this specific scene from a children's story as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}
SCENE TO DRAW: ${scenes[idx]}

${PROMPT}`;

  return generateSingleScene(prompt, apiKey);
}
