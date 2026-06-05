import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Redraw this news photograph as if a 7-year-old child drew it with markers and watercolors.
- Thick wobbly black marker outlines, uneven stroke weight, slightly shaky lines — NOT clean, NOT digital-looking
- Watercolor fills that bleed slightly outside the outlines — loose, imprecise, hand-painted feel
- Pure white background, no scenery detail, lots of empty space
- Extremely simplified shapes: people are blobs with round heads, dot eyes, a curved line for mouth — no realistic faces
- Proportions are wrong in a charming way: big heads, stubby arms, flat feet
- Exactly 3 watercolor fill colors: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0)
- SIMPLIFICATION RULE: if there are many people or a complex scene, draw only 1–3 simplified figures that represent the idea — like a child summarizing the scene, not reproducing it. A crowd becomes 2-3 little blob people.
- The result should look genuinely hand-made and imperfect, NOT like a polished cartoon or animation studio output
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
