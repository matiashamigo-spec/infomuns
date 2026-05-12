// Convierte una imagen de noticia en ilustración estilo libro infantil
// usando Gemini 2.5 Flash Image con la paleta de colores de muns.club

import axios from "axios";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const ILLUSTRATION_PROMPT = `Transform this news photograph into a children's book illustration.

Style: soft watercolor and pastel strokes, hand-drawn quality, warm and friendly, suitable for ages 4-8.
Color palette (use these as the dominant colors): cornflower blue (#4464AD), sky blue (#9FCFE2), powder blue (#C2DCF2), warm cream (#F4F1EA), sandy cream (#EDE6D4), warm brown (#7B6A58), white (#FFFFFF).

Rules:
- Render everything as a hand-drawn illustration — people become friendly cartoon characters, backgrounds become painted scenes
- Keep the scene recognizable and the subject matter clear
- Bright, warm, joyful mood — even for serious topics, keep it gentle and safe for children ages 3 to 7
- No photorealism whatsoever
- No text, no labels, no captions in the image
- Soft rounded shapes, no harsh edges
- The illustration should feel like it belongs in a picture book
- STRICT SAFETY: absolutely NO weapons of any kind (no guns, knives, swords, missiles, bombs, or any object that could harm), NO violence, NO blood, NO explosions, NO threatening gestures, NO military equipment shown as threatening. If the original image contains any of these elements, replace them with neutral, peaceful objects (e.g. a flag becomes a flower, a weapon becomes a musical instrument, soldiers become explorers)
- Characters must look friendly, round-faced, and approachable — never scary, angry, or threatening
- Everything must be 100% appropriate for a 3-year-old child`;

const GENERATE_FROM_TEXT_PROMPT = (title: string, story: string) =>
  `Create a children's book illustration for a story titled "${title}".

Story summary: ${story.substring(0, 300)}

Style: soft watercolor and pastel strokes, hand-drawn quality, warm and friendly, suitable for ages 3 to 7.
Color palette (dominant colors): cornflower blue (#4464AD), sky blue (#9FCFE2), powder blue (#C2DCF2), warm cream (#F4F1EA), sandy cream (#EDE6D4), warm brown (#7B6A58), white (#FFFFFF).

Rules:
- Friendly cartoon characters, round faces, approachable and warm
- Bright, joyful mood — gentle and safe for very young children
- No text, labels, or captions in the image
- Soft rounded shapes, no harsh edges
- Feels like a page from a picture book
- STRICT SAFETY: absolutely NO weapons, NO violence, NO blood, NO explosions, NO threatening objects or gestures. Everything peaceful and kind.
- 100% appropriate for a 3-year-old child`;

export async function generateIllustrationFromText(title: string, story: string, apiKey: string): Promise<string | null> {
  try {
    const body = {
      contents: [{ parts: [{ text: GENERATE_FROM_TEXT_PROMPT(title, story) }] }],
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

export async function illustrateImage(imageUrl: string, apiKey: string): Promise<string | null> {
  try {
    // Download the original image
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
          { text: ILLUSTRATION_PROMPT },
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

    console.warn("[illustration] Gemini no devolvió imagen, usando original");
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error generando ilustración:", err.message);
    return null;
  }
}
