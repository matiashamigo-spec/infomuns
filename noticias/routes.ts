// Rutas Express para Noticias Muns
// Todas protegidas con NOTICIAS_ADMIN_SECRET via header Authorization: Bearer <secret>

import { Router, Request, Response } from "express";
import { runDailyPipeline } from "./pipeline.js";
import { listDrafts, updatePost, publishPostById, deletePost } from "./wordpress.js";

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
  router.post("/run", requireAdmin, async (req: Request, res: Response) => {
    try {
      console.log("[noticias] Pipeline iniciado manualmente");
      const result = await runDailyPipeline();
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

  return router;
}
