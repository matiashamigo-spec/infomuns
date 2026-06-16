
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type } from "@google/genai";
import { MUNS_SYSTEM_INSTRUCTION } from "./constants";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import cron from "node-cron";
import { createNoticiasRouter } from "./noticias/routes.js";
import { runDailyPipeline } from "./noticias/pipeline.js";

const storyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Ya generaste 3 historias hoy. ¡Volvé mañana para más!" },
});

const munsmoodLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5, // 5 fotos por IP por hora (son 3 llamadas a Gemini cada una)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas fotos procesadas. Volvé en un rato." },
});

// Cache de imágenes de personajes (se cargan al arrancar desde env vars)
let munImageBase64: string | null = null;
let opaqImageBase64: string | null = null;

async function fetchCharacterImages() {
  const munUrl = process.env.MUN_IMAGE_URL;
  const opaqUrl = process.env.OPAQ_IMAGE_URL;
  if (munUrl) {
    try {
      const res = await axios.get(munUrl, { responseType: "arraybuffer" });
      munImageBase64 = Buffer.from(res.data).toString("base64");
      console.log("MUN image cached OK");
    } catch (e: any) {
      console.warn("Could not fetch MUN image:", e.message);
    }
  }
  if (opaqUrl) {
    try {
      const res = await axios.get(opaqUrl, { responseType: "arraybuffer" });
      opaqImageBase64 = Buffer.from(res.data).toString("base64");
      console.log("OPAQ image cached OK");
    } catch (e: any) {
      console.warn("Could not fetch OPAQ image:", e.message);
    }
  }
}

