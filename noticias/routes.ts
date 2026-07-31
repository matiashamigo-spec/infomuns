// Rutas Express para Noticias Muns
// Todas protegidas con NOTICIAS_ADMIN_SECRET via header Authorization: Bearer <secret>

import { Router, Request, Response } from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { runDailyPipeline, processSingleUrl, generateStoryFromUrl, refineStory } from "./pipeline.js";
import { illustrateImage, generateIllustrationSet, generateSingleIllustration } from "./illustration.js";
import { listDrafts, listPublished, updatePost, publishPostById, unpublishPost, deletePost, uploadMedia, setFeaturedPost, createDraft, listMedia } from "./wordpress.js";

// Valida que la URL sea pública (bloquea SSRF hacia IPs privadas/metadata)
function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
    // Bloquear rangos privados y metadata cloud
    if (/^10\./.test(h)) return false;
    if (/^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === "169.254.169.254") return false; // AWS/Railway metadata
    if (h.endsWith(".internal") || h.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

// Rate limiter simple en memoria para endpoints costosos
const rateLimits = new Map<string, number>();
function rateLimit(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = rateLimits.get(key) || 0;
  if (now - last < windowMs) return false;
  rateLimits.set(key, now);
  return true;
}

export function createNoticiasRouter(): Router {
  const router = Router();

  function safeError(err: any): string {
    const msg: string = err?.message || "Error interno";
    // No filtrar detalles de credenciales o rutas internas
    if (/password|secret|key|token|credential/i.test(msg)) return "Error interno";
    return msg.substring(0, 200);
  }

  // Middleware de autenticación
  function requireAdmin(req: Request, res: Response, next: any) {
    const secret = process.env.NOTICIAS_ADMIN_SECRET;
    if (!secret) return res.status(500).json({ error: "NOTICIAS_ADMIN_SECRET no configurada" });
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== secret) return res.status(401).json({ error: "No autorizado" });
    next();
  }

  // GET /api/noticias/featured — devuelve la noticia destacada (público, sin auth)
  router.get("/featured", async (req: Request, res: Response) => {
    try {
      const posts = await listPublished();
      const featured = posts.find((p: any) => p.isFeatured) || posts[0] || null;
      res.json(featured);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/from-url — procesa una URL manual y crea un borrador
  router.post("/from-url", requireAdmin, async (req: Request, res: Response) => {
    const { url, context } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Se requiere una URL válida" });
    if (!isSafeUrl(url)) return res.status(400).json({ error: "URL no permitida" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
      console.log(`[noticias] Procesando URL manual: ${url}`);
      const draft = await processSingleUrl(url, apiKey, context);
      res.json({ ok: true, draft });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/generate-from-url — genera título/contenido desde una URL SIN publicar
  // (usado por el editor de info.muns.club para revisar antes de guardar)
  router.post("/generate-from-url", requireAdmin, async (req: Request, res: Response) => {
    const { url, context } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Se requiere una URL válida" });
    if (!isSafeUrl(url)) return res.status(400).json({ error: "URL no permitida" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
      console.log(`[noticias] Generando (sin publicar) desde URL: ${url}`);
      const generated = await generateStoryFromUrl(url, apiKey, context);
      res.json({ ok: true, ...generated });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/refine — ajusta un cuento YA GENERADO según un pedido puntual (chat de retoque
  // del metabox "Generar con IA"), sin volver a correr todo el pipeline. Solo dentro de la misma sesión
  // de generación (el cliente manda el "story" plano que ya tiene en memoria, no busca nada guardado).
  router.post("/refine", requireAdmin, async (req: Request, res: Response) => {
    const { title, story, instruction } = req.body || {};
    if (!story || typeof story !== "string") return res.status(400).json({ error: "Falta story" });
    if (!instruction || typeof instruction !== "string") return res.status(400).json({ error: "Falta instruction" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });
      console.log(`[noticias] Refinando cuento: "${instruction}"`);
      const result = await refineStory(title || "", story, instruction, apiKey);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/from-manual — crea borrador desde cuento + URL de imagen
  router.post("/from-manual", requireAdmin, async (req: Request, res: Response) => {
    const { title, content, imageUrl } = req.body;
    if (!title || !content || !imageUrl) return res.status(400).json({ error: "Se requieren título, cuento y URL de imagen" });
    if (!isSafeUrl(imageUrl)) return res.status(400).json({ error: "URL de imagen no permitida" });
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

      console.log(`[noticias] Creando borrador manual: "${title}"`);
      const illustrated = await illustrateImage(imageUrl, apiKey);
      let mediaId: number | undefined;
      if (illustrated) {
        const slug = "img-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 36);
        const media = await uploadMedia(illustrated, slug);
        if (media) mediaId = media.id;
      }

      const draft = await createDraft(title, content, mediaId);
      res.json({ ok: true, draft });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/run — ejecuta el pipeline manualmente
  // Acepta body { limit: number } para limitar cantidad (útil para pruebas)
  router.post("/run", requireAdmin, async (req: Request, res: Response) => {
    if (!rateLimit("pipeline", 5 * 60 * 1000)) {
      return res.status(429).json({ error: "El pipeline ya se ejecutó recientemente. Esperá 5 minutos." });
    }
    try {
      const limit = parseInt(req.body?.limit) || 10;
      console.log(`[noticias] Pipeline iniciado manualmente (limit=${limit})`);
      const result = await runDailyPipeline(limit);
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // GET /api/noticias/drafts — lista borradores
  router.get("/drafts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const drafts = await listDrafts();
      res.json(drafts);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // PUT /api/noticias/drafts/:id — edita título y/o contenido
  router.put("/drafts/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const { title, content } = req.body;
    try {
      const updated = await updatePost(id, { title, content });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/drafts/:id/publish — publica
  router.post("/drafts/:id/publish", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      const published = await publishPostById(id);
      res.json(published);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/drafts/:id/regenerate-image — genera 1 imagen nueva desde el cuento
  router.post("/drafts/:id/regenerate-image", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const { title, content } = req.body;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

      if (!title || !content) return res.status(400).json({ error: "Se requieren title y content del post" });

      console.log(`[noticias] Generando nueva imagen desde cuento para post ${id}`);
      const image = await generateSingleIllustration(title, content, apiKey);
      if (!image) return res.status(500).json({ error: "Gemini no generó imagen" });

      const slug = "img-" + (title || `post-${id}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 36) + `-regen`;
      const media = await uploadMedia(image, slug);
      if (!media) return res.status(500).json({ error: "No se pudo subir la imagen a WordPress" });

      await updatePost(id, { featuredMediaId: media.id });
      res.json({ ok: true, mediaId: media.id, mediaUrl: media.url });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/drafts/:id/set-image — asigna imagen de la biblioteca
  router.post("/drafts/:id/set-image", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const { mediaId, mediaUrl } = req.body;
    if (!mediaId) return res.status(400).json({ error: "Se requiere mediaId" });
    try {
      await updatePost(id, { featuredMediaId: mediaId });
      res.json({ ok: true, mediaUrl });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // DELETE /api/noticias/drafts/:id — borra permanentemente
  router.delete("/drafts/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      await deletePost(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // GET /api/noticias/published — lista publicadas
  router.get("/published", requireAdmin, async (req: Request, res: Response) => {
    try {
      const posts = await listPublished();
      res.json(posts);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // PUT /api/noticias/published/:id — edita título y/o contenido de publicada
  router.put("/published/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const { title, content } = req.body;
    try {
      const updated = await updatePost(id, { title, content });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/published/:id/unpublish — vuelve a borrador
  router.post("/published/:id/unpublish", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      const post = await unpublishPost(id);
      res.json(post);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/published/:id/feature — marca como noticia destacada
  router.post("/published/:id/feature", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      await setFeaturedPost(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/published/:id/set-image — asigna imagen de la biblioteca
  router.post("/published/:id/set-image", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const { mediaId, mediaUrl } = req.body;
    if (!mediaId) return res.status(400).json({ error: "Se requiere mediaId" });
    try {
      await updatePost(id, { featuredMediaId: mediaId });
      res.json({ ok: true, mediaUrl });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // GET /api/noticias/media — lista imágenes de la biblioteca de WP
  router.get("/media", requireAdmin, async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    try {
      const items = await listMedia(page);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // DELETE /api/noticias/published/:id — borra permanentemente
  router.delete("/published/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      await deletePost(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // POST /api/noticias/foto-muns-style — convierte una foto a estilo Muns (2D animación) y la sube a la biblioteca de WP
  // Body: { imageBase64: string, imageMime: string, postId?: number }
  // Devuelve: { ok, mediaId, mediaUrl }
  router.post("/foto-muns-style", requireAdmin, async (req: Request, res: Response) => {
    const { imageBase64, imageMime, postId } = req.body;
    if (!imageBase64 || typeof imageBase64 !== "string") return res.status(400).json({ error: "imageBase64 requerido" });
    if (!imageMime || typeof imageMime !== "string") return res.status(400).json({ error: "imageMime requerido" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY no configurada" });

    const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
    const GEMINI_MODEL = "gemini-3.1-flash-image";

    const MUNS_STYLE_PROMPT = `Transform this photo into the Muns 2D animation art style. The result must look exactly like a frame from the Muns animated series.

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
          contents: [{
            parts: [
              { inlineData: { data: imageBase64, mimeType: imageMime } },
              { text: MUNS_STYLE_PROMPT },
            ],
          }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        },
        { timeout: 90000 }
      );

      let resultData: string | null = null;
      let resultMime = "image/png";
      for (const c of geminiRes.data?.candidates || []) {
        for (const p of c.content?.parts || []) {
          if (p.inlineData?.data) {
            resultData = p.inlineData.data;
            resultMime = p.inlineData.mimeType || "image/png";
            break;
          }
        }
        if (resultData) break;
      }

      if (!resultData) {
        const reason = geminiRes.data?.candidates?.[0]?.finishReason;
        throw new Error("Gemini no generó imagen" + (reason ? ` (${reason})` : "") + ". Probá con otra foto.");
      }

      // Calcular costo aproximado (gemini-3.1-flash-image, pricing similar a 2.5-flash)
      const usage = geminiRes.data?.usageMetadata;
      const inputTokens: number = usage?.promptTokenCount ?? 0;
      const outputTokens: number = usage?.candidatesTokenCount ?? 0;
      const INPUT_PER_M = 0.15;
      const OUTPUT_PER_M = 1.25;
      const costUsd = (inputTokens / 1_000_000) * INPUT_PER_M + (outputTokens / 1_000_000) * OUTPUT_PER_M;
      console.log(`[foto-muns-style] tokens: in=${inputTokens} out=${outputTokens} ~$${costUsd.toFixed(4)}`);

      // Devolver el base64 al cliente — el cliente sube a su propio WordPress via AJAX
      // (evita cross-site: WP_URL apunta a muns.club, pero el editor trabaja en info.muns.club)
      res.json({ ok: true, imageBase64: resultData, imageMime: resultMime, cost: { inputTokens, outputTokens, usd: costUsd } });
    } catch (err: any) {
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
      console.error("[foto-muns-style] error:", detail);
      res.status(500).json({ error: safeError(err), detail });
    }
  });

  return router;
}
