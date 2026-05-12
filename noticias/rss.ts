// Parsea los feeds RSS configurados y encuentra las 10 noticias más importantes
// Criterio: noticias que aparecen en más de un medio (por similitud de título)

import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [["media:content", "mediaContent"], ["media:thumbnail", "mediaThumbnail"], ["enclosure", "enclosure"]],
  },
});

export interface RssArticle {
  title: string;
  link: string;
  content: string;
  imageUrl: string;
  source: string;
  pubDate: string;
  positive: boolean;
}

const FEEDS = [
  { url: "https://news.un.org/feed/subscribe/es/news/all/rss.xml", name: "ONU", positive: false },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", name: "NYT", positive: false },
  { url: "http://rss.cnn.com/rss/edition_world.rss", name: "CNN", positive: false },
  { url: "https://www.infobae.com/feeds/rss", name: "Infobae", positive: false },
  { url: "https://noticiaspositivas.org/feed/", name: "NoticiasPositivas", positive: true },
  { url: "https://www.positive.news/feed/", name: "PositiveNews", positive: true },
];

const STOP_WORDS = new Set([
  "el","la","los","las","de","del","en","a","al","se","su","sus","y","o","e",
  "que","por","con","un","una","unos","unas","es","fue","ha","han","hay","ser",
  "si","no","ya","más","para","como","esto","este","esta","estos","estas","su",
  "sus","son","the","of","in","to","a","and","for","on","is","was","are","at",
  "by","an","with","from","it","its","be","has","had","that","this","they",
  "world","new","says","after","over","as","but","have","will","not","or",
  "during","about","amid","amid","amid","tras","ante","sobre","entre","hacia",
  "desde","hasta","tras","bajo","cómo","qué","quién","cuál","cuándo","dónde",
]);

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

function similarity(a: string, b: string): number {
  const kA = new Set(extractKeywords(a));
  const kB = new Set(extractKeywords(b));
  if (kA.size === 0 || kB.size === 0) return 0;
  let shared = 0;
  for (const w of kA) if (kB.has(w)) shared++;
  return shared / Math.min(kA.size, kB.size);
}

function extractImage(item: any): string {
  if (item.mediaContent?.$.url) return item.mediaContent.$.url;
  if (item.mediaThumbnail?.$.url) return item.mediaThumbnail.$.url;
  if (item.enclosure?.url) return item.enclosure.url;
  // Try to find an image in the content/description HTML
  const html = item["content:encoded"] || item.content || item.summary || "";
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match) return match[1];
  return "";
}

export async function fetchAllFeeds(): Promise<RssArticle[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return parsed.items.slice(0, 30).map((item): RssArticle => ({
        title: item.title || "",
        link: item.link || "",
        content: item.contentSnippet || item.content || item.summary || "",
        imageUrl: extractImage(item),
        source: feed.name,
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        positive: feed.positive,
      }));
    })
  );

  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

function pickBest(group: RssArticle[]): RssArticle {
  return group.sort((a, b) => {
    const scoreA = (a.imageUrl ? 2 : 0) + a.content.length;
    const scoreB = (b.imageUrl ? 2 : 0) + b.content.length;
    return scoreB - scoreA;
  })[0];
}

export function findTopStories(articles: RssArticle[], limit = 10): RssArticle[] {
  // Separar positivas del resto
  const positiveArticles = articles.filter(a => a.positive && a.title);
  const regularArticles = articles.filter(a => !a.positive && a.title);

  // Agrupar regulares por similitud
  const groups: RssArticle[][] = [];
  for (const article of regularArticles) {
    let added = false;
    for (const group of groups) {
      if (similarity(article.title, group[0].title) >= 0.35) {
        group.push(article); added = true; break;
      }
    }
    if (!added) groups.push([article]);
  }
  groups.sort((a, b) => b.length - a.length);

  // Reservar al menos 40% del límite para noticias positivas
  const positiveSlots = Math.max(1, Math.round(limit * 0.4));
  const regularSlots = limit - positiveSlots;

  const selected: RssArticle[] = [];

  // Tomar regulares con límite por fuente (máx 2 de CNN)
  const sourceCount: Record<string, number> = {};
  const SOURCE_CAP: Record<string, number> = { CNN: 2 };
  for (const group of groups) {
    if (selected.length >= regularSlots) break;
    const best = pickBest(group);
    const cap = SOURCE_CAP[best.source] ?? 99;
    sourceCount[best.source] = (sourceCount[best.source] || 0) + 1;
    if (sourceCount[best.source] > cap) continue;
    selected.push(best);
  }

  // Tomar positivas (sin agrupar, son únicas)
  const positiveSelected = positiveArticles
    .filter(a => a.imageUrl) // preferir las que tienen foto
    .slice(0, positiveSlots);
  // Si no hay suficientes con foto, completar sin filtro
  if (positiveSelected.length < positiveSlots) {
    const extra = positiveArticles
      .filter(a => !positiveSelected.includes(a))
      .slice(0, positiveSlots - positiveSelected.length);
    positiveSelected.push(...extra);
  }

  selected.push(...positiveSelected);

  // Mezclar para que no vayan todas positivas al final
  return selected.sort(() => Math.random() - 0.5).slice(0, limit);
}
