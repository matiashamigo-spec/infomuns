// Memoria de patrones narrativos usados recientemente.
// Permite inyectar en el prompt qué arquetipos y símbolos ya fueron usados
// para que Gemini elija siempre algo diferente.

import fs from "fs";
import path from "path";

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  process.env.DATA_DIR ||
  path.join(process.cwd(), "data");

const MEMORY_FILE = path.join(DATA_DIR, "story-memory.json");
const MAX_ENTRIES = 20;

export interface StoryMemoryEntry {
  date: string;
  title: string;
  symbol: string;
  resolution: string;
}

export function readStoryMemory(): StoryMemoryEntry[] {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveStoryToMemory(
  entry: Omit<StoryMemoryEntry, "date">
): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const entries = readStoryMemory();
    entries.unshift({ ...entry, date: new Date().toISOString() });
    fs.writeFileSync(
      MEMORY_FILE,
      JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2)
    );
  } catch (e: any) {
    console.warn("[story-memory] No se pudo guardar:", e.message);
  }
}

export function getRecentPatternsPrompt(): string {
  const entries = readStoryMemory();
  if (entries.length === 0) return "";

  const recent = entries.slice(0, 8);
  const lines = recent.map(
    (e, i) =>
      `- ${e.resolution} | símbolo: "${e.symbol}" (hace ${i + 1} ${i === 0 ? "historia" : "historias"})`
  );

  return (
    `\n\nMEMORIA ACTIVA — PROHIBIDO REPETIR:\n` +
    lines.join("\n") +
    `\nElegí un ARQUETIPO DE RESOLUCIÓN diferente a todos los listados arriba y un SÍMBOLO PRINCIPAL que no aparezca en esta lista.`
  );
}
