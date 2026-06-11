import axios from "axios";

const MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

const PROMPT = `Draw this as a very basic crayon sketch made by a 4-year-old child on plain white paper. The image must be horizontal, 16:9 widescreen format.

STYLE — strict:
- Plain WHITE background — pure white, nothing else, no gradients, no texture
- OUTLINES ONLY: shapes are drawn with a single wobbly crayon line — no fill, no shading, no solid blocks of color
- If there is any color fill, it must be very sparse: a few loose scribble strokes inside the shape, leaving most of the interior white
- Lines are shaky, uneven, clearly hand-drawn by a small child
- People: circle head, rectangle body, stick arms and legs — nothing more
- Faces: two dots for eyes, one curved line for mouth — that's all
- Objects: simplest possible outline shape — a house is a square and a triangle, a tree is a circle on a stick
- Exactly 3 colors: deep blue (#4464AD), sky blue (#9FCFE2), warm beige (#CBBBA0)
- Each color used sparingly — mostly outlines, almost no fill
- The drawing looks unfinished and sparse, like a child who drew quickly and got bored halfway through

CONTENT RULES:
- Anonymous figures only, no recognizable characters or IP
- Maximum 2–3 elements total in the scene — do not crowd the drawing
- No text, labels or captions
- No violence, weapons, blood or dark content`;

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
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], aspectRatio: "16:9" },
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

async function generateSingleScene(scenePrompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await axios.post(
      `${API_BASE}${MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: scenePrompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], aspectRatio: "16:9" },
      },
      { timeout: 60000 }
    );
    for (const c of res.data?.candidates || []) {
      for (const p of c.content?.parts || []) {
        if (p.inlineData?.data) {
          return `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`;
        }
      }
    }
    return null;
  } catch (err: any) {
    console.warn("[illustration] Error en escena:", err.message);
    return null;
  }
}

export async function generateIllustrationFromText(title: string, story: string, apiKey: string): Promise<string | null> {
  console.log(`[illustration] Generando desde cuento: "${title}"`);
  const scenePrompt = `Draw this children's story scene as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}

STORY SUMMARY (use this to decide WHAT to draw):
${story.substring(0, 600)}

Based on the story above, identify the most visual and emotionally meaningful scene — a character, a place, an object or a moment — and draw it in the childlike crayon style described below. The drawing must illustrate the STORY, not a news photo.

${PROMPT}`;

  const result = await generateSingleScene(scenePrompt, apiKey);
  if (result) console.log(`[illustration] OK (desde cuento)`);
  else console.warn(`[illustration] Sin imagen desde cuento: "${title}"`);
  return result;
}

export async function generateIllustrationSet(title: string, story: string, apiKey: string): Promise<string[]> {
  console.log(`[illustration] Generando 4 escenas para: "${title}"`);

  const storySummary = story.substring(0, 600);
  const sceneDescriptions = [
    `SCENE 1 — THE PLACE: Draw only the setting where the story happens. No characters. Just the location — a landscape, a building, a river, a street. One or two simple outline shapes maximum. Empty and sparse.`,
    `SCENE 2 — THE CHARACTER(S): Draw only the Muns or main figure(s) in this story. No background, no setting. Just the character(s) standing or doing something simple. Stick figures with big round heads.`,
    `SCENE 3 — THE KEY OBJECT: Draw only the one most important object from the story — the bolso, a broken thing, an animal, a door, whatever matters most. Just that object, centered, alone on white paper.`,
    `SCENE 4 — THE ENDING MOMENT: Draw the final moment of the story — what the scene looks like when it ends. Could be a character leaving, something left behind, or an empty place. One simple image.`,
  ];

  const prompts = sceneDescriptions.map((scene, i) => `Draw scene ${i + 1} of 4 from this children's story as a crayon drawing by a 4-year-old child.

STORY TITLE: ${title}

STORY SUMMARY:
${storySummary}

SCENE TO DRAW (scene ${i + 1} of 4):
${scene}

The drawing must illustrate THIS SPECIFIC MOMENT from the story above. Do not use any news photo as reference — draw from the story.

${PROMPT}`);

  const results = await Promise.all(prompts.map(p => generateSingleScene(p, apiKey)));
  const valid = results.filter((r): r is string => r !== null);
  console.log(`[illustration] ${valid.length}/4 escenas generadas para "${title}"`);
  return valid;
}
