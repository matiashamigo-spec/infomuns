
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
      const shouldHug = cfg.useMun && Math.random() < 0.3;

      let specificAction = "";
      if (emotion === "TONGUE_OUT") {
        specificAction = "La persona saca la lengua de forma juguetona. Mun y Opaq se ubican en zonas de fondo visible a los costados de la persona —nunca encima de su cuerpo— y hacen gestos divertidos desde ahí. Sus cuerpos están completamente en el fondo/espacio libre.";
      } else if (emotion === "MULTIPLE_PEOPLE") {
        specificAction = "Se observa un grupo de personas. Mun identifica el espacio vacío más natural de la foto: puede ser un hueco entre personas, el fondo visible junto a alguien del borde, o el espacio libre por encima del grupo. Se ubica ahí entero, sin superponerse sobre ningún cuerpo ni cara. Si toda la foto está ocupada por personas, Mun se asoma solo con la cabeza desde un borde o esquina. Las caras de TODAS las personas quedan 100% visibles.";
      } else if (emotion === "HUG_TWO") {
        specificAction = "La persona tiene los brazos abiertos ofreciendo un abrazo. Mun se coloca en el espacio vacío delante de la persona (en el área libre que forman los brazos abiertos) como si caminara hacia el abrazo. El cuerpo de Mun está en el espacio libre, no encima del cuerpo de la persona.";
      } else if (emotion === "SAD") {
        specificAction = "Se percibe tristeza. Opaq se coloca en el espacio vacío a un costado de la persona. Desde ahí, extiende sus brazos (sin alargarlos) hacia la persona en gesto de abrazo contenido. El CUERPO de Opaq permanece en el área libre, fuera del cuerpo de la persona. El rostro de la persona queda 100% visible. La cara de Opaq no cambia.";
      } else {
        specificAction = "Mun se ubica en el espacio vacío más natural junto a la persona: al costado donde haya fondo visible, cerca de su brazo o hombro pero sin superponerse. Puede inclinarse levemente hacia la persona como si quisiera asomarse a la foto, pero su cuerpo entero está en el fondo libre.";
      }

      if (shouldHug) {
        specificAction += " De manera excepcional, Mun está abrazando a la persona. Es ABSOLUTAMENTE CRÍTICO que los brazos de Mun nazcan de su propio cuerpo. Los brazos deben rodear a la persona manteniendo ESTRICTAMENTE sus proporciones; NO deben estirarse. El abrazo debe ser tierno y el rostro de la persona debe ser 100% visible.";
      }

      const prompt =
        "REGLA #1 — LA MÁS IMPORTANTE DE TODAS: La cara de Mun y la cara de Opaq son INTOCABLES. Sus facciones, ojos, boca, expresión y forma de la cara son EXACTAMENTE iguales a las imágenes de referencia entregadas. No se modifican bajo ninguna circunstancia, sin importar la emoción de la foto ni la acción que realicen. La cara de Mun es siempre la cara de Mun. La cara de Opaq es siempre la cara de Opaq. Nunca cambian.\n\n" +
        "TAREA: Insertar un pequeño personaje animado dentro de esta fotografía real, como si estuviera físicamente presente en la escena junto a la persona.\n\n" +
        "EL PERSONAJE ES UNA CRIATURA PEQUEÑA E INDEPENDIENTE. No es un filtro ni una máscara. Su cuerpo SIEMPRE ocupa espacio vacío/fondo de la foto — nunca se superpone sobre el cuerpo, ropa ni cara de ninguna persona. Aparece parado en el fondo visible junto a la persona, nunca encima de ella.\n\n" +
        "REGLA CRÍTICA — APLICA TANTO A MUN COMO A OPAQ: Las extremidades de Mun y de Opaq (brazos y piernas) NUNCA se alargan ni estiran. Su longitud es fija, exactamente igual a la imagen de referencia de cada uno. Si Mun o Opaq no llegan a tocar algo con sus brazos de tamaño natural, su cuerpo entero se acerca — jamás estiran los brazos. Un brazo estirado o alargado en cualquiera de los dos personajes es un error grave.\n\n" +
        "REGLAS OBLIGATORIAS:\n\n" +
        "1. NUNCA CUBRIR NINGUNA CARA NI NINGÚN CUERPO: El personaje jamás puede superponerse sobre la cara o el cuerpo de NINGUNA persona de la foto, sin importar cuántas haya. Cada rostro humano debe quedar 100% visible. Si hay varias personas, el personaje se ubica en un espacio libre entre ellas, en un borde, o asomándose desde atrás sin tapar a nadie.\n\n" +
        "2. ESCALA PEQUEÑA: El personaje es SIEMPRE más pequeño que la persona. Su tamaño máximo equivale a la cabeza humana. Nunca puede ser igual ni más grande.\n\n" +
        "3. CARA DEL PERSONAJE INMUTABLE: La cara del personaje es EXACTAMENTE igual a la imagen de referencia. No cambia su expresión, no imita gestos humanos, no saca la lengua, no pone cara triste, no sonríe diferente. Solo su cuerpo (torso, brazos, piernas) se adapta a la escena.\n\n" +
        "4. LA FOTO NO SE MODIFICA: La fotografía original no se altera. No se agregan ni eliminan partes del cuerpo de la persona. No se cambia el encuadre ni el fondo. Solo se añade el personaje animado.\n\n" +
        "5. CUERPO ÍNTEGRO Y CONECTADO: El personaje es un cuerpo único. Cada brazo nace del hombro y termina en una mano. Cada pierna nace de la cadera y termina en un pie. NINGUNA parte del cuerpo puede aparecer flotando, separada, ni superpuesta sobre otra parte del propio cuerpo. Una mano no puede aparecer por encima del torso ni del hombro. Si un brazo abraza, nace del hombro y rodea hacia afuera — nunca cruza por encima de la cabeza ni del propio cuerpo del personaje. Exactamente 2 brazos y 2 piernas, siempre.\n\n" +
        "ACCIÓN: " + specificAction + "\n\n" +
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
        throw new Error("No se recibió imagen del modelo" + (reason ? ` (motivo: ${reason})` : "") + ". Intentá con otra foto.");
      }

      const composedImage = `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`;

      // Paso 3: Validar resultado
      const composedB64 = imagePart.inlineData.data;
      const composedMime = imagePart.inlineData.mimeType || "image/png";
      const validateBody = {
        contents: [{
          parts: [
            { inlineData: { data: composedB64, mimeType: composedMime } },
            { text: "Esta imagen tiene una foto real con uno o dos personajes animados pequeños insertados (se llaman Mun y Opaq). Analizá con atención y respondé SOLO con SI o NO a cada punto:\n1. ¿Algún personaje tiene más de 2 brazos o más de 2 piernas visibles?\n2. ¿Algún personaje cubre o se superpone sobre el rostro de alguna persona?\n3. ¿Algún personaje es igual o más grande que la persona en la foto?\n\nRespondé exactamente así:\n1: SI o NO\n2: SI o NO\n3: SI o NO" }
          ]
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 30 }
      };

      try {
        const validateRes = await axios.post(`${GEMINI}${DETECT_MODEL}:generateContent?key=${apiKey}`, validateBody);
        const validateText = ((validateRes.data?.candidates?.[0]?.content?.parts || [])
          .map((p: any) => p.text || "").join("")).toUpperCase();
        console.log(`[MunsMood] validation: ${validateText}`);
        const lines = validateText.split("\n");
        for (const line of lines) {
          if (/^\d:/.test(line.trim()) && line.includes("SI")) {
            throw new Error("vamos de nuevo que salió movida 📸");
          }
        }
      } catch (e: any) {
        if (e.message.includes("salió movida")) throw e;
        // Si falla la validación por error de red, dejamos pasar
        console.warn("[MunsMood] validation error (ignored):", e.message);
      }

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
