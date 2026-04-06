
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type } from "@google/genai";
import { MUNS_SYSTEM_INSTRUCTION } from "./constants";
import rateLimit from "express-rate-limit";

const storyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas historias generadas. Volvé en un rato." },
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


async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: "20mb" }));

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
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
            { text: "Analice la imagen con suma atención. Responda únicamente con una de estas categorías:\n- 'MULTIPLE_PEOPLE' si se observan dos o más personas.\n- 'HUG_TWO' si hay una sola persona con los brazos extendidos para un abrazo.\n- 'TONGUE_OUT' si hay una sola persona con la lengua fuera.\n- 'SAD' si hay una sola persona con expresión de angustia o tristeza.\n- 'HAPPY_NEUTRAL' en cualquier otro caso." }
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
        MULTIPLE_PEOPLE: { useMun: true,  useOpaq: false }
      };

      const cfg = EMOTION_ACTIONS[emotion] || EMOTION_ACTIONS.HAPPY_NEUTRAL;

      // Regla de abrazo: para 1 persona siempre abrazan; para múltiples se meten entre dos
      const hugRule = "CRÍTICO sobre el abrazo: el brazo del personaje nace de su hombro y rodea a la persona hacia afuera — nunca cruza por encima de su propia cabeza ni de su propio torso. El abrazo es tierno. El rostro de la persona queda 100% visible.";

      let specificAction = "";
      if (emotion === "TONGUE_OUT") {
        specificAction = "La persona saca la lengua de forma juguetona. Mun y Opaq abrazan a la persona desde cada costado — uno a cada lado, con un brazo alrededor de la persona, sus cuerpos pegados a la silueta de la persona. Si hay piso visible, sus pies están al mismo nivel. Si es plano medio, están a la altura de los hombros o brazos, rodeándola. Hacen gestos divertidos sin tapar ningún rostro. CRÍTICO: Mun y Opaq deben aparecer con el MISMO tamaño entre sí. " + hugRule;
      } else if (emotion === "MULTIPLE_PEOPLE") {
        specificAction = "Se observa un grupo de personas. Mun se mete en el espacio libre entre DOS personas que estén próximas entre sí — su cuerpo toca o roza la silueta de ambas al mismo tiempo, como si formara parte natural del grupo. Si hay piso visible, sus pies están al mismo nivel que los de las personas. Si es plano medio, Mun está a la altura de los hombros de ambas, tocando a las dos. Las caras de TODAS las personas quedan 100% visibles. Mun NO aparece en fondo alejado ni junto a una sola persona del borde.";
      } else if (emotion === "HUG_TWO") {
        specificAction = "La persona tiene los brazos abiertos ofreciendo un abrazo. Mun se mete dentro del espacio que forman los brazos, respondiendo al abrazo. El cuerpo de Mun está pegado al torso de la persona, entre sus brazos abiertos. Si hay piso visible, sus pies están al mismo nivel que los de la persona. " + hugRule;
      } else if (emotion === "SAD") {
        specificAction = "Se percibe tristeza. Opaq abraza a la persona desde un costado en gesto de consuelo. El cuerpo de Opaq está pegado a la silueta de la persona, con un brazo rodeando su hombro o cintura. Si hay piso visible, sus pies están al mismo nivel que los de la persona. Si es plano medio, Opaq está a la altura del hombro o torso con el brazo rodeando a la persona. El rostro de la persona queda 100% visible. " + hugRule;
      } else {
        specificAction = "Mun abraza a la persona desde un costado. Su cuerpo está pegado a la silueta de la persona, con un brazo rodeando su hombro o cintura. Si hay piso visible, sus pies están en el mismo piso al mismo nivel. Si es plano medio, Mun está a la altura del hombro o torso con el brazo rodeando a la persona. Mun NO aparece en fondo lejano ni en espacio vacío alejado. " + hugRule;
      }

      const prompt =
        "REGLA #1 — LA MÁS IMPORTANTE DE TODAS: La cara de Mun y la cara de Opaq son INTOCABLES. Sus facciones, ojos, boca, expresión y forma de la cara son EXACTAMENTE iguales a las imágenes de referencia entregadas. No se modifican bajo ninguna circunstancia, sin importar la emoción de la foto ni la acción que realicen. La cara de Mun es siempre la cara de Mun. La cara de Opaq es siempre la cara de Opaq. Nunca cambian.\n\n" +
        "OBJETIVO: El resultado debe verse como si el personaje animado REALMENTE ESTUVO AHÍ cuando se sacó la foto. NO es un sticker, NO es la imagen de referencia pegada encima. Es una criatura pequeña que vivió ese momento: adaptó su pose al entorno, está parada sobre la misma superficie, con la misma iluminación y perspectiva de la escena.\n\n" +
        "USO DE LA IMAGEN DE REFERENCIA: La imagen de referencia define SOLO DOS COSAS: (1) la cara exacta del personaje y (2) las proporciones de su cuerpo (tamaño relativo de brazos, piernas, torso). NO define la pose. El personaje puede estar de pie, sentado, inclinado, abrazando, asomándose — cualquier pose que sea natural para la escena. La imagen de referencia es un molde de identidad, no una pose a copiar.\n\n" +
        "EL PERSONAJE OCUPA ESPACIO VACÍO. Su cuerpo siempre está en el fondo o espacio libre visible — nunca encima del cuerpo, ropa ni cara de ninguna persona.\n\n" +
        "REGLA CRÍTICA — PROPORCIONES FIJAS, POSE LIBRE: Los brazos y piernas tienen una longitud proporcional fija (igual a la referencia). Pero la POSE es completamente libre: pueden estar doblados, extendidos hacia la persona, levantados, etc. Lo que NUNCA ocurre es que se estiren más allá de su longitud natural — si el personaje quiere alcanzar algo lejano, se acerca con todo el cuerpo.\n\n" +
        "REGLAS OBLIGATORIAS:\n\n" +
        "1. NUNCA CUBRIR NINGUNA CARA NI NINGÚN CUERPO: El personaje jamás puede superponerse sobre la cara o el cuerpo de NINGUNA persona de la foto, sin importar cuántas haya. Cada rostro humano debe quedar 100% visible. Si hay varias personas, el personaje se ubica en un espacio libre entre ellas, en un borde, o asomándose desde atrás sin tapar a nadie.\n\n" +
        "2. ESCALA PEQUEÑA: El personaje es SIEMPRE más pequeño que la persona. Su tamaño máximo equivale a la cabeza humana. Nunca puede ser igual ni más grande.\n\n" +
        "3. CARA DEL PERSONAJE INMUTABLE: La cara del personaje es EXACTAMENTE igual a la imagen de referencia. No cambia su expresión, no imita gestos humanos, no saca la lengua, no pone cara triste, no sonríe diferente. Solo su cuerpo (torso, brazos, piernas) se adapta a la escena.\n\n" +
        "4. LA FOTO ORIGINAL ES INTOCABLE — PROHIBIDO INVENTAR CONTENIDO: Cada píxel de la foto original (personas, ropa, fondo, objetos, iluminación) debe quedar IDÉNTICO. Está estrictamente prohibido: extender ropa, alargar mangas, agregar fondo, rellenar zonas, modificar colores, añadir sombras propias del entorno, o generar cualquier contenido nuevo que no sea el personaje animado. Si el personaje tapa algo de la foto al insertarse, ese algo debe seguir viéndose exactamente igual alrededor del personaje.\n\n" +
        "5. CUERPO ÍNTEGRO Y CONECTADO — APLICA IGUAL A MUN Y A OPAQ: Cada personaje tiene exactamente 2 brazos y 2 piernas, ni uno más ni uno menos. Cada brazo nace del hombro y termina en una mano. Cada pierna nace de la cadera y termina en un pie. NINGUNA parte del cuerpo puede aparecer flotando, duplicada, separada ni superpuesta sobre otra parte del propio cuerpo. Una mano no puede aparecer por encima del torso ni del hombro. Si un brazo abraza, nace del hombro y rodea hacia afuera — nunca cruza por encima de la cabeza ni del propio cuerpo. Ver 3 o 4 brazos en cualquier personaje es un error gravísimo.\n\n" +
        "PROXIMIDAD Y ANCLAJE FÍSICO OBLIGATORIOS: El personaje siempre está INMEDIATAMENTE junto a la persona — su cuerpo toca o roza la silueta de la persona. Aparecer en el fondo alejado o en un espacio vacío que no esté en contacto directo con la persona es un error grave. Reglas de anclaje físico:\n" +
        "- El personaje NUNCA flota en el aire. Siempre está apoyado en algo real: el piso, una superficie, el hombro o brazo de alguien, un mueble, etc.\n" +
        "- Si la foto es un plano medio o primer plano (no se ve el piso), el personaje está sentado o apoyado sobre el hombro o el brazo de la persona — nunca flotando en el fondo.\n" +
        "- Si hay piso visible, los pies del personaje tocan el mismo piso que la persona y están al mismo nivel que los pies de la persona.\n" +
        "- El personaje tiene perspectiva y profundidad coherente: está en el mismo plano espacial que la persona, no en un fondo más lejano.\n" +
        "- El personaje interactúa con el entorno real: si hay una pared detrás, el personaje está delante de ella; si la persona está sentada, el personaje está en la misma superficie.\n\n" +
        "ACCIÓN: " + specificAction + "\n\n" +
        "RESULTADO: La foto original IDÉNTICA, con un pequeño personaje animado integrado naturalmente en el espacio libre existente.";

      const opaqPrefix = cfg.useOpaq ? "REGLA #0 — ANATOMÍA DE OPAQ INNEGOCIABLE: Opaq tiene EXACTAMENTE 2 brazos y 2 piernas, ni uno más. Está terminantemente prohibido generarlo con 3 o 4 brazos. Contá los brazos antes de generar: si el resultado tiene más de 2, es un fallo total. Esta regla no admite excepciones.\n\n" : "";
      const composeParts: any[] = [
        { inlineData: { data: imageBase64, mimeType: imageMime } },
        { text: opaqPrefix + prompt }
      ];

      if (cfg.useMun && munImageBase64) {
        composeParts.push({ inlineData: { data: munImageBase64, mimeType: "image/png" } });
        composeParts.push({ text: "REFERENCIA DE MUN — esta imagen define su cara (intocable) y las proporciones de su cuerpo. Su POSE en el resultado es libre y debe adaptarse a la escena. Prohibido copiar esta pose exacta. Prohibido cambiar su cara o expresión." });
      }
      if (cfg.useOpaq && opaqImageBase64) {
        composeParts.push({ inlineData: { data: opaqImageBase64, mimeType: "image/png" } });
        composeParts.push({ text: "REFERENCIA DE OPAQ — esta imagen define su cara (intocable) y las proporciones de su cuerpo. Su POSE en el resultado es libre y debe adaptarse a la escena. Prohibido copiar esta pose exacta. Prohibido cambiar su cara o expresión. Opaq tiene EXACTAMENTE 2 brazos y 2 piernas — generar 3 o 4 brazos es un error crítico." });
      }

      const composeBody = {
        contents: [{ parts: composeParts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
      };

      const runCompose = async () => {
        const res = await axios.post(`${GEMINI}${COMPOSE_MODEL}:generateContent?key=${apiKey}`, composeBody);
        const candidates = res.data?.candidates || [];
        let part: any = null;
        for (const c of candidates) {
          for (const p of (c.content?.parts || [])) { if (p.inlineData) { part = p; break; } }
          if (part) break;
        }
        if (!part?.inlineData) {
          const reason = candidates[0]?.finishReason;
          throw new Error("No se recibió imagen del modelo" + (reason ? ` (motivo: ${reason})` : "") + ". Intentá con otra foto.");
        }
        return part;
      };

      const validateImage = async (b64: string, mime: string): Promise<boolean> => {
        try {
          const vRes = await axios.post(`${GEMINI}${DETECT_MODEL}:generateContent?key=${apiKey}`, {
            contents: [{ parts: [
              { inlineData: { data: b64, mimeType: mime } },
              { text: "Esta imagen tiene una foto real con uno o dos personajes animados pequeños insertados (se llaman Mun y Opaq). Analizá con atención y respondé SOLO con SI o NO a cada punto:\n1. ¿Algún personaje tiene más de 2 brazos o más de 2 piernas visibles?\n2. ¿Algún personaje cubre o se superpone sobre el rostro de alguna persona?\n3. ¿Algún personaje es igual o más grande que la persona en la foto?\n\nRespondé exactamente así:\n1: SI o NO\n2: SI o NO\n3: SI o NO" }
            ]}],
            generationConfig: { temperature: 0, maxOutputTokens: 30 }
          });
          const text = ((vRes.data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("")).toUpperCase();
          console.log(`[MunsMood] validation: ${text}`);
          return !text.split("\n").some(l => /^\d:/.test(l.trim()) && l.includes("SI"));
        } catch { return true; } // si falla la validación por red, dejamos pasar
      };

      // Paso 3: Compose + validar, con hasta 2 reintentos si falla
      let imagePart = await runCompose();
      for (let attempt = 1; attempt <= 2; attempt++) {
        const ok = await validateImage(imagePart.inlineData.data, imagePart.inlineData.mimeType || "image/png");
        if (ok) break;
        console.log(`[MunsMood] validation failed (attempt ${attempt}), retrying compose...`);
        imagePart = await runCompose();
      }

      const composedImage = `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`;
      res.json({ composedImage });

    } catch (error: any) {
      console.error("[MunsMood] error:", error.response?.data || error.message);
      res.status(500).json({ error: error.message || "Error procesando la foto" });
    }
  });

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
