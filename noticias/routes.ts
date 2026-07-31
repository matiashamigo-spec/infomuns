import { Router, Request, Response } from "express";
import axios from "axios";
import { readFile } from "fs/promises";
import path from "path";
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

STYLE RULES:
- Flat vector illustration with clean simple linework
- Soft pastel colors: deep indigo blue (#4464AD), warm yellows, soft violets and creams
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
    mun_contento:    "Mun alegre",
    mun_triste:      "Mun triste",
    mun_enojado:     "Mun enojado",
    mun_sorprendido: "Mun sorprendido",
    mun_conmovido:   "Mun conmovido",
    mun_divertido:   "Mun divertido",
    opaq_contento:   "Opaq alegre",
    opaq_triste:     "Opaq triste",
    opaq_enojado:    "Opaq enojado",
    opaq_sorprendido:"Opaq sorprendido",
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
      "mun_contento: alegría, logro, buenas noticias, éxito, celebración",
      "mun_triste: tristeza, pérdida, despedida, lamento, derrota",
      "mun_enojado: injusticia, conflicto, bronca, protesta",
      "mun_sorprendido: descubrimiento, sorpresa, impacto, revelación",
      "mun_conmovido: emoción profunda, conmoción, solidaridad",
      "mun_divertido: humor, diversión, entretenimiento, juego, festejo",
      "opaq_contento: éxito formal o técnico, logro serio",
      "opaq_triste: situación muy grave, crisis, pérdida importante",
      "opaq_enojado: conflicto serio, denuncia, problema grave",
      "opaq_sorprendido: revelación impactante inesperada con tono serio",
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
  // Body: { imageBase64: string, imageMime: string, character: string }
  // Devuelve: { ok, imageBase64, imageMime, character, cost }
  router.post("/foto-muns-personajes", requireAdmin, async (req: Request, res: Response) => {
    const { imageBase64, imageMime, character } = req.body;
    if (!imageBase64 || typeof imageBase64 !== "string") return res.status(400).json({ error: "imageBase64 requerido" });
    if (!imageMime || typeof imageMime !== "string") return res.status(400).json({ error: "imageMime requerido" });
    if (!character || !MUNS_CHARACTERS[character]) return res.status(400).json({ error: "character inválido" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

    try {
      const charPath = path.join(process.cwd(), "noticias", "characters", `${character}.png`);
      const charBase64 = (await readFile(charPath)).toString("base64");

      const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
      const GEMINI_MODEL = "gemini-3.1-flash-image";

      const displayName = MUNS_CHARACTERS[character];
      const PROMPT = `You have two images:
- IMAGE 1: A 2D animated scene in the Muns kawaii animation style (16:9 horizontal)
- IMAGE 2: A flat 2D Muns character called "${displayName}"

Task: Redraw IMAGE 1 with the Muns character from IMAGE 2 naturally integrated into the scene.

PLACEMENT RULES:
- Place the character on the LEFT side or RIGHT side, never centered
- The character stands in the lower third of the image
- Character height: approximately 25-35% of the total image height
- The character faces inward toward the center of the scene

STYLE RULES:
- Exact flat 2D kawaii animation style throughout — clean vector lines, soft rounded shapes, pastel colors
- Keep ALL existing elements of the original scene intact
- The character must look like it naturally belongs there
- NO text, NO labels, NO writing anywhere

OUTPUT: A 16:9 horizontal image with the character integrated into the scene.`;

      const geminiRes = await axios.post(
        `${GEMINI_BASE}${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          contents: [{
            parts: [
              { inlineData: { data: imageBase64, mimeType: imageMime } },
              { inlineData: { data: charBase64, mimeType: "image/png" } },
              { text: PROMPT },
            ],
          }],
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

      if (!resultData) {
        const reason = geminiRes.data?.candidates?.[0]?.finishReason;
        throw new Error("Gemini no generó imagen" + (reason ? ` (${reason})` : ""));
      }

      const usage = geminiRes.data?.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? 0;
      const outputTokens = usage?.candidatesTokenCount ?? 0;
      const costUsd = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 1.25;
      console.log(`[foto-muns-personajes] char=${character} tokens: in=${inputTokens} out=${outputTokens} ~$${costUsd.toFixed(4)}`);

      res.json({ ok: true, imageBase64: resultData, imageMime: resultMime, character, cost: { inputTokens, outputTokens, usd: costUsd } });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
      console.error("[foto-muns-personajes] error:", detail);
      res.status(500).json({ error: safeError(err), detail });
    }
  });

  return router;
}
