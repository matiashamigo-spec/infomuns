// Pipeline diario: busca noticias → genera historia Muns → ilustra imagen → guarda como borrador en WP

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { fetchAllFeeds, findTopStories } from "./rss.js";
import { illustrateImage, generateIllustrationFromText, generateSingleIllustration } from "./illustration.js";
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
  visual_anchor: string;
  story_type: string;
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
- visual_anchor: la imagen más concreta y física de esta noticia — un objeto, un gesto, un lugar específico, una acción que ocurrió. NO una emoción, NO un concepto, NO una atmósfera. Algo que se puede VER o TOCAR. Ej: "una tiza dibujando una línea en una pizarra de jardín", "un bote de goma con 40 personas aferradas a los costados", "una pila de papeles sin firmar en una mesa vacía". Una frase corta.
- story_type: qué tipo de situación narrativa es esta — en UNA o DOS palabras que describan la estructura de la historia, no el tema. Ej: "espera larga", "acuerdo difícil", "pérdida irreversible", "descubrimiento tardío", "gesto pequeño enorme", "alguien eligió el daño", "algo que nadie vio venir", "el que estaba solo encontró ayuda".
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
          visual_anchor: { type: Type.STRING },
          story_type: { type: Type.STRING },
          human_choice: { type: Type.STRING },
          core_emotion: { type: Type.STRING },
          has_resolution: { type: Type.BOOLEAN },
          hopeful_actor: { type: Type.STRING },
        },
        required: ["what", "heart", "visual_anchor", "story_type", "human_choice", "core_emotion", "has_resolution", "hopeful_actor"],
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

async function generateMunsStory(newsText: string, apiKey: string): Promise<{ title: string; story: string; excerpt: string; analysis: NewsAnalysis }> {
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

  const contents = `NOTICIA ORIGINAL (leé todo — los detalles concretos, objetos, lugares y nombres están acá):
---
${newsText.substring(0, 5000)}
---

ANÁLISIS (usalo como guía, no como reemplazo del texto original):
TIPO DE SITUACIÓN: ${analysis.story_type}
IMAGEN CONCRETA DE ESTA HISTORIA: ${analysis.visual_anchor}
LO QUE PASÓ: ${analysis.what}
EL CORAZÓN (OBLIGATORIO — si no está, el cuento no tiene razón de ser): ${analysis.heart}
EMOCIÓN CENTRAL: ${analysis.core_emotion}
${choiceContext}
${hopefulContext}
${endingContext}

ANTES DE ESCRIBIR — hacé este ejercicio mental (no lo incluyas en el output):
1. Esta es una historia de "${analysis.story_type}". ¿Qué ritmo, qué forma, qué estructura le corresponde a ESE tipo de situación?
2. La imagen concreta es "${analysis.visual_anchor}". El cuento nace de ahí — esa imagen es la puerta de entrada.
3. ¿Qué tiene ESTA situación específica que no tiene ninguna otra en el mundo? Ese detalle único va en el centro.
4. ¿Qué no vas a hacer? (el recurso fácil, el clima genérico, la metáfora que funcionaría para cualquier cuento)

AHORA escribí el cuento. La forma surge del contenido — una historia de espera tiene otro ritmo que una de pérdida, que otra de descubrimiento. Dejá que ESTA situación te diga cómo contarla.

Elegí uno de los ARQUETIPOS DE RESOLUCIÓN (A–H). Indicá en "resolution" la letra y nombre. Indicá en "symbol" el símbolo principal del cuento. Indicá en "setting" el escenario principal (ej: "tierra - Barcelona", "un puente sobre un río", "la vereda de una escuela").
En "opening_type" describí en 5-8 palabras cómo arranca el cuento (ej: "detalle concreto del lugar", "personaje en acción", "desde la luna con algo inusual").
En "closing_image" describí en 5-10 palabras la imagen o acción concreta del cierre (ej: "dejan una sonrisa en el piso y se van", "un Mun mira hacia atrás una vez", "se quedan mirando la ventana iluminada").
En "key_metaphor" describí en 5-10 palabras la imagen o traducción principal que usaste para explicar el concepto adulto central de esta noticia en lenguaje de nene (ej: "ruidos grandes para los ataques militares", "pantalla flotante para las noticias digitales", "el agua que no para para la inundación"). Esto sirve para NO repetirlo en futuros cuentos.

En "excerpt" escribí una bajada corta (máximo 85 caracteres, contando espacios — es un límite duro, no lo excedas) que invite a leer el cuento, en español normal (mayúscula solo al principio y en nombres propios — NO todo en mayúscula, a diferencia de "story"). Se muestra en una tarjeta chica que corta el texto a 3 líneas (~33 caracteres por línea): si te pasás del límite, se corta a la mitad de una palabra y queda feo.${recentPatterns}`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
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
          excerpt: { type: Type.STRING },
          symbol: { type: Type.STRING },
          resolution: { type: Type.STRING },
          setting: { type: Type.STRING },
          opening_type: { type: Type.STRING },
          closing_image: { type: Type.STRING },
          key_metaphor: { type: Type.STRING },
        },
        required: ["title", "story", "excerpt", "symbol", "resolution", "setting", "opening_type", "closing_image", "key_metaphor"],
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
    key_metaphor: result.key_metaphor || "",
  });

  return { ...result, analysis };
}

