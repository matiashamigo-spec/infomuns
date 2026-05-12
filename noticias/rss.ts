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
}

const FEEDS = [
  { url: "https://news.un.org/feed/subscribe/es/news/all/rss.xml", name: "ONU" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", name: "NYT" },
  { url: "http://rss.cnn.com/rss/edition_world.rss", name: "CNN" },
  { url: "https://www.infobae.com/feeds/rss", name: "Infobae" },
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
      }));
    })
  );

  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

export function findTopStories(articles: RssArticle[], limit = 10): RssArticle[] {
  const groups: RssArticle[][] = [];

  for (const article of articles) {
    if (!article.title) continue;
    let added = false;
    for (const group of groups) {
      if (similarity(article.title, group[0].title) >= 0.35) {
        group.push(article);
        added = true;
        break;
      }
    }
    if (!added) groups.push([article]);
  }

  // Sort groups by how many sources cover the story
  groups.sort((a, b) => b.length - a.length);

  // From each group pick the article with the most content or with an image
  return groups
    .slice(0, limit)
    .map(group => group.sort((a, b) => {
      const scoreA = (a.imageUrl ? 2 : 0) + a.content.length;
      const scoreB = (b.imageUrl ? 2 : 0) + b.content.length;
      return scoreB - scoreA;
    })[0]);
}