function getAspectRatio(w: number, h: number): string {
  if (!w || !h) return "1:1";
  const ratio = w / h;
  if (ratio > 1.5) return "16:9";
  if (ratio > 1.1) return "4:3";
  if (ratio < 0.6) return "9:16";
  if (ratio < 0.9) return "3:4";
  return "1:1";
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Railway está detrás de un proxy — necesario para que req.ip sea la IP real del cliente
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "20mb" }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  // CORS
  app.use((req, res, next) => {
    const allowed = [
      "https://muns.club",
      "https://www.muns.club",
      "https://munsmood.vercel.app",
    ];
    const origin = req.headers.origin || "";
    if (allowed.includes(origin) || process.env.NODE_ENV !== "production") {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // API key endpoints — used by embedded tools on muns.club
  const sendKey = (req: any, res: any) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: "Not configured" });
    res.json({ key, apiKey: key });
  };
  app.get("/api/key", sendKey);
  app.get("/api/", sendKey);
  app.get("/api/taller-init", sendKey);
  app.get("/api/munsmood-init", sendKey);
  app.get("/api/scanmuns-init", sendKey);
  app.get("/api/memomuns-init", sendKey);

  // Temporal: listar modelos disponibles
  app.get("/api/debug/models", async (req: any, res: any) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: "no key" });
    const r = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
    const image = (r.data.models || []).filter((m: any) =>
      (m.supportedGenerationMethods || []).includes("generateContent") &&
      (JSON.stringify(m).toLowerCase().includes("image") || JSON.stringify(m).toLowerCase().includes("vision"))
    );
    res.json({ all: (r.data.models || []).map((m: any) => m.name), image });
  });

  // API endpoint for fetching and scraping news
  app.get("/api/fetch-news", async (req, res) => {
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      console.log(`Scraping URL: ${url}`);
      const urlObj = new URL(url);
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
          "Referer": `${urlObj.protocol}//${urlObj.hostname}/`,
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });
      const html = response.data;
      const $ = cheerio.load(html);

      const headline = $("h1").first().text().trim() || $("title").text().trim();

      let content = "";
      const selectors = [
        ".article-body p",
        ".body-article p",
        "article p",
        '[class*="content"] p',
        '[class*="article"] p',
        ".story-content p"
      ];

      for (const selector of selectors) {
        const elements = $(selector);
        if (elements.length > 0) {
          elements.each((i, el) => {
            const text = $(el).text().trim();
            if (text.length > 0) content += text + "\n\n";
          });
          if (content.length > 200) break;
        }
      }

      if (content.length < 200) {
        content = "";
        $("p").each((i, el) => {
          const text = $(el).text().trim();
          if (text.length > 50) {
            content += text + "\n\n";
          }
        });
      }

      const imageUrl = $('meta[property="og:image"]').attr("content") || "";

      res.json({
        id: Math.random().toString(36).substr(2, 9),
        headline,
        content: content.substring(0, 10000),
        date: new Date().toLocaleDateString(),
        category: "Crónica Terrestre",
        imageUrl: imageUrl || "https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=2070&auto=format&fit=crop",
        url
      });
    } catch (error: any) {
      console.error("Error scraping news:", error.message);
      res.status(500).json({
        error: "Failed to fetch news content",
        details: error.message,
        url: url
      });
    }
  });

  // API endpoint for generating Mun story via Gemini
  app.post("/api/generate-story", storyLimiter, async (req, res) => {
    const { newsText } = req.body;
    if (!newsText) return res.status(400).json({ error: "newsText is required" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Crea una historia simbólica para niños basada en esta noticia: "${newsText}".
      REGLA DE ORO: Si hay una muerte o pérdida en la noticia, respeta la realidad del hecho. No digas que el personaje sigue ahí. Usa una metáfora de partida definitiva y honesta, pero con la suavidad de los Muns.
      Sigue la estructura Pixar (Emoción, Grieta, Elección con costo, Consecuencia parcial).
      PROHIBIDO usar "luz" como símbolo principal del cuento. Elegí otro símbolo (el bolso de sonrisas, el cohete, el viento, semillas, huellas, colores, objetos pequeños, etc.).`,
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
            required: ["title", "story"]
          }
        }
      });
      const text = response.text;
      if (!text) throw new Error("No response text");
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const json = (start !== -1 && end > start) ? text.substring(start, end + 1) : text;
      res.json(JSON.parse(json));
    } catch (error: any) {
      console.error("Error generating story:", error.message);
      res.status(500).json({ error: "Failed to generate story", details: error.message });
    }
  });

  // MunsMood: procesa foto completo (detectar emoción → componer imagen → validar)
  app.post("/api/munsmood/process", munsmoodLimiter, async (req, res) => {
    const { imageBase64, imageMime, width, height } = req.body;
    if (!imageBase64 || !imageMime) {
      return res.status(400).json({ error: "imageBase64 e imageMime son requeridos" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/";
    const DETECT_MODEL = "gemini-2.5-flash";
    const COMPOSE_MODEL = "gemini-2.5-flash-image";

    try {
      // Paso 1: Detectar emoción
      const detectBody = {
        contents: [{
          parts: [
            { inlineData: { data: imageBase64, mimeType: imageMime } },
            { text: "Analice la imagen con suma atención. Responda únicamente con una de estas categorías:\n- 'MULTIPLE_PEOPLE' si se observan dos o más personas.\n- 'HUG_TWO' si hay una sola persona con los brazos extendidos para un abrazo.\n- 'TONGUE_OUT' si hay una sola persona sacando la lengua.\n- 'SAD' si hay una sola persona con expresión negativa: tristeza, llanto, angustia, enojo, bronca, frustración, miedo o decepción.\n- 'HAPPY_NEUTRAL' en cualquier otro caso (feliz, neutral, sonriendo, pensativo, etc.)." }
          ]
        }],
        generationConfig: { responseMimeType: "text/plain" }
      };

      const detectRes = await axios.post(`${GEMINI}${DETECT_MODEL}:generateContent?key=${apiKey}`, detectBody);
      const rawEmotion = ((detectRes.data?.candidates?.[0]?.content?.parts || [])
        .map((p: any) => p.text || "").join("")).trim().toUpperCase();

      let emotion = "HAPPY_NEUTRAL";
      if (rawEmotion.includes("MULTIPLE_PEOPLE")) emotion = "MULTIPLE_PEOPLE";
      else if (rawEmotion.includes("HUG_TWO")) emotion = "HUG_TWO";
      else if (rawEmotion.includes("TONGUE_OUT")) emotion = "TONGUE_OUT";
      else if (rawEmotion.includes("SAD")) emotion = "SAD";

      console.log(`[MunsMood] emotion: ${emotion}`);

      // Paso 2: Componer imagen
      const EMOTION_ACTIONS: Record<string, { useMun: boolean; useOpaq: boolean }> = {
        HAPPY_NEUTRAL:   { useMun: true,  useOpaq: false },
        SAD:             { useMun: false, useOpaq: true  },
        HUG_TWO:         { useMun: true,  useOpaq: false },
        TONGUE_OUT:      { useMun: true,  useOpaq: true  },
        MULTIPLE_PEOPLE: { useMun: true,  useOpaq: true  }
      };

      const cfg = EMOTION_ACTIONS[emotion] || EMOTION_ACTIONS.HAPPY_NEUTRAL;
      const shouldHug = cfg.useMun && Math.random() < 0.3;

      let specificAction = "";
      if (emotion === "TONGUE_OUT") {
        specificAction = "La persona realiza un gesto ameno sacando la lengua. Mun y Opaq se posicionan de forma juguetona junto a ella; uno puede estar asomándose y el otro intentando subirse 'a cocochito' (piggyback) o apoyándose en su hombro de forma cariñosa.";
      } else if (emotion === "MULTIPLE_PEOPLE") {
        specificAction = "Se observa un grupo de personas. Mun se integra de forma natural asomándose entre la gente o apoyándose en el hombro de alguien. Opaq aparece del otro lado del grupo, también integrado naturalmente, abrazando o asomándose junto a otra persona. Ambos están presentes en la foto, uno a cada lado o entre las personas del grupo.";
      } else if (emotion === "HUG_TWO") {
        specificAction = "La persona ofrece un abrazo. Mun responde de forma activa: puede estar abrazando a la persona, apoyando su cabeza en su hombro o intentando trepar suavemente para un abrazo más cercano.";
      } else if (emotion === "SAD") {
        specificAction = "Se percibe tristeza. Opaq abraza a la persona con sus bracitos. El abrazo debe verse físico y real: Opaq rodea a la persona desde un costado o desde atrás, adaptando la posición de sus brazos a donde esté la persona en la foto. El rostro de la persona queda 100% visible. La cara de Opaq no cambia.";
      } else {
        specificAction = "Mun se ubica junto a la persona de forma muy natural, asomándose, apoyándose o incluso intentando subirse 'a cocochito' para salir en la foto de forma divertida.";
      }

      if (shouldHug) {
        specificAction += " De manera excepcional, Mun está abrazando a la persona. Es ABSOLUTAMENTE CRÍTICO que los brazos de Mun nazcan de su propio cuerpo. Los brazos deben rodear a la persona manteniendo ESTRICTAMENTE sus proporciones; NO deben estirarse. El abrazo debe ser tierno y el rostro de la persona debe ser 100% visible.";
      }

      const prompt =
        "REGLA #1 — LA MÁS IMPORTANTE DE TODAS: La cara de Mun y la cara de Opaq son INTOCABLES. Sus facciones, ojos, boca, expresión y forma de la cara son EXACTAMENTE iguales a las imágenes de referencia entregadas. No se modifican bajo ninguna circunstancia, sin importar la emoción de la foto ni la acción que realicen. La cara de Mun es siempre la cara de Mun. La cara de Opaq es siempre la cara de Opaq. Nunca cambian.\n\n" +
        "TAREA: Insertar un pequeño personaje animado dentro de esta fotografía real, como si estuviera físicamente presente en la escena junto a la persona.\n\n" +
        "EL PERSONAJE ES UNA CRIATURA PEQUEÑA E INDEPENDIENTE. No es un filtro ni una máscara. No se superpone sobre la persona. Aparece en la foto como un ser diminuto parado al lado, detrás, o sobre el hombro — NUNCA encima de la cara ni cubriendo ninguna parte de su cuerpo.\n\n" +
        "REGLA CRÍTICA — APLICA TANTO A MUN COMO A OPAQ: Las extremidades de Mun y de Opaq (brazos y piernas) NUNCA se alargan ni estiran. Su longitud es fija, exactamente igual a la imagen de referencia de cada uno. Si Mun o Opaq no llegan a tocar algo con sus brazos de tamaño natural, su cuerpo entero se acerca — jamás estiran los brazos. Un brazo estirado o alargado en cualquiera de los dos personajes es un error grave.\n\n" +
        "REGLAS OBLIGATORIAS:\n\n" +
        "1. NUNCA CUBRIR EL ROSTRO HUMANO: El personaje jamás puede aparecer sobre la cara de la persona. Si está cerca, debe estar desplazado al costado, por encima del hombro o detrás. El rostro humano debe quedar 100% visible y sin nada encima.\n\n" +
        "2. ESCALA PEQUEÑA: El personaje es SIEMPRE más pequeño que la persona. Su tamaño máximo equivale a la cabeza humana. Nunca puede ser igual ni más grande.\n\n" +
        "3. CARA DEL PERSONAJE INMUTABLE: La cara del personaje es EXACTAMENTE igual a la imagen de referencia. No cambia su expresión, no imita gestos humanos, no saca la lengua, no pone cara triste, no sonríe diferente. Solo su cuerpo (torso, brazos, piernas) se adapta a la escena.\n\n" +
        "4. LA FOTO ORIGINAL ES SAGRADA — PROHIBIDO INVENTAR CONTENIDO: Cada píxel de la fotografía original (personas, ropa, fondo, objetos, iluminación) debe quedar IDÉNTICO. Está terminantemente prohibido: agregar personas, modificar personas existentes, cambiar ropa, extender extremidades humanas, alterar el fondo, cambiar colores, o generar cualquier contenido nuevo que no sea el personaje animado. La foto no se recorta ni se reencuadra. Solo se añade el personaje animado.\n\n" +
        "5. CUERPO ÍNTEGRO Y CONECTADO: El personaje es un cuerpo único. Cada brazo nace del hombro y termina en una mano. Cada pierna nace de la cadera y termina en un pie. NINGUNA parte del cuerpo puede aparecer flotando, separada, ni superpuesta sobre otra parte del propio cuerpo. Una mano no puede aparecer por encima del torso ni del hombro. Si un brazo abraza, nace del hombro y rodea hacia afuera — nunca cruza por encima de la cabeza ni del propio cuerpo del personaje. Exactamente 2 brazos y 2 piernas, siempre.\n\n" +
        "ACCIÓN: " + specificAction + "\n\n" +
        "ADAPTACIÓN FÍSICA AL ENTORNO (CRÍTICO): El personaje SIEMPRE debe adaptarse a la posición y postura real de las personas en la foto. Si están sentadas, el personaje se apoya a la altura del hombro o sobre su regazo. Si están paradas, se ubica junto a sus pies, sube al hombro o se asoma a su lado. Si están agachadas o en el piso, el personaje está a su nivel. El personaje nunca flota en el aire ni aparece desconectado de la escena — siempre hay contacto físico o proximidad natural con alguna persona u objeto de la foto.\n\n" +
        "RESULTADO: La foto original sin ninguna modificación, con un pequeño personaje animado integrado naturalmente junto a la persona.";

      const composeParts: any[] = [
        { inlineData: { data: imageBase64, mimeType: imageMime } },
        { text: prompt }
      ];

      if (cfg.useMun && munImageBase64) {
        composeParts.push({ inlineData: { data: munImageBase64, mimeType: "image/png" } });
        composeParts.push({ text: "DISEÑO ORIGINAL DE MUN — su cara es EXACTAMENTE así en el resultado. Prohibido cambiar su expresión facial bajo ninguna circunstancia." });
      }
      if (cfg.useOpaq && opaqImageBase64) {
        composeParts.push({ inlineData: { data: opaqImageBase64, mimeType: "image/png" } });
        composeParts.push({ text: "DISEÑO ORIGINAL DE OPAQ — su cara es EXACTAMENTE así en el resultado. Prohibido cambiar su expresión facial bajo ninguna circunstancia." });
      }

      const composeBody = {
        contents: [{ parts: composeParts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
      };

      const MAX_ATTEMPTS = 3;
      let composedImage = '';

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Paso 2: Componer imagen
        const composeRes = await axios.post(`${GEMINI}${COMPOSE_MODEL}:generateContent?key=${apiKey}`, composeBody);
        const candidates = composeRes.data?.candidates || [];
        let imagePart: any = null;
        for (const c of candidates) {
          for (const p of (c.content?.parts || [])) {
            if (p.inlineData) { imagePart = p; break; }
          }
          if (imagePart) break;
        }

        if (!imagePart?.inlineData) {
          const reason = candidates[0]?.finishReason;
          if (attempt === MAX_ATTEMPTS) throw new Error("No se recibió imagen del modelo" + (reason ? ` (motivo: ${reason})` : "") + ". Intentá con otra foto.");
          console.log(`[MunsMood] intento ${attempt}: sin imagen, reintentando...`);
          continue;
        }

        const composedB64 = imagePart.inlineData.data;
        const composedMime = imagePart.inlineData.mimeType || "image/png";
        composedImage = `data:${composedMime};base64,${composedB64}`;

        // Paso 3: Validar resultado
        const validateParts: any[] = [
          { inlineData: { data: composedB64, mimeType: composedMime } }
        ];
        if (cfg.useMun && munImageBase64) {
          validateParts.push({ text: "DISEÑO DE REFERENCIA DE MUN:" });
          validateParts.push({ inlineData: { data: munImageBase64, mimeType: "image/png" } });
        }
        if (cfg.useOpaq && opaqImageBase64) {
          validateParts.push({ text: "DISEÑO DE REFERENCIA DE OPAQ:" });
          validateParts.push({ inlineData: { data: opaqImageBase64, mimeType: "image/png" } });
        }
        validateParts.push({ text: "El resultado tiene una foto real con uno o dos personajes animados pequeños insertados (Mun y/o Opaq). Analizá solo el/los personaje/s animado/s y respondé SOLO con SI o NO:\n1. ¿Algún personaje tiene más de 2 brazos o más de 2 piernas visibles?\n2. ¿Algún personaje cubre o se superpone sobre el rostro de alguna persona real?\n3. ¿Algún personaje es igual o más grande que la persona en la foto?\n4. ¿Algún personaje tiene partes del cuerpo flotando o desconectadas del torso?\n5. ¿El personaje en el resultado tiene diferencias visuales notables respecto a su diseño de referencia (colores distintos, accesorios añadidos, cara diferente)?\n\nRespondé exactamente así:\n1: SI o NO\n2: SI o NO\n3: SI o NO\n4: SI o NO\n5: SI o NO" });

        const validateBody = {
          contents: [{ parts: validateParts }],
          generationConfig: { temperature: 0, maxOutputTokens: 50 }
        };

        let validationFailed = false;
        try {
          const validateRes = await axios.post(`${GEMINI}${DETECT_MODEL}:generateContent?key=${apiKey}`, validateBody);
          const validateText = ((validateRes.data?.candidates?.[0]?.content?.parts || [])
            .map((p: any) => p.text || "").join("")).toUpperCase();
          console.log(`[MunsMood] intento ${attempt} validación: ${validateText}`);
          for (const line of validateText.split("\n")) {
            if (/^\d:/.test(line.trim()) && line.includes("SI")) {
              validationFailed = true;
              break;
            }
          }
        } catch (e: any) {
          console.warn(`[MunsMood] intento ${attempt} validación error (ignorado): ${e.message}`);
        }

        if (!validationFailed) break;
        if (attempt === MAX_ATTEMPTS) throw new Error("No pudimos lograr un resultado de calidad con tu foto. Intentá con otra 📸");
        console.log(`[MunsMood] intento ${attempt}: validación falló, reintentando composición...`);
      }

      res.json({ composedImage });

    } catch (error: any) {
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.error("[MunsMood] error:", detail);
      res.status(500).json({ error: error.message || "Error procesando la foto", detail });
    }
  });

  // ── ScanMuns ──────────────────────────────────────────────────────────────
  const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
  const MINDS_DIR = path.join(DATA_DIR, 'minds');
  const IMAGES_DIR = path.join(DATA_DIR, 'images');
  const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

  for (const dir of [MINDS_DIR, IMAGES_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CARDS_FILE)) fs.writeFileSync(CARDS_FILE, '[]');

  interface Card {
    id: string; slug: string; name: string;
    overlayUrl: string;
    overlayType: 'youtube' | 'tiktok' | 'drive' | 'image' | 'spotify';
    imageMime: string;
    aspectRatio: string;
    createdAt: string; updatedAt: string;
  }

  function readCards(): Card[] {
    try { return JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8')); }
    catch { return []; }
  }

  function saveCards(cards: Card[]) {
    fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
  }

  function detectOverlayType(url: string): Card['overlayType'] {
    if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
    if (/tiktok\.com/.test(url)) return 'tiktok';
    if (/drive\.google\.com/.test(url)) return 'drive';
    if (/spotify\.com|spotifycreators-web\.app\.link/.test(url)) return 'spotify';
    return 'image';
  }

  const scanmunsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
  const BASE_URL = process.env.BASE_URL || 'https://infomuns-production.up.railway.app';

  // CORS abierto para ScanMuns (datos públicos)
  app.use(['/api/scanmuns', '/minds', '/images'], (req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Servir combined.mind e imágenes originales
  app.use('/minds', express.static(MINDS_DIR));
  app.use('/images', express.static(IMAGES_DIR));

  // Subir / reemplazar una card + nuevo combined.mind
  app.post('/api/scanmuns/upload',
    scanmunsUpload.fields([{ name: 'mindFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]),
    (req: any, res: any) => {
      const files = req.files as { [f: string]: Express.Multer.File[] };
      const mindFile = files['mindFile']?.[0];
      const imageFile = files['imageFile']?.[0];
      const { slug, name, overlayUrl, aspectRatio } = req.body;

      if (!slug || !name || !overlayUrl || !mindFile || !imageFile)
        return res.status(400).json({ error: 'slug, name, overlayUrl, mindFile e imageFile son requeridos' });
      if (!/^[a-z0-9-]+$/.test(slug))
        return res.status(400).json({ error: 'El slug solo puede tener letras minúsculas, números y guiones' });

      // Guardar combined.mind (siempre sobreescribe)
      fs.writeFileSync(path.join(MINDS_DIR, 'combined.mind'), mindFile.buffer);
      // Guardar imagen original de este card
      fs.writeFileSync(path.join(IMAGES_DIR, slug), imageFile.buffer);

      const cards = readCards();
      const idx = cards.findIndex(c => c.slug === slug);
      const now = new Date().toISOString();
      const card: Card = {
        id: idx >= 0 ? cards[idx].id : crypto.randomUUID(),
        slug, name, overlayUrl,
        overlayType: detectOverlayType(overlayUrl),
        imageMime: imageFile.mimetype || 'image/jpeg',
        aspectRatio: aspectRatio || '16:9',
        createdAt: idx >= 0 ? cards[idx].createdAt : now,
        updatedAt: now,
      };
      if (idx >= 0) cards[idx] = card; else cards.push(card);
      saveCards(cards);
      res.json({ success: true, card, combinedMindUrl: `${BASE_URL}/minds/combined.mind` });
    }
  );

  // Actualizar solo el combined.mind (después de eliminar una card)
  app.post('/api/scanmuns/combined-mind', scanmunsUpload.single('mindFile'), (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: 'mindFile requerido' });
    fs.writeFileSync(path.join(MINDS_DIR, 'combined.mind'), req.file.buffer);
    res.json({ success: true });
  });

  // Obtener una card por slug
  app.get('/api/scanmuns/card/:slug', (req: any, res: any) => {
    const card = readCards().find(c => c.slug === req.params.slug);
    if (!card) return res.status(404).json({ error: 'Card no encontrada' });
    res.json(card);
  });

  // Listar todas las cards (en orden — el índice = targetIndex en combined.mind)
  app.get('/api/scanmuns/cards', (req: any, res: any) => {
    res.json(readCards());
  });

  // Actualizar overlayUrl/name/aspectRatio de una card sin subir archivos
  app.patch('/api/scanmuns/card/:slug', (req: any, res: any) => {
    const cards = readCards();
    const idx = cards.findIndex(c => c.slug === req.params.slug);
    if (idx < 0) return res.status(404).json({ error: 'Card no encontrada' });
    const { overlayUrl, name, aspectRatio } = req.body;
    if (overlayUrl) {
      cards[idx].overlayUrl = overlayUrl;
      cards[idx].overlayType = detectOverlayType(overlayUrl);
    }
    if (name) cards[idx].name = name;
    if (aspectRatio) cards[idx].aspectRatio = aspectRatio;
    cards[idx].updatedAt = new Date().toISOString();
    saveCards(cards);
    res.json({ success: true, card: cards[idx] });
  });

  // Eliminar una card (el cliente debe recompilar y subir nuevo combined.mind)
  app.delete('/api/scanmuns/card/:slug', (req: any, res: any) => {
    const cards = readCards();
    const idx = cards.findIndex(c => c.slug === req.params.slug);
    if (idx < 0) return res.status(404).json({ error: 'Card no encontrada' });
    const imgPath = path.join(IMAGES_DIR, req.params.slug);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    cards.splice(idx, 1);
    saveCards(cards);
    res.json({ success: true });
  });

  // ── Noticias Muns ─────────────────────────────────────────────────────────
  app.use("/api/noticias", createNoticiasRouter());

  // Panel admin — protegido con HTTP Basic Auth, servido ANTES del catch-all del frontend
  // /noticias-admin redirige a /cargarnoticias para no exponer la URL vieja
  app.get("/noticias-admin", (req, res) => {
    res.redirect(301, "/cargarnoticias");
  });

  app.get("/cargarnoticias", (req, res) => {
    const secret = process.env.NOTICIAS_ADMIN_SECRET;
    if (!secret) return res.status(500).send("NOTICIAS_ADMIN_SECRET no configurada");

    const auth = req.headers.authorization || "";
    if (auth.startsWith("Basic ")) {
      const decoded = Buffer.from(auth.slice(6), "base64").toString();
      const colonIdx = decoded.indexOf(":");
      const pass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
      if (pass === secret) {
        return res.sendFile("noticias-admin.html", { root: "." });
      }
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="Muns Admin"');
    res.status(401).send("No autorizado");
  });

  // Cron diario DESACTIVADO
  /* // Cron diario: 8am hora Argentina (UTC-3) = 11:00 UTC
  cron.schedule("0 11 * * *", async () => {
    console.log("[cron] Iniciando pipeline diario de noticias...");
    try {
      await runDailyPipeline();
    } catch (err: any) {
      console.error("[cron] Error en pipeline diario:", err.message);
    }
  }, { timezone: "America/Argentina/Buenos_Aires" }); */

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("/*path", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

fetchCharacterImages().then(() => startServer());
