import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Redraw the concept of this news photograph as an extremely simple, clumsy crayon drawing made by a happy 4-year-old child on plain white paper.

The drawing must feel genuinely childlike, warm and innocent — messy in a cute way, never creepy, disturbing or unsettling.

VISUAL STYLE — non-negotiable:
- Plain white paper background, absolutely nothing else
- Very simple child drawing, as if made quickly with crayons
- Wobbly circles, uneven rectangles, shaky imperfect lines — clearly drawn by a small child
- People are simple blobs: oversized round head, rectangle or soft blob body, stick arms and legs
- Faces are VERY minimal: two uneven dots for eyes and a small curved smile
- Expressions should feel friendly, curious, surprised or happy — never sad, threatening or uncanny
- Scribbly coloring inside shapes with visible crayon texture
- Coloring should be loose and imperfect, slightly outside the lines, but soft and playful rather than chaotic
- Exactly 3 colors only:
  - deep blue (#4464AD)
  - sky blue (#9FCFE2)
  - warm beige (#CBBBA0)
- Uneven proportions are encouraged, but in a cute and playful way (big heads, tiny legs, funny poses)
- The result should feel charmingly naive and wholesome, like a drawing proudly shown by a preschooler to their parents

CONTENT RULES:
- Anonymous people only, no recognizable characters or IP
- Simplify everything aggressively:
  - crowd = 2–3 happy blobs
  - building = wobbly square with triangle roof
  - vehicle = simple rounded shape with circles
- Prefer uplifting or neutral interpretations of the original scene
- No sadness, fear, panic, crying or threatening atmosphere
- No violence, weapons, blood, destruction or dark symbolism
- No text, labels or captions

IMPORTANT:
This must look authentically child-made, but emotionally warm and endearing — imperfect, cute and playful, not disturbing or psychologically intense.`;

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

export async function generateIllustrationFromText(title: string, story: string, apiKey: string): Promise<string | null> {
  console.log(`[illustration] Generando desde cuento: "${title}"`);
  try {
    const scenePrompt = `Draw this children's story scene as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}

STORY SUMMARY (use this to decide WHAT to draw):
${story.substring(0, 600)}

Based on the story above, identify the most visual and emotionally meaningful scene — a character, a place, an object or a moment — and draw it in the childlike crayon style described below. The drawing must illustrate the STORY, not a news photo.

${PROMPT}`;

    const res = await axios.post(
      `${API_BASE}${MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [{ text: scenePrompt }],
        }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
      { timeout: 60000 }
    );

    for (const c of res.data?.candidates || []) {
      for (const p of c.content?.parts || []) {
        if (p.inlineData?.data) {
          console.log(`[illustration] OK (desde cuento)`);
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }
    console.warn("[illustration] Sin imagen desde cuento:", JSON.stringify(res.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text)));
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error desde cuento:", err.message);
    return null;
  }
}
