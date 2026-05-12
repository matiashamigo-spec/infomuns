// Ilustración de noticias para Muns
// Toma la foto original de la noticia y aplica estilo ilustración infantil

import axios from "axios";

const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const STYLE_PROMPT = `Transform the uploaded image into a soft hand drawn children's book illustration, with delicate pencil and crayon sketch lines, warm textured paper background, pastel muted palette, light watercolor shading, minimalistic botanical details, cute expressive characters with blush cheeks and simple rounded shapes, airy composition, imperfect organic outlines, cozy nostalgic mood, handcrafted traditional illustration style, subtle grain, soft warm lighting, whimsical storybook aesthetic.`;

// Ilustra a partir de la foto original de la noticia
export async function illustrateImage(
  imageUrl: string,
  apiKey: string
): Promise<string | null> {
  console.log(`[illustration] Usando modelo: ${GEMINI_IMAGE_MODEL}`);
  console.log(`[illustration] Fetch foto: ${imageUrl}`);
  try {
    const photoResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const photoData = Buffer.from(photoResponse.data).toString("base64");
    const photoMime = (photoResponse.headers["content-type"] || "image/jpeg").split(";")[0];

    const parts: any[] = [
      { inlineData: { data: photoData, mimeType: photoMime } },
      { text: STYLE_PROMPT },
    ];

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
  apiKey: string
): Promise<string | null> {
  try {
    const prompt = `Create a children's book illustration about: "${title}". ${STYLE_PROMPT} No specific characters, focus on scenery and mood.`;

    const res = await axios.post(
      `${GEMINI_BASE}${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
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
