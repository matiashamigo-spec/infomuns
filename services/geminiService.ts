
import { MunStory, NewsArticle } from "../types";

export const fetchNewsFromUrl = async (url: string): Promise<NewsArticle | null> => {
  try {
    const scrapeResponse = await fetch(`/api/fetch-news?url=${encodeURIComponent(url)}`);
    if (!scrapeResponse.ok) throw new Error("Failed to fetch news");
    return await scrapeResponse.json();
  } catch (error) {
    console.error("Error al extraer noticia:", error);
    return null;
  }
};

export const generateMunStory = async (newsText: string): Promise<MunStory> => {
  try {
    const response = await fetch("/api/generate-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newsText }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("Error al generar historia:", error);
    return {
      title: "Un cuento en el viento",
      story: "A veces las palabras viajan más lento que el cohete lunar. Los Muns están esperando a que el viento se calme para poder contarte lo que vieron hoy con mucha claridad y ternura."
    };
  }
};
