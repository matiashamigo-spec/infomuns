import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Redraw the concept of this news photograph as a deliberately crude, geometric hand-drawn illustration — like a child's doodle made with thick markers on plain white paper.

VISUAL STYLE — strictly required:
- Plain white background, no texture, no scenery details
- People are drawn as simple geometric shapes: rectangle or oval body, circle head, stick or stubby arms and legs — zero realistic anatomy
- Faces have ONLY two dot eyes and one curved line for mouth — nothing else
- Thick, wobbly, uneven marker-like outlines — imprecise, not smooth
- Colors filled loosely, slightly outside the lines
- Exactly 3 fill colors: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0)
- Intentionally wrong proportions: oversized heads, tiny bodies, arms in odd positions
- Must look hand-made, rushed, and charmingly crude — NOT polished, NOT like a cartoon studio, NOT like graphic design

CONTENT RULES:
- DO NOT copy characters from any existing show, franchise, or IP — people are anonymous geometric blobs only
- SIMPLIFICATION: reduce everything to 1–3 symbolic figures. A crowd = 2-3 rectangle-bodied blobs. A building = a square with a triangle. Always choose the simplest possible representation.
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
