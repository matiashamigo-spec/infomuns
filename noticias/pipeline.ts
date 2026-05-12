// Pipeline diario: busca noticias → genera historia Muns → ilustra imagen → guarda como borrador en WP

import { GoogleGenAI, Type } from "@google/genai";
import { fetchAllFeeds, findTopStories } from "./rss.js";
import { illustrateImage } from "./illustration.js";
import { createDraft, uploadMedia } from "./wordpress.js";
import { MUNS_SYSTEM_INSTRUCTION } from "../constants.js";

async function generateMunsStory(newsText: string, apiKey: string): Promise<{ title: string; story: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Crea una historia simbólica para niños basada en esta noticia: "${newsText}".
REGLA DE ORO: Si hay una muerte o pérdida en la noticia, respeta la realidad del hecho. No digas que el personaje sigue ahí. Usa una metáfora de partida definitiva y honesta, pero con la suavidad de los Muns.
Sigue la estructura Pixar (Emoción, Grieta, Elección con costo, Consecuencia parcial).`,
    config: {
      systemInstruction: MUNS_SYSTEM_INSTRUCTION,
      temperature: 0.8,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          story: { type: Type.STRING },
        },
        required: ["title", "story"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini no devolvió texto");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = start !== -1 && end > start ? text.substring(start, end + 1) : text;
  return JSON.parse(json);
}

export interface PipelineResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function runDailyPipeline(): Promise<PipelineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  console.log("[pipeline] Iniciando pipeline diario...");

  const articles = await fetchAllFeeds();
  console.log(`[pipeline] ${articles.length} artículos obtenidos de los feeds`);

  const topStories = findTopStories(articles, 10);
  console.log(`[pipeline] ${topStories.length} noticias seleccionadas`);

  const result: PipelineResult = { total: topStories.length, succeeded: 0, failed: 0, errors: [] };

  for (const article of topStories) {
    try {
      console.log(`[pipeline] Procesando: "${article.title}"`);

      // 1. Generar historia Muns
      const newsText = `${article.title}\n\n${article.content}`;
      const { title, story } = await generateMunsStory(newsText, apiKey);

      // 2. Ilustrar imagen (si tiene)
      let mediaId: number | undefined;
      if (article.imageUrl) {
        console.log(`[pipeline] Ilustrando imagen...`);
        const illustrated = await illustrateImage(article.imageUrl, apiKey);
        if (illustrated) {
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 40);
          mediaId = await uploadMedia(illustrated, slug) ?? undefined;
        }
      }

      // 3. Crear borrador en WordPress
      const content = `<p>${story.toUpperCase().replace(/\n/g, "</p><p>")}</p>
<p><small>Fuente original (<a href="${article.link}" target="_blank" rel="noopener">${article.source}</a>): ${article.link}</small></p>`;

      await createDraft(title, content, mediaId);
      result.succeeded++;
      console.log(`[pipeline] ✓ Borrador creado: "${title}"`);

      // Pausa breve para no saturar la API
      await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      result.failed++;
      result.errors.push(`"${article.title}": ${err.message}`);
      console.error(`[pipeline] ✗ Error en "${article.title}":`, err.message);
    }
  }

  console.log(`[pipeline] Completado: ${result.succeeded} ok, ${result.failed} errores`);
  return result;
}
