import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Redraw the concept of this news photograph as if drawn by a 4 to 6 year old child using crayons or thick markers on white paper.

CRITICAL — what this must look like:
- Stick figures or potato-shaped blobs for people. No anatomy, no realistic proportions. Heads are circles, bodies are rectangles or ovals, arms and legs are just lines or thick stumps.
- Faces are ONLY: two dots for eyes and a curved line or U shape for a mouth. Nothing more.
- Lines are shaky, uneven, inconsistent — a child's hand, not a steady adult hand
- Colors are scribbled and often go outside the lines
- Exactly 3 colors used for fills: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0)
- White background, minimal scene — just the essential shapes, lots of empty white space
- DO NOT invent named characters, cartoon mascots, animals with clothes, or any character from any show or franchise
- DO NOT make it look like animation, illustration, or graphic design — it must look like actual crayon drawings by a small child
- SIMPLIFICATION RULE: reduce the scene to its simplest symbolic representation. A protest = 2-3 blob people with their arms up. A car crash = a boxy rectangle shape tipped over. A building = a square with a triangle on top.
- The result MUST look primitive, clumsy, and lovably imperfect — NOT polished, NOT cute-cartoon, NOT professional
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
