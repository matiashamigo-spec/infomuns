// Pipeline diario: busca noticias → genera historia Muns → ilustra imagen → guarda como borrador en WP

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { fetchAllFeeds, findTopStories } from "./rss.js";
import { illustrateImage, generateIllustrationFromText, generateIllustrationSet } from "./illustration.js";
import { createDraft, uploadMedia } from "./wordpress.js";
import { MUNS_SYSTEM_INSTRUCTION } from "../constants.js";
import { getRecentPatternsPrompt, saveStoryToMemory } from "./story-memory.js";

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(process.cwd(), "data");
const PROCESSED_FILE = path.join(DATA_DIR, "processed-urls.json");

function loadProcessedUrls(): Set<string> {
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf-8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch {}
  return new Set();
}

function saveProcessedUrl(url: string, processed: Set<string>): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    processed.add(url);
    // Conservar solo las últimas 500 para que el archivo no crezca infinito
    const arr = Array.from(processed).slice(-500);
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(arr));
  } catch (e: any) {
    console.warn("[pipeline] No se pudo guardar processed-urls:", e.message);
  }
}

type NewsTone = "positive" | "concerning" | "negative";

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

interface NewsAnalysis {
  what: string;
  heart: string;
  human_choice: "daño" | "bien" | "ninguna" | "político";
  core_emotion: string;
  has_resolution: boolean;
  hopeful_actor: string;
}

async function analyzeNews(newsText: string, apiKey: string): Promise<NewsAnalysis> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Analizá esta noticia para preparar un cuento infantil. Respondé en JSON.

Noticia: "${newsText.substring(0, 4000)}"

Respondé:
- what: qué pasó en UNA oración simple (para un adulto que va a escribir un cuento para niños)
- heart: el dato más sorprendente, emotivo o humano de esta noticia — el que, si lo sacás, la historia pierde su razón de ser. Una oración. Ej: "El arquitecto murió atropellado como un indigente 100 años antes de que su obra se terminara." Si la noticia no tiene un dato así, describí la tensión emocional central.
- human_choice: ¿cuál es la naturaleza del hecho? "daño" solo si hay una acción claramente dañina y no debatible (violencia, abuso, crimen). "bien" solo si hay un gesto claramente positivo y no debatible (rescate, donación, cuidado). "político" si involucra gobiernos, partidos, políticas públicas, movimientos sociales o cualquier tema donde distintas personas pueden tener opiniones legítimas distintas. "ninguna" si fue natural, accidental o estructural sin actor claro.
- core_emotion: cuál es la emoción principal que un nene de 5 años sentiría al escuchar esto (una sola palabra: tristeza, bronca, miedo, alegría, orgullo, confusión, ternura, alivio)
- has_resolution: true si el hecho ya tiene un final definitivo, false si la situación sigue abierta
- hopeful_actor: si hay alguien que denunció, ayudó, cuidó o habló en esta noticia, describilo en una frase. Si no hay nadie así, dejalo vacío.`,
    config: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          what: { type: Type.STRING },
          heart: { type: Type.STRING },
          human_choice: { type: Type.STRING },
          core_emotion: { type: Type.STRING },
          has_resolution: { type: Type.BOOLEAN },
          hopeful_actor: { type: Type.STRING },
        },
        required: ["what", "heart", "human_choice", "core_emotion", "has_resolution", "hopeful_actor"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini no devolvió análisis");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = start !== -1 && end > start ? text.substring(start, end + 1) : text;
  return JSON.parse(json);
}

async function generateMunsStory(newsText: string, apiKey: string): Promise<{ title: string; story: string }> {
  const ai = new GoogleGenAI({ apiKey });

  // Paso 1: analizar la noticia
  const analysis = await analyzeNews(newsText, apiKey);
  console.log(`[pipeline] Análisis: ${JSON.stringify(analysis)}`);

  // Paso 2: construir contexto para el cuento
  const recentPatterns = getRecentPatternsPrompt();
  const choiceContext = analysis.human_choice === "daño"
    ? `IMPORTANTE: En esta noticia alguien eligió hacer daño. El cuento debe reflejar que existió esa elección — sin nombrar al culpable, pero sin borrarlo. "Alguien decidió" es distinto a "algo pasó solo".`
    : analysis.human_choice === "bien"
    ? `IMPORTANTE: En esta noticia alguien eligió hacer algo bueno (ayudar, cuidar, hablar). Ese gesto es el momento clave del cuento.`
    : analysis.human_choice === "político"
    ? `IMPORTANTE: Esta noticia involucra un tema político o social donde distintas personas pueden tener opiniones legítimas distintas. El cuento NO toma partido. Muestra lo que sienten los personajes, no quién tiene razón. Ningún bando es el malo ni el bueno.`
    : "";

  const hopefulContext = analysis.hopeful_actor
    ? `ACTOR ESPERANZADOR: ${analysis.hopeful_actor}. Incluirlo en el cuento como el gesto que vale.`
    : "";

  const endingContext = analysis.has_resolution
    ? `FINAL CERRADO: lo que pasó ya terminó. El cuento también debe tener final cerrado.`
    : `FINAL ABIERTO: la situación sigue sin resolverse. El cuento puede terminar con algo pendiente.`;

  const contents = `Lo que pasó: ${analysis.what}
