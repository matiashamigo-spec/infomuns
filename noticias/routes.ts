import { Router, Request, Response } from "express";
import axios from "axios";
import { readFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";
import { generateStoryFromUrl, refineStory } from "./pipeline.js";

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
    if (/^10\./.test(h)) return false;
    if (/^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === "169.254.169.254") return false;
    if (h.endsWith(".internal") || h.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

export function createNoticiasRouter(): Router {
  const router = Router();

  function safeError(err: any): string {
    const msg: string = err?.message || "Error interno";
    if (/password|secret|key|token|credential/i.test(msg)) return "Error interno";
    return msg.substring(0, 200);
  }

  function requireAdmin(req: Request, res: Response, next: any) {
    const secret = process.env.NOTICIAS_ADMIN_SECRET;
    if (!secret) return res.status(500).json({ error: "NOTICIAS_ADMIN_SECRET no configurada" });
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== secret) return res.status(401).json({ error: "No autorizado" });
    next();
  }

  // Genera la versión en sentence case del HTML usando Gemini — preserva nombres propios y tags HTML
  async function buildSentenceCase(htmlContent: string, apiKey: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey });
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `El siguiente es contenido HTML en MAYÚSCULAS en español. Devolvé EXACTAMENTE el mismo HTML con sentence case correcto:
- Primera letra de cada oración en mayúscula
- Nombres propios (personas, lugares, organizaciones) con mayúscula inicial
- Todo lo demás en minúscula
- Preservar TODOS los tags HTML exactamente como están (no agregar ni quitar nada)
- Preservar shortcodes como [muns_context]...[/muns_context] exactamente como están
- Devolver SOLO el HTML, sin explicaciones ni bloques markdown

HTML:
${htmlContent}`,
    });
    const text: string = r.text ?? "";
    return text.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim() || htmlContent;
  }

  // POST /api/noticias/sentence-case — convierte HTML a sentence case con nombres propios (para posts existentes)
  // Body: { html: string }
  // Devuelve: { ok, html }
  router.post("/sentence-case", requireAdmin, async (req: Request, res: Response) => {
    const { html } = req.body;
    if (!html || typeof html !== "string") return res.status(400).json({ error: "html requerido" });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
    try {
      const result = await buildSentenceCase(html, apiKey);
      res.json({ ok: true, html: result });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/generate-from-url — genera cuento Muns desde una URL de noticia
  // Devuelve: { ok, title, content, contentSentenceCase, story, contentSuffix, context, excerpt, imageUrl, cost }
  router.post("/generate-from-url", requireAdmin, async (req: Request, res: Response) => {
    const { url, context } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Se requiere una URL válida" });
    if (!isSafeUrl(url)) return res.status(400).json({ error: "URL no permitida" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
      console.log(`[noticias] Generando desde URL: ${url}`);
      const generated = await generateStoryFromUrl(url, apiKey, context);
      const contentSentenceCase = await buildSentenceCase(generated.content as string, apiKey).catch(() => generated.content as string);
      res.json({ ok: true, ...generated, contentSentenceCase });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/refine — ajuste puntual de un cuento ya generado (chat de retoque)
  // Body: { title, story, instruction }
  // Devuelve: { ok, title, story, content, contentSentenceCase, cost }
  router.post("/refine", requireAdmin, async (req: Request, res: Response) => {
    const { title, story, instruction } = req.body || {};
    if (!story || typeof story !== "string") return res.status(400).json({ error: "Falta story" });
    if (!instruction || typeof instruction !== "string") return res.status(400).json({ error: "Falta instruction" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
      console.log(`[noticias] Refinando: "${instruction}"`);
      const result = await refineStory(title || "", story, instruction, apiKey);
      const contentSentenceCase = await buildSentenceCase(result.content as string, apiKey).catch(() => result.content as string);
      res.json({ ok: true, ...result, contentSentenceCase });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/foto-muns-style — convierte una foto al estilo 2D Muns via Gemini
  // Body: { imageBase64: string, imageMime: string }
  // Devuelve: { ok, imageBase64, imageMime, cost } — el cliente sube a su propio WP via AJAX
  router.post("/foto-muns-style", requireAdmin, async (req: Request, res: Response) => {
    const { imageBase64, imageMime } = req.body;
    if (!imageBase64 || typeof imageBase64 !== "string") return res.status(400).json({ error: "imageBase64 requerido" });
    if (!imageMime || typeof imageMime !== "string") return res.status(400).json({ error: "imageMime requerido" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

    const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
    const GEMINI_MODEL = "gemini-3.1-flash-image";

    const PROMPT = `Transform this photo into the Muns 2D animation art style. The result must look exactly like a background frame from the Muns animated series.

ABSOLUTE RULES:
- NO TEXT WHATSOEVER: No letters, words, numbers, labels or writing anywhere in the image.
- NO ANIMATED CHARACTERS: Do NOT add Mun, Opaq, or any kawaii moon-shaped characters. Only convert the existing scene/background elements.

COLOR PALETTE — use ONLY these colors:
- Dark blue (dominant): #1F1D5B
- Blue (dominant): #4464AD
- Cream/white: #FEF8E7
- Brown: #A48A7B
- Yellow/gold (accents only, use sparingly): #E2C061
- Light blue: #9FCFE2
- Dark brown: #7B6A58
- Beige: #CBBBA0
- Light cream: #EDE6D4
Blues and browns are the dominant colors. Yellow/gold only for small details or highlights. Do NOT introduce any colors outside this palette.

STYLE RULES:
- Flat vector illustration with clean simple linework
- Rounded simplified shapes — everything has smooth, friendly curves
- Children's 2D animated TV show aesthetic — think simple, clear, warm
- Remove ALL photographic realism: no realistic lighting, no complex textures, no photographic shadows
- Keep the overall composition and recognizable elements but redraw as 2D flat cartoon

OUTPUT: A 16:9 horizontal image in the Muns 2D animation style — background/scene only, no animated characters.`;

    try {
      const geminiRes = await axios.post(
        `${GEMINI_BASE}${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [
            { inlineData: { data: imageBase64, mimeType: imageMime } },
            { text: PROMPT },
          ]}],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        },
        { timeout: 90000 }
      );

      let resultData: string | null = null;
      let resultMime = "image/png";
      for (const c of geminiRes.data?.candidates || []) {
        for (const p of c.content?.parts || []) {
          if (p.inlineData?.data) { resultData = p.inlineData.data; resultMime = p.inlineData.mimeType || "image/png"; break; }
        }
        if (resultData) break;
      }

      if (!resultData) {
        const reason = geminiRes.data?.candidates?.[0]?.finishReason;
        throw new Error("Gemini no generó imagen" + (reason ? ` (${reason})` : "") + ". Probá con otra foto.");
      }

      const usage = geminiRes.data?.usageMetadata;
      const inputTokens: number = usage?.promptTokenCount ?? 0;
      const outputTokens: number = usage?.candidatesTokenCount ?? 0;
      const costUsd = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 1.25;
      console.log(`[foto-muns-style] tokens: in=${inputTokens} out=${outputTokens} ~$${costUsd.toFixed(4)}`);

      res.json({ ok: true, imageBase64: resultData, imageMime: resultMime, cost: { inputTokens, outputTokens, usd: costUsd } });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
      console.error("[foto-muns-style] error:", detail);
      res.status(500).json({ error: safeError(err), detail });
    }
  });

  const MUNS_CHARACTERS: Record<string, string> = {
    mun:       "Mun",
    mun_triste:"Mun triste",
    opaq:      "Opaq",
  };

  // POST /api/noticias/foto-muns-sugerir — dada la historia, elige el personaje más apropiado (solo texto, rápido)
  // Body: { story: string }
  // Devuelve: { ok, character, displayName }
  router.post("/foto-muns-sugerir", requireAdmin, async (req: Request, res: Response) => {
    const { story } = req.body;
    if (!story || typeof story !== "string") return res.status(400).json({ error: "story requerido" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

    const charOptions = [
      "mun: historia positiva, neutral, aventura, curiosidad, logro",
      "mun_triste: historia triste, pérdida, despedida, situación difícil",
      "opaq: historia seria, formal, conflicto, denuncia, situación grave",
    ].join("\n");

    try {
      const textRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          contents: [{
            parts: [{
              text: `Dado este cuento para niños:\n\n${story.substring(0, 2000)}\n\nElegí el personaje Muns más apropiado para acompañar visualmente esta nota.\n\nOpciones:\n${charOptions}\n\nRespondé SOLO con el nombre exacto (ejemplo: mun_contento). Sin explicación.`,
            }],
          }],
        },
        { timeout: 30000 }
      );

      let charKey = (textRes.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim().replace(/[^a-z_]/g, "");
      if (!MUNS_CHARACTERS[charKey]) charKey = "mun_contento";
      console.log(`[foto-muns-sugerir] sugerido: ${charKey}`);

      res.json({ ok: true, character: charKey, displayName: MUNS_CHARACTERS[charKey] });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
      console.error("[foto-muns-sugerir] error:", detail);
      res.status(500).json({ error: safeError(err), detail });
    }
  });

  // POST /api/noticias/foto-muns-personajes — compone un personaje Muns en una imagen estilo Muns
  // Body: { imageBase64: string, imageMime: string, character: string, story?: string }
  // Devuelve: { ok, imageBase64, imageMime, character, cost }
  router.post("/foto-muns-personajes", requireAdmin, async (req: Request, res: Response) => {
    const { imageBase64, imageMime, character, story } = req.body;
    if (!imageBase64 || typeof imageBase64 !== "string") return res.status(400).json({ error: "imageBase64 requerido" });
    if (!imageMime || typeof imageMime !== "string") return res.status(400).json({ error: "imageMime requerido" });
    if (!character || !MUNS_CHARACTERS[character]) return res.status(400).json({ error: "character inválido" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

    try {
      const charPath = path.join(process.cwd(), "noticias", "characters", `${character}.png`);
      const charBase64 = (await readFile(charPath)).toString("base64");
      const displayName = MUNS_CHARACTERS[character];

      const PROMPT = `You have two images:
- IMAGE 1: The Muns character "${displayName}" — a flat 2D kawaii character. Use this as the BODY REFERENCE only.
- IMAGE 2: A 2D animated Muns-style background scene (16:9 horizontal).

YOUR TASK: Draw the character from IMAGE 1 into the scene of IMAGE 2.

BODY — copy exactly from IMAGE 1:
- Same body shape, proportions, limbs, and silhouette
- Same body colors and flat 2D kawaii style
- Do NOT add detail or change the body

FACIAL EXPRESSION — adapt to the scene in IMAGE 2:
- Look at IMAGE 2 and decide what emotion the character would naturally feel in that situation
- Give the character a matching expression: surprised, scared, curious, excited, sad, amazed, or any fitting emotion
- The expression must react to what is actually happening in the scene
- Keep the face simple and flat 2D kawaii — only change eyes/mouth to show the emotion

PLACEMENT:
- Natural physically-possible pose (standing, sitting, leaning)
- Lower third, LEFT or RIGHT side
- Character height about 30-35% of total image height
- Faces inward toward the center of the scene
- Soft drop shadow beneath the character

COLOR PALETTE — use only these colors:
- Dark blue: #1F1D5B — Blue: #4464AD — Cream: #FEF8E7 — Brown: #A48A7B
- Yellow/gold (accents only): #E2C061 — Light blue: #9FCFE2
- Dark brown: #7B6A58 — Beige: #CBBBA0 — Light cream: #EDE6D4

RULES:
- No text, no labels, no writing anywhere
- Flat 2D vector style throughout

OUTPUT: 16:9 image with the character in the scene, expression reacting to what is happening.`;

      const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
      const GEMINI_MODEL = "gemini-3.1-flash-image";

      const geminiRes = await axios.post(
        `${GEMINI_BASE}${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [
            { inlineData: { data: charBase64, mimeType: "image/png" } },
            { inlineData: { data: imageBase64, mimeType: imageMime } },
            { text: PROMPT },
          ]}],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        },
        { timeout: 120000 }
      );

      let resultData: string | null = null;
      let resultMime = "image/png";
      for (const c of geminiRes.data?.candidates || []) {
        for (const p of c.content?.parts || []) {
          if (p.inlineData?.data) { resultData = p.inlineData.data; resultMime = p.inlineData.mimeType || "image/png"; break; }
        }
        if (resultData) break;
      }

      // Fallback: si Gemini no genera o falla, hacer composite directo con sharp
      if (!resultData) {
        console.warn(`[foto-muns-personajes] Gemini no generó imagen, usando fallback sharp`);
        const bgBuf = Buffer.from(imageBase64, "base64");
        const bgMeta = await sharp(bgBuf).metadata();
        const bgW = bgMeta.width ?? 1024;
        const bgH = bgMeta.height ?? 576;
        const charH = Math.round(bgH * 0.32);
        const charBuf = await sharp(charPath).resize({ height: charH, fit: "inside" }).toBuffer();
        const charMeta = await sharp(charBuf).metadata();
        const charW = charMeta.width ?? charH;
        const side = character.includes("opaq") ? "right" : "left";
        const margin = Math.round(bgW * 0.04);
        const left = side === "left" ? margin : bgW - charW - margin;
        const top = bgH - charH - Math.round(bgH * 0.05);
        const fallbackBuf = await sharp(bgBuf).composite([{ input: charBuf, left, top }]).png().toBuffer();
        resultData = fallbackBuf.toString("base64");
        resultMime = "image/png";
      }

      const usage = geminiRes.data?.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? 0;
      const outputTokens = usage?.candidatesTokenCount ?? 0;
      const costUsd = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 1.25;
      console.log(`[foto-muns-personajes] char=${character} ok, tokens: in=${inputTokens} out=${outputTokens} ~$${costUsd.toFixed(4)}`);

      res.json({ ok: true, imageBase64: resultData, imageMime: resultMime, character, cost: { inputTokens, outputTokens, usd: costUsd } });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
      console.error("[foto-muns-personajes] error:", detail);
      res.status(500).json({ error: safeError(err), detail });
    }
  });

  return router;
}