// Genera el bloque de contexto para adultos que acompaña al cuento:
// "Esta historia está inspirada en..." + "Este cuento busca abrir una conversación sobre..."
// El cierre fijo "Que las noticias dejen de ser solo cosa de grandes ✨" se agrega aparte, sin IA.
async function generateContextParagraphs(newsText: string, analysis: NewsAnalysis, apiKey: string): Promise<{ inspired: string; conversation: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Escribí el contexto para adultos de una nota que acompaña un cuento infantil inspirado en esta noticia real.

NOTICIA: "${newsText.substring(0, 3000)}"
LO QUE PASÓ: ${analysis.what}
EMOCIÓN CENTRAL: ${analysis.core_emotion}

Necesito dos párrafos cortos, en español neutro, tono cálido y editorial (no periodístico):
1. "inspired": arranca EXACTAMENTE con "Esta historia está inspirada en" y resume en 1-2 oraciones lo que pasó en la noticia real, con los datos concretos (lugar, qué ocurrió), sin opinar.
2. "conversation": en 1 oración, con arranque LIBRE Y VARIADO (no repitas la misma fórmula de nota a nota, como "Este cuento busca..."), describe el tema humano/emocional de fondo que el cuento invita a charlar con los chicos.`,
    config: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          inspired: { type: Type.STRING },
          conversation: { type: Type.STRING },
        },
        required: ["inspired", "conversation"],
      },
    },
  });
  const text = response.text;
  if (!text) throw new Error("Gemini no devolvió el contexto");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = start !== -1 && end > start ? text.substring(start, end + 1) : text;
  return JSON.parse(json);
}

// Arma el bloque HTML de contexto: si hay contexto manual lo respeta tal cual (comportamiento legacy),
// si no, lo genera automáticamente con el formato estándar del sitio.
// NOTA: cada línea usa <p class="muns-context-line"> SUELTO (sin div contenedor).
// Un <div> anidado con <p> adentro no sobrevive el editor clásico de WordPress (TinyMCE le come
// las etiquetas internas al guardar). Usamos un shortcode ([muns_context]a|||b|||c[/muns_context])
// en vez de HTML con clases: un shortcode es texto plano, TinyMCE no lo puede "romper" al re-serializar
// el DOM al guardar — el recuadro se arma server-side cuando WordPress renderiza el shortcode.
async function buildContextBlock(newsText: string, analysis: NewsAnalysis, apiKey: string, manualContext?: string): Promise<{ html: string; text: string }> {
  const closing = "Que las noticias dejen de ser solo cosa de grandes ✨";
  if (manualContext?.trim()) {
    const text = manualContext.trim();
    return { html: `\n[muns_context]${text}[/muns_context]`, text };
  }
  try {
    const { inspired, conversation } = await generateContextParagraphs(newsText, analysis, apiKey);
    const html = `\n[muns_context]${inspired}|||${conversation}|||${closing}[/muns_context]`;
    const text = `${inspired}\n\n${conversation}\n\n${closing}`;
    return { html, text };
  } catch (e: any) {
    console.warn("[pipeline] No se pudo generar el contexto automático:", e.message);
    return { html: "", text: "" };
  }
}

// Descarga la imagen original de la noticia y la sube a WordPress como foto principal
async function uploadSourceImageAsFeatured(imageUrl: string, title: string): Promise<number | undefined> {
  try {
    const res = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const mime = (res.headers["content-type"] || "image/jpeg").split(";")[0];
    const b64 = Buffer.from(res.data).toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const slug = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const media = await uploadMedia(dataUrl, `source-${slug}.${ext}`);
    return media?.id;
  } catch (e: any) {
    console.warn(`[pipeline] No se pudo subir la imagen de la fuente (${imageUrl}):`, e.message);
    return undefined;
  }
}

export interface PipelineResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export interface GeneratedStory {
  title: string;
  content: string;
  context: string;
  excerpt: string;
  imageUrl: string | null;
  siteName: string;
  sourceUrl: string;
}

// Scrapea la URL y genera el cuento Muns, SIN publicar nada en WordPress.
// Usado tanto por processSingleUrl (que sí publica) como por el endpoint
// /generate-from-url (que solo devuelve el resultado para revisión manual).
export async function generateStoryFromUrl(url: string, apiKey: string, context?: string): Promise<GeneratedStory> {
  console.log(`[pipeline] Generando cuento desde URL: ${url}`);

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
  const { title, story, excerpt, analysis } = await generateMunsStory(newsText, apiKey);

  // 3. Generar (o respetar el manual) el bloque de contexto para adultos
  const contextBlock = await buildContextBlock(newsText, analysis, apiKey, context);

  const cleanStory = story.toUpperCase().replace(/«/g, '"').replace(/»/g, '"');
  const content = `<p>${cleanStory.replace(/\n/g, "</p><p>")}</p>
<p><small>Fuente original (<a href="${url}" target="_blank" rel="noopener">${siteName}</a>): ${url}</small></p>${contextBlock.html}`;

  return { title, content, context: contextBlock.text, excerpt, imageUrl, siteName, sourceUrl: url };
}

export async function processSingleUrl(url: string, apiKey: string, context?: string): Promise<{ id: number; title: string }> {
  const generated = await generateStoryFromUrl(url, apiKey, context);

  // Subir la imagen de la fuente como foto principal (reemplaza la ilustración IA, desactivada por costos)
  let mediaId: number | undefined;
  if (generated.imageUrl) {
    mediaId = await uploadSourceImageAsFeatured(generated.imageUrl, generated.title);
  }

  const draft = await createDraft(generated.title, generated.content, mediaId);
  console.log(`[pipeline] ✓ Borrador manual creado: "${generated.title}"`);
  return { id: (draft as any).id, title: generated.title };
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
      const { title, story, analysis } = await generateMunsStory(newsText, apiKey);

      // 2. Subir la imagen de la fuente como foto principal (reemplaza la ilustración IA, desactivada por costos)
      let mediaId: number | undefined;
      if (article.imageUrl) {
        mediaId = await uploadSourceImageAsFeatured(article.imageUrl, title);
      }

      // 3. Generar el bloque de contexto para adultos
      const contextBlock = await buildContextBlock(newsText, analysis, apiKey);

      // 4. Crear borrador en WordPress
      const cleanStory = story
        .toUpperCase()
        .replace(/«/g, '"')
        .replace(/»/g, '"');
      const content = `<p>${cleanStory.replace(/\n/g, "</p><p>")}</p>
<p><small>Fuente original (<a href="${article.link}" target="_blank" rel="noopener">${article.source}</a>): ${article.link}</small></p>${contextBlock.html}`;

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
