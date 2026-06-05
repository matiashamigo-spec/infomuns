import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Transform this news photograph into a children's illustration in the style of Bluey (the Australian animated show).
- Thick, slightly wobbly black marker-style outlines — irregular stroke weight, not perfectly smooth
- Watercolor-like flat fills that slightly overflow the outlines, giving a hand-painted feel
- Clean white background with lots of negative space — no busy backgrounds
- Very simple rounded shapes, cute exaggerated proportions, large heads, small bodies
- Characters have minimal facial features: dot eyes, simple curved mouth, basic expressions
- Exactly 3 color fills only: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0) — used as the watercolor fills
- Loose, casual, slightly imperfect linework — confident but not polished
- SIMPLIFICATION RULE: If the scene has many people or complex elements, do NOT try to draw everyone. Pick 1–3 representative figures drawn simply — like a child would sketch "a crowd" as just a few rounded cartoon people. Always prioritize a clean readable image over accuracy.
- Keep the general mood and topic recognizable, but simplify everything aggressively
- No text, labels or captions in the image
- STRICT SAFETY: no weapons, no violence, no blood, no threatening content`;

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

export async function generateIllustrationFromText(_title: string, _story: string, _apiKey: string): Promise<string | null> {
  return null;
}
