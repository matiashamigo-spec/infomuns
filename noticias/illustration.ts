// Convierte una imagen de noticia en ilustración estilo libro infantil
// usando Gemini 2.5 Flash Image con la paleta de colores de muns.club

import axios from "axios";

export type NewsTone = "positive" | "concerning" | "negative";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

// Descripción del personaje según el tono
function characterSnippet(tone: NewsTone): string {
  if (tone === "negative") {
    return `In a small corner of the scene (bottom-right, about 1/6 of image height), include a creature called "Opaq": a round, semi-transparent dark grey body shaped like a soft half-moon, with droopy empathetic eyes and a gently sad expression. Opaq looks caring and melancholy. Soft watercolor style, no outlines.`;
  }
  if (tone === "concerning") {
    return `In a small corner of the scene (bottom-right, about 1/6 of image height), include a "Lunar Mun": a round creature with a soft half-moon body in lavender and violet tones, gentle purple glowing spots on their body, and slightly worried but still kind eyes. Soft watercolor style, no outlines.`;
  }
  // positive / neutral
  return `In a small corner of the scene (bottom-right, about 1/6 of image height), include a "Mun": a round, cream-white creature shaped like a soft half-moon, with two small shiny eyes, a gentle smile, and tiny rounded arms. The Mun looks happy and curious. Soft watercolor style, no outlines.`;
}

const BASE_RULES = `
Style: soft watercolor and pastel strokes, hand-drawn quality, warm and friendly, suitable for ages 3 to 7.
Color palette (dominant colors): cornflower blue (#4464AD), sky blue (#9FCFE2), powder blue (#C2DCF2), warm cream (#F4F1EA), sandy cream (#EDE6D4), warm brown (#7B6A58), white (#FFFFFF).

Rules:
- Friendly cartoon characters, round faces, approachable and warm
- Bright, gentle mood — safe for very young children
- No text, labels, or captions in the image
- Soft rounded shapes, no harsh edges
- Feels like a page from a picture book
- STRICT SAFETY: NO weapons, NO violence, NO blood, NO explosions, NO threatening objects. Everything peaceful and kind.
- 100% appropriate for a 3-year-old child`;

function buildPhotoPrompt(tone: NewsTone): string {
  return `Transform this news photograph into a children's book illustration.
${BASE_RULES}
- Render everything as a hand-drawn illustration — people become friendly cartoon characters, backgrounds become painted scenes
- Keep the scene recognizable
- No photorealism whatsoever
${characterSnippet(tone)}`;
}

function buildTextPrompt(title: string, story: string, tone: NewsTone): string {
  return `Create a children's book illustration for a story titled "${title}".

Story summary: ${story.substring(0, 300)}
${BASE_RULES}
${characterSnippet(tone)}`;
}

export async function generateIllustrationFromText(
  title: string,
  story: string,
  tone: NewsTone,
  apiKey: string
): Promise<string | null> {
  try {
    const body = {
      contents: [{ parts: [{ text: buildTextPrompt(title, story, tone) }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    };

    const res = await axios.post(
      `${GEMINI_BASE}${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      body,
      { timeout: 60000 }
    );

    const candidates = res.data?.candidates || [];
    for (const c of candidates) {
      for (const p of (c.content?.parts || [])) {
        if (p.inlineData?.data) {
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }
    console.warn("[illustration] Gemini no devolvió imagen desde texto");
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error generando ilustración desde texto:", err.message);
    return null;
  }
}

export async function illustrateImage(
  imageUrl: string,
  tone: NewsTone,
  apiKey: string
): Promise<string | null> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const imageData = Buffer.from(response.data).toString("base64");
    const mimeType = (response.headers["content-type"] || "image/jpeg").split(";")[0];

    const body = {
      contents: [{
        parts: [
          { inlineData: { data: imageData, mimeType } },
          { text: buildPhotoPrompt(tone) },
        ],
      }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    };

    const res = await axios.post(
      `${GEMINI_BASE}${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      body,
      { timeout: 60000 }
    );

    const candidates = res.data?.candidates || [];
    for (const c of candidates) {
      for (const p of (c.content?.parts || [])) {
        if (p.inlineData?.data) {
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }

    console.warn("[illustration] Gemini no devolvió imagen");
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error generando ilustración:", err.message);
    return null;
  }
}
