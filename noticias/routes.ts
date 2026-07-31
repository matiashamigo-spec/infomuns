import { Router, Request, Response } from "express";
import axios from "axios";
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

  // POST /api/noticias/generate-from-url — genera cuento Muns desde una URL de noticia
  // Devuelve: { ok, title, content, story, contentSuffix, context, excerpt, imageUrl, cost }
  router.post("/generate-from-url", requireAdmin, async (req: Request, res: Response) => {
    const { url, context } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Se requiere una URL válida" });
    if (!isSafeUrl(url)) return res.status(400).json({ error: "URL no permitida" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
      console.log(`[noticias] Generando desde URL: ${url}`);
      const generated = await generateStoryFromUrl(url, apiKey, context);
      res.json({ ok: true, ...generated });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/refine — ajuste puntual de un cuento ya generado (chat de retoque)
  // Body: { title, story, instruction }
  // Devuelve: { ok, title, story, content, cost }
  router.post("/refine", requireAdmin, async (req: Request, res: Response) => {
    const { title, story, instruction } = req.body || {};
    if (!story || typeof story !== "string") return res.status(400).json({ error: "Falta story" });
    if (!instruction || typeof instruction !== "string") return res.status(400).json({ error: "Falta instruction" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
      console.log(`[noticias] Refinando: "${instruction}"`);
      const result = await refineStory(title || "", story, instruction, apiKey);
      res.json({ ok: true, ...result });
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

    const PROMPT = `Transform this photo into the Muns 2D animation art style. The result must look exactly like a frame from the Muns animated series.

ABSOLUTE RULE — NO TEXT WHATSOEVER: No letters, words, numbers, labels or writing anywhere in the image.

STYLE RULES:
- Flat vector illustration with clean simple linework
- Soft pastel colors: deep indigo blue (#4464AD), warm yellows, soft violets and creams
- Rounded simplified shapes — everything has smooth, friendly curves
- Children's 2D animated TV show aesthetic — think simple, clear, warm
- Remove ALL photographic realism: no realistic lighting, no complex textures, no photographic shadows
- Keep the overall composition and recognizable elements but redraw as 2D flat cartoon

OUTPUT: A 16:9 horizontal image in the Muns 2D animation style.`;

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

  return router;
}
