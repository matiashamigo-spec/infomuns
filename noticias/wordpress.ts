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
export async function uploadMedia(imageDataUrl: string, filename: string): Promise<number | null> {
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
    return res.data.id ?? null;
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

// Actualiza título y/o contenido de un post
export async function updatePost(id: number, data: { title?: string; content?: string }): Promise<WpPost> {
  const { url, key } = getWpConfig();
  const res = await axios.put(`${BASE(url)}/drafts/${id}`, data, {
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

// Elimina un post permanentemente
export async function deletePost(id: number): Promise<void> {
  const { url, key } = getWpConfig();
  await axios.delete(`${BASE(url)}/drafts/${id}`, {
    headers: { "X-Noticias-Key": key },
  });
}
