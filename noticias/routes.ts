// Rutas Express para Noticias Muns
// Todas protegidas con NOTICIAS_ADMIN_SECRET via header Authorization: Bearer <secret>

import { Router, Request, Response } from "express";
import { runDailyPipeline } from "./pipeline.js";
import { listDrafts, listPublished, updatePost, publishPostById, unpublishPost, deletePost } from "./wordpress.js";

export function createNoticiasRouter(): Router {
  const router = Router();

  // Middleware de autenticación
  function requireAdmin(req: Request, res: Response, next: any) {
    const secret = process.env.NOTICIAS_ADMIN_SECRET;
    if (!secret) return res.status(500).json({ error: "NOTICIAS_ADMIN_SECRET no configurada" });
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== secret) return res.status(401).json({ error: "No autorizado" });
    next();
  }

  // POST /api/noticias/run — ejecuta el pipeline manualmente
  // Acepta body { limit: number } para limitar cantidad (útil para pruebas)
  router.post("/run", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.body?.limit) || 10;
      console.log(`[noticias] Pipeline iniciado manualmente (limit=${limit})`);
      const result = await runDailyPipeline(limit);
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/noticias/drafts — lista borradores
  router.get("/drafts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const drafts = await listDrafts();
      res.json(drafts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/noticias/drafts/:id/publish — publica
  router.post("/drafts/:id/publish", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      const published = await publishPostById(id);
      res.json(published);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/noticias/drafts/:id — borra permanentemente
  router.delete("/drafts/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      await deletePost(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/noticias/published — lista publicadas
  router.get("/published", requireAdmin, async (req: Request, res: Response) => {
    try {
      const posts = await listPublished();
      res.json(posts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/noticias/published/:id/unpublish — vuelve a borrador
  router.post("/published/:id/unpublish", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      const post = await unpublishPost(id);
      res.json(post);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/noticias/published/:id — borra permanentemente
  router.delete("/published/:id", requireAdmin, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    try {
      await deletePost(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