EL CORAZÓN DE ESTA HISTORIA (OBLIGATORIO — no podés ignorar esto): ${analysis.heart}
Emoción central para un nene de 5 años: ${analysis.core_emotion}
${choiceContext}
${hopefulContext}
${endingContext}

Con este contexto, creá una historia en el universo Muns. El corazón de la historia debe estar presente en el cuento — es lo que hace que esta noticia valga la pena contarse.
Elegí uno de los ARQUETIPOS DE RESOLUCIÓN (A–H). Indicá en "resolution" la letra y nombre. Indicá en "symbol" el símbolo principal del cuento. Indicá en "setting" el escenario principal (ej: "tierra - Barcelona", "luna", "cohete lunar", "lado oscuro de la luna").
En "opening_type" describí en 5-8 palabras cómo arranca el cuento (ej: "detalle concreto del lugar", "personaje en acción", "desde la luna con algo inusual").
En "closing_image" describí en 5-10 palabras la imagen o acción concreta del cierre (ej: "suben al cohete en silencio", "dejan una sonrisa en el piso y se van", "Opaq mira hacia atrás una vez").${recentPatterns}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: MUNS_SYSTEM_INSTRUCTION,
      temperature: 1.0,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          story: { type: Type.STRING },
          symbol: { type: Type.STRING },
          resolution: { type: Type.STRING },
          setting: { type: Type.STRING },
          opening_type: { type: Type.STRING },
          closing_image: { type: Type.STRING },
        },
        required: ["title", "story", "symbol", "resolution", "setting", "opening_type", "closing_image"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini no devolvió texto");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = start !== -1 && end > start ? text.substring(start, end + 1) : text;
  const result = JSON.parse(json);

  saveStoryToMemory({
    title: result.title,
    symbol: result.symbol || "",
    resolution: result.resolution || "",
    setting: result.setting || "",
    opening_type: result.opening_type || "",
    closing_image: result.closing_image || "",
  });

  return result;
}

export interface PipelineResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export async function processSingleUrl(url: string, apiKey: string): Promise<{ id: number; title: string }> {
  console.log(`[pipeline] Procesando URL manual: ${url}`);

