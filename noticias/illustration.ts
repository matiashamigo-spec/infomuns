// Ilustración de noticias para Muns
// Toma la foto original de la noticia → aplica estilo acuarela → integra Mun si es positiva

import axios from "axios";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export type NewsTone = "positive" | "concerning" | "negative";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMunRef(): { data: string; mimeType: string } {
  const data = readFileSync(join(__dirname, "assets", "mun-bien.png")).toString("base64");
  return { data, mimeType: "image/png" };
}

// Ilustra a partir de la foto original de la noticia
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

    const munInstruction = tone === "positive"
      ? `\nThe last image is the "Mun" character reference. Add ONE Mun naturally integrated into the scene as an active participant — doing something, reacting, or being part of the moment. Reproduce EXACTLY from the reference: cream crescent moon body, beige oval spots, happy squinting eyes. ONE character only, never more.`
      : "";

    const prompt = `Transform this news photograph into a children's picture book illustration.
- Soft watercolor style, pastel colors, hand-drawn quality, warm and friendly
- Suitable for children ages 3 to 7
- Keep the scene and composition recognizable from the original photo
- No text, labels, or captions in the image
- STRICT SAFETY: no weapons, no violence, no blood, no threatening content${munInstruction}`;

    const parts: any[] = [{ inlineData: { data: photoData, mimeType: photoMime } }];
    if (tone === "positive") parts.push({ inlineData: loadMunRef() });
    parts.push({ text: prompt });

    const res = await axios.post(
      `${GEMINI_BASE}${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      { contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } },
      { timeout: 60000 }
    );

    return extractImage(res.data);
  } catch (err: any) {
    console.warn("[illustration] Error ilustrando foto:", err.message);
    return null;
  }
}

// Fallback: genera ilustración solo desde texto (cuando no hay foto en la noticia)
export async function generateIllustrationFromText(
  title: string,
  story: string,
  tone: NewsTone,
  apiKey: string
): Promise<string | null> {
  try {
    const munInstruction = tone === "positive"
      ? `\nThe last image is the "Mun" character reference. Add ONE Mun naturally integrated into the scene. Reproduce EXACTLY from the reference: cream crescent moon body, beige oval spots, happy squinting eyes. ONE character only.`
      : "";

    const prompt = `Create a children's picture book illustration for: "${title}".
Scene: ${story.substring(0, 250)}
- Soft watercolor style, pastel colors, hand-drawn quality, warm and friendly
- Suitable for children ages 3 to 7
- No text in the image. No weapons, violence, or disturbing content${munInstruction}`;

    const parts: any[] = [];
    if (tone === "positive") parts.push({ inlineData: loadMunRef() });
    parts.push({ text: prompt });

    const res = await axios.post(
      `${GEMINI_BASE}${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      { contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } },
      { timeout: 60000 }
    );

    return extractImage(res.data);
  } catch (err: any) {
    console.warn("[illustration] Error generando ilustración desde texto:", err.message);
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
