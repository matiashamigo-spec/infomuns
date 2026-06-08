// Cliente para los endpoints propios de Noticias Muns en WordPress
// Usa X-Noticias-Key en vez de Application Passwords (evita bloqueo de Wordfence)

import axios from "axios";

function getWpConfig() {
  const url = process.env.WP_URL || "https://muns.club";
  const key = process.env.WP_NOTICIAS_KEY || "";
  return { url, key };
}

const BASE = (url: string) => `${url}/wp-json/noticias-muns/v1`;

export interface WpPost {
  id: number;
  title: string;
  content: string;
  status: "draft" | "publish" | "trash";
  featuredMediaId?: number;
  featuredMediaUrl?: string;
  link: string;
  date: string;
}

// Sube imagen (base64 dataURL) a la biblioteca de medios vía endpoint propio
export interface UploadedMedia { id: number; url: string }

export async function uploadMedia(imageDataUrl: string, filename: string): Promise<UploadedMedia | null> {
  const { url, key } = getWpConfig();
  try {
    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const [, mime, b64] = match;

    const res = await axios.post(
      `${BASE(url)}/media`,
      { data: b64, mime, name: filename },
      { headers: { "X-Noticias-Key": key }, timeout: 30000 }
    );
    const id = res.data.id ?? null;
    const mediaUrl = res.data.url ?? res.data.source_url ?? null;
    if (!id) return null;
    return { id, url: mediaUrl };
  } catch (err: any) {
    console.warn("[wp] Error subiendo media:", err.message);
    return null;
  }
}

// Crea un post como borrador
export async function createDraft(
  title: string,
  content: string,
  featuredMediaId?: number
): Promise<WpPost> {
  const { url, key } = getWpConfig();
  const res = await axios.post(
    `${BASE(url)}/drafts`,
    { title, content, featured_media: featuredMediaId },
    { headers: { "X-Noticias-Key": key } }
  );
  return res.data;
}

// Lista todos los borradores de Noticias Muns
export async function listDrafts(): Promise<WpPost[]> {
  const { url, key } = getWpConfig();
  const res = await axios.get(`${BASE(url)}/drafts`, {
    headers: { "X-Noticias-Key": key },
  });
  return res.data || [];
}

// Actualiza título, contenido y/o imagen destacada de un post
export async function updatePost(id: number, data: { title?: string; content?: string; featuredMediaId?: number }): Promise<WpPost> {
  const { url, key } = getWpConfig();
  const body: Record<string, any> = {};
  if (data.title !== undefined) body.title = data.title;
  if (data.content !== undefined) body.content = data.content;
  if (data.featuredMediaId !== undefined) body.featured_media = data.featuredMediaId;
  const res = await axios.put(`${BASE(url)}/drafts/${id}`, body, {
    headers: { "X-Noticias-Key": key },
  });
  return res.data;
}

// Publica un borrador
export async function publishPostById(id: number): Promise<WpPost> {
  const { url, key } = getWpConfig();
  const res = await axios.put(
    `${BASE(url)}/drafts/${id}`,
    { status: "publish" },
    { headers: { "X-Noticias-Key": key } }
  );
  return res.data;
}

// Lista los posts publicados de Noticias Muns
export async function listPublished(): Promise<WpPost[]> {
  const { url, key } = getWpConfig();
  const res = await axios.get(`${BASE(url)}/published`, {
    headers: { "X-Noticias-Key": key },
  });
  return res.data || [];
}

// Despublica un post (lo vuelve a borrador)
export async function unpublishPost(id: number): Promise<WpPost> {
  const { url, key } = getWpConfig();
  const res = await axios.put(
    `${BASE(url)}/drafts/${id}`,
    { status: "draft" },
    { headers: { "X-Noticias-Key": key } }
  );
  return res.data;
}

// Marca un post como "noticia destacada" (hero en /infomuns)
export async function setFeaturedPost(id: number): Promise<void> {
  const { url, key } = getWpConfig();
  await axios.post(`${BASE(url)}/featured`, { id }, { headers: { "X-Noticias-Key": key } });
}

// Lista imágenes de la biblioteca de medios
export interface WpMedia { id: number; thumb: string; url: string; title: string }

export async function listMedia(page = 1): Promise<WpMedia[]> {
  const { url, key } = getWpConfig();
  const res = await axios.get(`${BASE(url)}/media-list?page=${page}`, {
    headers: { "X-Noticias-Key": key },
    timeout: 10000,
  });
  return res.data || [];
}

// Elimina un post permanentemente
export async function deletePost(id: number): Promise<void> {
  const { url, key } = getWpConfig();
  await axios.delete(`${BASE(url)}/drafts/${id}`, {
    headers: { "X-Noticias-Key": key },
  });
}