  // 1. Scrapear el artículo
  const page = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-AR,es;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
    },
  });
  const $ = cheerio.load(page.data);

  const rawTitle = $('meta[property="og:title"]').attr("content") || $("title").text() || "Sin título";
  const description = $('meta[property="og:description"]').attr("content") || "";
  const imageUrl = $('meta[property="og:image"]').attr("content")
    || $('meta[name="twitter:image"]').attr("content")
    || null;
  const siteName = $('meta[property="og:site_name"]').attr("content") || new URL(url).hostname;

  const bodyText = $("article p").map((_: number, el: cheerio.Element) => $(el).text()).get().join("\n")
    || $("p").map((_: number, el: cheerio.Element) => $(el).text()).get().slice(0, 10).join("\n")
    || description;

  // 2. Generar historia Muns
  const newsText = `${rawTitle}\n\n${bodyText || description}`;
  const { title, story } = await generateMunsStory(newsText, apiKey);

  // 3. Ilustrar 4 escenas desde el cuento
  let mediaId: number | undefined;
  console.log(`[pipeline] Ilustrando 4 escenas desde cuento...`);
  const scenes = await generateIllustrationSet(title, story, apiKey);
  const mediaIds: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const slug = "img-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 30) + `-${i + 1}`;
    const media = await uploadMedia(scenes[i], slug);
    if (media) mediaIds.push(media.id);
  }
  if (mediaIds.length > 0) mediaId = mediaIds[0];

  // 4. Crear borrador en WordPress
  const sourceImageComment = imageUrl ? `<!-- source-image: ${imageUrl} -->\n` : "";
  const extraMediaComment = mediaIds.length > 1 ? `<!-- scene-media-ids: ${mediaIds.join(",")} -->\n` : "";
  const cleanStory = story.toUpperCase().replace(/«/g, '"').replace(/»/g, '"');
  const content = `${sourceImageComment}${extraMediaComment}<p>${cleanStory.replace(/\n/g, "</p><p>")}</p>
<p><small>Fuente original (<a href="${url}" target="_blank" rel="noopener">${siteName}</a>): ${url}</small></p>`;

  const draft = await createDraft(title, content, mediaId);
  console.log(`[pipeline] ✓ Borrador manual creado: "${title}"`);
  return { id: (draft as any).id, title };
}

export async function runDailyPipeline(limit = 10): Promise<PipelineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  console.log(`[pipeline] Iniciando pipeline (limit=${limit})...`);

  const processedUrls = loadProcessedUrls();

  const articles = await fetchAllFeeds();
  console.log(`[pipeline] ${articles.length} artículos obtenidos de los feeds`);

  const allStories = findTopStories(articles, articles.length);
  const topStories = allStories
    .filter(a => !processedUrls.has(a.link))
    .slice(0, limit);

  console.log(`[pipeline] ${topStories.length} noticias nuevas (${allStories.length - topStories.length} ya procesadas)`);

  const result: PipelineResult = { total: topStories.length, succeeded: 0, failed: 0, errors: [] };

  for (const article of topStories) {
    try {
      console.log(`[pipeline] Procesando: "${article.title}"`);

      // 1. Generar historia Muns
      const newsText = `${article.title}\n\n${article.content}`;
      const { title, story } = await generateMunsStory(newsText, apiKey);

      // 2. Ilustrar 4 escenas desde el cuento
      let mediaId: number | undefined;
      console.log(`[pipeline] Ilustrando 4 escenas desde cuento...`);
      const scenes = await generateIllustrationSet(title, story, apiKey);
      const mediaIds: number[] = [];
      for (let i = 0; i < scenes.length; i++) {
        const slug = "img-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 30) + `-${i + 1}`;
        const media = await uploadMedia(scenes[i], slug);
        if (media) mediaIds.push(media.id);
      }
      if (mediaIds.length > 0) mediaId = mediaIds[0];

      // 3. Crear borrador en WordPress
      // Guardar URL de foto original como comentario oculto para poder regenerar imagen después
      const sourceImageComment = article.imageUrl
        ? `<!-- source-image: ${article.imageUrl} -->\n`
        : "";
      const extraMediaComment = mediaIds.length > 1 ? `<!-- scene-media-ids: ${mediaIds.join(",")} -->\n` : "";
      const cleanStory = story
        .toUpperCase()
        .replace(/«/g, '"')
        .replace(/»/g, '"');
      const content = `${sourceImageComment}${extraMediaComment}<p>${cleanStory.replace(/\n/g, "</p><p>")}</p>
<p><small>Fuente original (<a href="${article.link}" target="_blank" rel="noopener">${article.source}</a>): ${article.link}</small></p>`;

      await createDraft(title, content, mediaId);
      saveProcessedUrl(article.link, processedUrls);
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
