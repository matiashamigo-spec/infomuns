import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Transform this news photograph into a hand-drawn doodle art style illustration, as if drawn by a child with confidence but no technical skill.
- Naive cartoon aesthetic, rough uneven sketchy linework, intentionally imperfect drawing
- Simple rounded shapes, loose expressive lines, imperfect digital brush strokes
- Storyboard / animatic look, flat muted colors, sparse composition
- Exactly 3 flat color fills only: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0) — colors slightly overflow the lines, no gradients
- Cute anthropomorphic characters if present, childlike but intentional drawing
- Indie web animation vibe, lots of negative space, plain white or light background
- Minimalist illustration, slightly awkward proportions, simple smiley-face-level expressions
- Low-detail, casual scribbly charm, not polished, not hyper-detailed
- SIMPLIFICATION RULE: If the scene has many people or complex elements, do NOT try to draw everyone. Pick 1–3 representative figures and draw them simply — like a kid would draw "a crowd" as just a few stick-ish rounded people. The goal is a simple readable image, not a faithful reproduction of the photo.
- Keep the general mood and setting recognizable, but always prioritize simplicity over accuracy
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
