// Pipeline diario: busca noticias → genera historia Muns → ilustra imagen → guarda como borrador en WP

import { GoogleGenAI, Type } from "@google/genai";
import { fetchAllFeeds, findTopStories } from "./rss.js";
import { illustrateImage, generateIllustrationFromText, NewsTone } from "./illustration.js";
import { createDraft, uploadMedia } from "./wordpress.js";
import { MUNS_SYSTEM_INSTRUCTION } from "../constants.js";

export async function classifyTone(newsText: string, apiKey: string): Promise<NewsTone> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Classify the emotional tone of this news in ONE word: "positive", "concerning", or "negative".
News: "${newsText.substring(0, 400)}"
Reply with only one of these three words, nothing else.`,
    });
    const raw = (response.text || "").trim().toLowerCase();
    if (raw.includes("negative")) return "negative";
    if (raw.includes("concern")) return "concerning";
    return "positive";
  } catch {
    return "positive";
  }
}

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

export async function runDailyPipeline(limit = 10): Promise<PipelineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  console.log(`[pipeline] Iniciando pipeline (limit=${limit})...`);

  const articles = await fetchAllFeeds();
  console.log(`[pipeline] ${articles.length} artículos obtenidos de los feeds`);

  const topStories = findTopStories(articles, limit);
  console.log(`[pipeline] ${topStories.length} noticias seleccionadas`);

  const result: PipelineResult = { total: topStories.length, succeeded: 0, failed: 0, errors: [] };

  for (const article of topStories) {
    try {
      console.log(`[pipeline] Procesando: "${article.title}"`);

      // 1. Generar historia Muns
      const newsText = `${article.title}\n\n${article.content}`;
      const { title, story } = await generateMunsStory(newsText, apiKey);

      // 2. Clasificar tono e ilustrar
      const tone = await classifyTone(`${article.title}\n${article.content}`, apiKey);
      console.log(`[pipeline] Tono detectado: ${tone}`);

      let mediaId: number | undefined;
      let illustrated: string | null = null;
      if (article.imageUrl) {
        console.log(`[pipeline] Ilustrando desde imagen original...`);
        illustrated = await illustrateImage(article.imageUrl, tone, apiKey);
      }
      if (!illustrated) {
        console.log(`[pipeline] Generando ilustración desde texto...`);
        illustrated = await generateIllustrationFromText(title, story, tone, apiKey);
      }
      if (illustrated) {
        const slug = "img-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 36);
        const media = await uploadMedia(illustrated, slug);
        mediaId = media?.id ?? undefined;
      }

      // 3. Crear borrador en WordPress
      const cleanStory = story
        .toUpperCase()
        .replace(/«/g, '"')
        .replace(/»/g, '"');
      const content = `<p>${cleanStory.replace(/\n/g, "</p><p>")}</p>
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
