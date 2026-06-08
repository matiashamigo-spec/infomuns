import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Redraw the concept of this news photograph as an extremely crude, messy drawing made by a 4-year-old child with crayons on white paper. This must look GENUINELY bad — not stylized bad, but actually bad.

VISUAL STYLE — non-negotiable:
- Plain white background, absolutely nothing else
- Every shape is wrong: wobbly circles, lopsided rectangles, uneven lines — nothing is straight or symmetrical
- People are blobs: a round or lumpy head, a rectangle or blob for body, two sticks for legs, two sticks for arms — that's it. No detail whatsoever.
- Faces: two asymmetric dots for eyes, one wonky curved line for mouth — nothing else. No nose. No ears. No hair.
- Lines are shaky, broken, uneven — like drawn very slowly by an unsteady hand
- Colors scribbled chaotically: heavy outside the shapes, uneven fill, patches of white showing through, overlapping strokes going in random directions
- Exactly 3 colors: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0)
- Grotesquely wrong proportions: head bigger than the body, arms at impossible angles, legs too short or too long
- This must look like the drawing was done in 30 seconds by someone who has never drawn before

CONTENT RULES:
- DO NOT copy characters from any existing show, franchise, or IP — people are anonymous blobs only
- SIMPLIFICATION: 1–3 figures maximum. A crowd = 2-3 blobs. A building = a wobbly square with a triangle on top. Always the simplest possible.
- No text, labels or captions
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
