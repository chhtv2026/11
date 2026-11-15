// Загрузка подготовленного набора участков в реестр через API запущенного приложения.
// Запуск: npm run import -- seed/pskov-fund-2024-07-16.json
// Уже существующие источники (по названию) и участки (по кадастровому номеру) пропускаются.
import { readFile } from "fs/promises";

const BASE = process.env.REGISTRY_URL ?? "http://localhost:3001";
const file = process.argv[2];
if (!file) {
  console.error("Укажите файл: npm run import -- seed/<файл>.json");
  process.exit(1);
}

async function api(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const seed = JSON.parse(await readFile(file, "utf8"));
let registry;
try {
  registry = await api("/api/registry");
} catch {
  console.error(`Приложение не отвечает на ${BASE}. Сначала запустите его: npm run dev`);
  process.exit(1);
}

const sourceIds = new Map(registry.sources.map((s) => [s.name, s.id]));
let addedSources = 0;
for (const source of seed.sources ?? []) {
  if (sourceIds.has(source.name)) continue;
  const created = await api("/api/sources", "POST", source);
  sourceIds.set(created.name, created.id);
  addedSources++;
}

const existing = new Set(registry.plots.map((p) => p.cadastralNumber).filter(Boolean));
let addedPlots = 0;
let skipped = 0;
for (const { source, ...plot } of seed.plots ?? []) {
  if (plot.cadastralNumber && existing.has(plot.cadastralNumber)) {
    skipped++;
    continue;
  }
  await api("/api/plots", "POST", { ...plot, sourceId: sourceIds.get(source) ?? "" });
  addedPlots++;
}

console.log(`Источников добавлено: ${addedSources}. Участков добавлено: ${addedPlots}, уже были в реестре: ${skipped}.`);
