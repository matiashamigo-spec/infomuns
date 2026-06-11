import axios from "axios";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Draw this as a very basic crayon sketch made by a 4-year-old child on plain white paper. The image must be horizontal, 16:9 widescreen format.

ABSOLUTE RULE — NO TEXT WHATSOEVER: Do not include any letters, words, numbers, symbols, signs, labels, captions, or writing of any kind anywhere in the image. Not on objects, not in the background, not floating. Zero text. A 4-year-old cannot write.

STYLE — strict:
- Plain WHITE background — pure white, nothing else, no gradients, no texture
- OUTLINES ONLY: shapes are drawn with a single wobbly crayon line — no fill, no shading, no solid blocks of color
- If there is any color fill, it must be very sparse: a few loose scribble strokes inside the shape, leaving most of the interior white
- Lines are shaky, uneven, clearly hand-drawn by a small child
- People/humans: circle head, rectangle body, stick arms and legs — nothing more
- Faces on humans: two dots for eyes, one simple line for mouth — the mouth shape reflects the emotion of the scene: curved up for happy, curved down for sad, straight for worried or uncertain. Tender, never exaggerated or scary.
- Muns (if present): they are small, perfectly ROUND creatures — like a ball with tiny stick arms and legs. Cute and tender. Their body is one big circle, no separate head. Two dot eyes and a tiny curved smile. White with small grey dots (lunares) scattered on their round body. They look soft, chubby, adorable — like a friendly snowball. NOT humanoid, NOT tall, NOT scary.
- Opaq (if present): same round shape as Muns but violet/purple colored with darker purple dots. Same cute, chubby, round appearance.
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

async function generateSingleScene(scenePrompt: string, apiKey: string, refImageBase64?: string, refImageMime?: string): Promise<string | null> {
  try {
    const parts: any[] = [];
    if (refImageBase64 && refImageMime) {
      parts.push({ inlineData: { data: refImageBase64, mimeType: refImageMime } });
      parts.push({ text: `This is the reference style for the Muns characters. Use this EXACT same drawing style, proportions and cuteness for any Muns or Opaq that appear in the scene.\n\n${scenePrompt}` });
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

const MUN_REF_URL = "https://muns.club/wp-content/uploads/2026/06/mun-crayon.png";
const OPAQ_REF_URL = "https://muns.club/wp-content/uploads/2026/06/Opaq-crayon.png";

async function fetchRefImage(url: string): Promise<{ data: string; mime: string } | null> {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } });
    return {
      data: Buffer.from(res.data).toString("base64"),
      mime: (res.headers["content-type"] || "image/png").split(";")[0],
    };
  } catch {
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

Return exactly 4 scene descriptions. Each must have a DIFFERENT composition and framing — no two scenes can look similar.

Rules:
Use these 4 composition types, assigned in whatever order best fits the story's narrative flow:
  A) WIDE SHOT — the main location from far away, no characters, just the environment
  B) CHARACTER PRESENCE — Muns (small round white creatures with grey spots) OR Opaq (round violet creature with dark violet spots) present in the scene. They don't have to be the center — they can be off to the side, small in the frame, watching. They accompany the scene, they don't dominate it. Pick whichever character appears in this story.
  C) OBJECT CLOSE-UP — the most important object of the story, alone, filling the frame, no characters
  D) FINAL IMAGE — the last moment of the story, whatever framing fits best

Rules:
- Assign A, B, C, D to scenes 1–4 in the order that feels most natural for THIS story's flow. Vary the order between stories.
- Exactly one scene includes Muns or Opaq (type B). The other three have no characters.
- Each scene must look visually different from the others: different distance, different subject, different framing.
- Be specific to THIS story — use concrete details from the text, not generic descriptions.
- Start each scene description with its type label: "A)", "B)", "C)" or "D)".
- Write ONE sentence per scene after the label.`,
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

  // Detectar qué escena tiene personajes (label B) para pasarle la referencia
  const characterSceneIdx = descriptions.findIndex(d => d.trimStart().startsWith("B)"));

  // Fetchear imagen de referencia UNA SOLA VEZ (solo si hay escena con personajes)
  let refImage: { data: string; mime: string } | null = null;
  if (characterSceneIdx !== -1) {
    const hasOpaq = story.toLowerCase().includes("opaq");
    refImage = await fetchRefImage(hasOpaq ? OPAQ_REF_URL : MUN_REF_URL);
    if (refImage) console.log(`[illustration] Referencia cargada para escena ${characterSceneIdx + 1}`);
  }

  const prompts = descriptions.map((scene, i) => `Draw scene ${i + 1} of 4 from this children's story as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}

SCENE TO DRAW:
${scene}

This is ONE of 4 illustrations — it must look visually DIFFERENT from the others in framing, subject and distance. Follow the composition type indicated in the scene label (A/B/C/D). Draw ONLY what this scene describes.

${PROMPT}`);

  const results = await Promise.all(
    prompts.map((p, i) => {
      if (i === characterSceneIdx && refImage) {
        return generateSingleScene(p, apiKey, refImage.data, refImage.mime);
      }
      return generateSingleScene(p, apiKey);
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
