import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  emptyPlot,
  emptySource,
  type Finding,
  type Plot,
  type PlotInput,
  type Source,
  type SourceInput,
} from "./registry";

type Data = { sources: Source[]; plots: Plot[] };

const DATA_FILE = path.join(process.cwd(), "data", "registry.json");

// Все записи идут через одну очередь, чтобы параллельные запросы не затирали файл друг другу
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Data> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { sources: [], plots: [] };
    throw err;
  }
}

async function save(data: Data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}

function mutate<T>(fn: (data: Data) => T): Promise<T> {
  const run = queue.then(async () => {
    const data = await load();
    const result = fn(data);
    await save(data);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export async function getRegistry(): Promise<Data> {
  await queue;
  const data = await load();
  data.plots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  data.sources.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return data;
}

// Из присланного берём только известные поля, чтобы в файл не попал мусор
function pick<T extends object>(template: T, input: Partial<T>): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(template) as (keyof T)[]) {
    if (input[key] !== undefined) result[key] = input[key];
  }
  return result;
}

export function createSource(input: Partial<SourceInput>): Promise<Source> {
  return mutate((data) => {
    const now = new Date().toISOString();
    const source: Source = { ...emptySource(), ...pick(emptySource(), input), id: randomUUID(), createdAt: now, updatedAt: now };
    data.sources.push(source);
    return source;
  });
}

export function updateSource(id: string, input: Partial<SourceInput>) {
  return mutate((data) => {
    const source = data.sources.find((s) => s.id === id);
    if (!source) return null;
    Object.assign(source, pick(emptySource(), input), { updatedAt: new Date().toISOString() });
    return source;
  });
}

export function deleteSource(id: string) {
  return mutate((data) => {
    const before = data.sources.length;
    data.sources = data.sources.filter((s) => s.id !== id);
    // Участки остаются, просто теряют ссылку на источник
    for (const plot of data.plots) if (plot.sourceId === id) plot.sourceId = "";
    return data.sources.length < before;
  });
}

function cleanFindings(findings: Finding[] | undefined): Finding[] | undefined {
  return findings
    ?.filter((f) => f.text?.trim())
    .map((f) => ({
      id: f.id || randomUUID(),
      text: f.text.trim(),
      basis: f.basis?.trim() ?? "",
      verified: Boolean(f.verified),
      createdAt: f.createdAt || new Date().toISOString(),
    }));
}

export function createPlot(input: Partial<PlotInput>): Promise<Plot> {
  return mutate((data) => {
    const now = new Date().toISOString();
    const plot: Plot = {
      ...emptyPlot(),
      ...pick(emptyPlot(), input),
      findings: cleanFindings(input.findings) ?? [],
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    data.plots.push(plot);
    return plot;
  });
}

export function updatePlot(id: string, input: Partial<PlotInput>) {
  return mutate((data) => {
    const plot = data.plots.find((p) => p.id === id);
    if (!plot) return null;
    const findings = cleanFindings(input.findings);
    Object.assign(plot, pick(emptyPlot(), input), findings ? { findings } : {}, {
      updatedAt: new Date().toISOString(),
    });
    return plot;
  });
}

export function deletePlot(id: string) {
  return mutate((data) => {
    const before = data.plots.length;
    data.plots = data.plots.filter((p) => p.id !== id);
    return data.plots.length < before;
  });
}
