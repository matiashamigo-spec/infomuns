import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Redraw the concept of this news photograph in the style of a child's notebook doodle — like the "Mini Episodes" hand-drawn aesthetic where characters are deliberately crude and geometric.

VISUAL STYLE — this is mandatory:
- Background: lined notebook paper texture (light cream with faint blue horizontal rules)
- Characters/people are drawn as simple geometric shapes: rectangular bodies, circle heads, stick or stubby limbs — NO realistic anatomy whatsoever
- Faces: only two dot eyes and a single curved line for mouth — that's it
- Lines are thick, uneven, wobbly — drawn with a felt-tip marker by an unsteady hand
- Colors scribble slightly outside the outlines — imprecise, not filled cleanly
- Exactly 3 fill colors: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0)
- Proportions are intentionally wrong: huge heads, tiny bodies, arms coming out of the wrong place
- The overall look must feel hand-made, rushed, and charmingly bad — NOT clean, NOT polished, NOT like professional animation

CONTENT RULES:
- DO NOT reproduce any character from any existing show, franchise, or IP
- Represent people as anonymous geometric blobs — no fur, no animal features, no costumes
- SIMPLIFICATION: reduce the scene to 1–3 figures max representing the idea symbolically. A crowd = 2-3 rectangles with circle heads. A meeting = blobs sitting around a shape. Always simplify, never reproduce.
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
