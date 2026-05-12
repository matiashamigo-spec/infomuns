import axios from "axios";
import { GoogleGenAI } from "@google/genai";

const IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const STYLE_PROMPT = `Soft hand drawn children's book illustration style, delicate pencil and crayon sketch lines, warm textured paper background, pastel muted palette, light watercolor shading, airy composition with lots of negative space, imperfect organic outlines, subtle grain texture, minimal botanical doodles, fine ink linework, cozy nostalgic atmosphere, handcrafted traditional illustration aesthetic, soft warm lighting, whimsical and poetic mood, analog sketchbook feel, gentle layering of color, loose expressive strokes, vintage storybook illustration style, minimal yet emotional visual language.`;

// Paso 1: describe la foto con Gemini 1.5 Pro
async function describeImage(imageUrl: string, apiKey: string): Promise<string | null> {
  try {
    const photo = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const photoData = Buffer.from(photo.data).toString("base64");
    const photoMime = (photo.headers["content-type"] || "image/jpeg").split(";")[0];

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { data: photoData, mimeType: photoMime } },
          { text: "Describe this image in detail: the setting, main subjects, actions, colors, atmosphere, and composition. Be specific and visual. No interpretation — only describe what you see." },
        ],
      }],
    });

    const description = response.text?.trim() || null;
    console.log(`[illustration] Descripción: ${description?.substring(0, 120)}...`);
    return description;
  } catch (err: any) {
    console.warn("[illustration] Error describiendo imagen:", err.message);
    return null;
  }
}

// Paso 2: genera la ilustración a partir de la descripción + estilo
async function generateFromDescription(description: string, apiKey: string): Promise<string | null> {
  try {
    const prompt = `Illustrate exactly this real scene: ${description}\n\nIMPORTANT: Draw the actual people and places described above as they are — real human figures in illustration style. No invented characters, no cartoon mascots, no fantasy beings, no animals replacing humans. Just the real scene drawn in this style: ${STYLE_PROMPT}`;

    const res = await axios.post(
      `${API_BASE}${IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
      { timeout: 60000 }
    );

    for (const c of res.data?.candidates || []) {
      for (const p of c.content?.parts || []) {
        if (p.inlineData?.data) {
          console.log(`[illustration] Imagen generada OK`);
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }
    console.warn("[illustration] Gemini no devolvió imagen");
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error generando imagen:", err.message);
    return null;
  }
}

export async function illustrateImage(imageUrl: string, apiKey: string): Promise<string | null> {
  console.log(`[illustration] Procesando: ${imageUrl}`);

  // Paso 1: describir la foto original
  const description = await describeImage(imageUrl, apiKey);
  if (!description) return null;

  // Paso 2: generar ilustración basada en la descripción
  return generateFromDescription(description, apiKey);
}

export async function generateIllustrationFromText(title: string, _story: string, apiKey: string): Promise<string | null> {
  console.log(`[illustration] Generando desde título: ${title}`);
  return generateFromDescription(title, apiKey);
}
