
import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type } from "@google/genai";
import { MUNS_SYSTEM_INSTRUCTION } from "./constants";
import rateLimit from "express-rate-limit";

const storyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // máximo 10 generaciones por IP por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas historias generadas. Volvé en un rato." },
});

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // CORS for WordPress embed
  app.use((req, res, next) => {
    const allowed = ["https://muns.club", "https://www.muns.club"];
    const origin = req.headers.origin || "";
    if (allowed.includes(origin) || process.env.NODE_ENV !== "production") {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
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

      // Infobae specific selectors (and some generic fallbacks)
      const headline = $("h1").first().text().trim() || $("title").text().trim();
      
      // Content extraction with multiple selectors
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
          if (content.length > 200) break; // If we found enough content, stop
        }
      }

      if (content.length < 200) {
        // Fallback: just get all p tags if specific selectors fail or return too little
        content = "";
        $("p").each((i, el) => {
          const text = $(el).text().trim();
          if (text.length > 50) { // Avoid short snippets
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
        model: "gemini-2.0-flash",
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve static files from dist
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
