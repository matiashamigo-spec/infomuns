import axios from "axios";

const MODEL = "gemini-2.0-flash-exp-image-generation";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Redraw this exact photo as a children's book illustration. Keep the same people, scene, composition and setting from the photo — do not invent new subjects or characters. Only change the visual style to: soft hand drawn lines, delicate pencil and crayon sketch, warm textured paper background, pastel muted palette, light watercolor shading, airy composition, imperfect organic outlines, subtle grain texture, fine ink linework, cozy nostalgic atmosphere, soft warm lighting, vintage storybook aesthetic, analog sketchbook feel, loose expressive strokes.`;

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
          console.log(`[illustration] Imagen generada OK`);
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }
    console.warn("[illustration] Gemini no devolvió imagen");
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error:", err.message);
    return null;
  }
}

// Mantener export para compatibilidad con routes.ts
export async function generateIllustrationFromText(title: string, _story: string, apiKey: string): Promise<string | null> {
  console.warn("[illustration] generateIllustrationFromText llamado sin imageUrl — se omite");
  return null;
}
