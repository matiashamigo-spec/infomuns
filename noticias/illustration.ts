// Convierte una imagen de noticia en ilustración estilo libro infantil
// usando Gemini 2.5 Flash Image con la paleta de colores de muns.club
// Incluye el personaje Mun/Opaq correcto según el tono de la noticia

import axios from "axios";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export type NewsTone = "positive" | "concerning" | "negative";

const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carga el personaje como base64 según el tono
function loadCharacter(tone: NewsTone): { data: string; mimeType: string } {
  const file =
    tone === "negative" ? "opaq-mal.png"
    : tone === "concerning" ? "mun-mas-o-menos.png"
    : "mun-bien.png";
  const data = readFileSync(join(__dirname, "assets", file)).toString("base64");
  return { data, mimeType: "image/png" };
}

function characterInstruction(tone: NewsTone): string {
  if (tone === "negative") {
    return `The second image is the "Opaq" character. Include Opaq in the bottom-right corner of the illustration (about 1/5 of image height), matching their exact appearance: grey-blue crescent moon body, purple spots, frowning face with furrowed brows, arms hanging down. Watercolor style.`;
  }
  if (tone === "concerning") {
    return `The second image is a "Mun" character feeling worried. Include this Mun in the bottom-right corner of the illustration (about 1/5 of image height), matching their exact appearance: cream crescent moon body, blue-grey spots, sad droopy eyes, arms hanging. Watercolor style.`;
  }
  return `The second image is a happy "Mun" character. Include this Mun in the bottom-right corner of the illustration (about 1/5 of image height), matching their exact appearance: cream crescent moon body, beige spots, happy squinting eyes, hands on hips. Watercolor style.`;
}

const BASE_RULES = `
Style: soft watercolor and pastel strokes, hand-drawn quality, warm and friendly, suitable for ages 3 to 7.
Color palette (dominant colors): cornflower blue (#4464AD), sky blue (#9FCFE2), powder blue (#C2DCF2), warm cream (#F4F1EA), sandy cream (#EDE6D4), warm brown (#7B6A58), white (#FFFFFF).
- No text, labels, or captions in the image
- Soft rounded shapes, no harsh edges, no photorealism
- Feels like a page from a children's picture book
- STRICT SAFETY: NO weapons, NO violence, NO blood, NO explosions, NO threatening objects. Everything peaceful and kind.
- 100% appropriate for a 3-year-old child`;

export async function generateIllustrationFromText(
  title: string,
  story: string,
  tone: NewsTone,
  apiKey: string
): Promise<string | null> {
  try {
    const character = loadCharacter(tone);
    const prompt = `Create a children's book illustration for a story titled "${title}".
Story summary: ${story.substring(0, 300)}
${BASE_RULES}
${characterInstruction(tone)}`;

    const body = {
      contents: [{
        parts: [
          { inlineData: character },
          { text: prompt },
        ],
      }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    };

    const res = await axios.post(
      `${GEMINI_BASE}${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      body,
      { timeout: 60000 }
    );

    return extractImage(res.data);
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
    const photoResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const photoData = Buffer.from(photoResponse.data).toString("base64");
    const photoMime = (photoResponse.headers["content-type"] || "image/jpeg").split(";")[0];

    const prompt = `Transform this news photograph into a children's book illustration.
${BASE_RULES}
- Render everything as hand-drawn illustration — people become friendly cartoon characters, backgrounds become painted scenes
- Keep the scene recognizable, no photorealism
${characterInstruction(tone)}`;

    const body = {
      contents: [{
        parts: [
          { inlineData: { data: photoData, mimeType: photoMime } },
          { text: prompt },
        ],
      }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    };

    const res = await axios.post(
      `${GEMINI_BASE}${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      body,
      { timeout: 60000 }
    );

    return extractImage(res.data);
  } catch (err: any) {
    console.warn("[illustration] Error generando ilustración:", err.message);
    return null;
  }
}

function extractImage(data: any): string | null {
  const candidates = data?.candidates || [];
  for (const c of candidates) {
    for (const p of (c.content?.parts || [])) {
      if (p.inlineData?.data) {
        return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
      }
    }
  }
  console.warn("[illustration] Gemini no devolvió imagen");
  return null;
}
