import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  checkValues,
  criteria,
  defaultWeights,
  emptyChecks,
  emptyPlot,
  emptyRoute,
  obligationKinds,
  routeSteps,
  type Deadline,
  type Obligation,
  type RouteEntry,
  type RouteStep,
  emptySource,
  stopFactors,
  type CheckValue,
  type Criterion,
  type Finding,
  type Plot,
  type PlotInput,
  type Settings,
  type Source,
  type SourceInput,
  type StopFactor,
  type Weights,
} from "./registry";
import { economicsFields, emptyEconomics, type Economics, type EconomicsField } from "./economics";

type Data = { sources: Source[]; plots: Plot[]; settings: Settings };

const DATA_FILE = path.join(process.cwd(), "data", "registry.json");

// Все записи идут через одну очередь, чтобы параллельные запросы не затирали файл друг другу
let queue: Promise<unknown> = Promise.resolve();

// Дополняет данные, сохранённые более ранними версиями приложения, новыми полями
function normalize(data: Partial<Data>): Data {
  return {
    sources: data.sources ?? [],
    plots: (data.plots ?? []).map((p) => ({
      ...p,
      checks: { ...emptyChecks(), ...p.checks },
      scores: p.scores ?? {},
      economics: { ...emptyEconomics(), ...p.economics },
      route: { ...emptyRoute(), ...p.route },
      deadlines: p.deadlines ?? [],
      obligations: p.obligations ?? [],
    })),
    settings: { weights: { ...defaultWeights, ...data.settings?.weights } },
  };
}

async function load(): Promise<Data> {
  try {
    return normalize(JSON.parse(await fs.readFile(DATA_FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return normalize({});
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

function cleanChecks(checks: Partial<Record<StopFactor, CheckValue>> | undefined) {
  if (!checks) return undefined;
  const result = emptyChecks();
  for (const key of Object.keys(stopFactors) as StopFactor[]) {
    if (checks[key] && checks[key] in checkValues) result[key] = checks[key];
  }
  return result;
}

function cleanScores(scores: Partial<Record<Criterion, number>> | undefined) {
  if (!scores) return undefined;
  const result: Partial<Record<Criterion, number>> = {};
  for (const key of Object.keys(criteria) as Criterion[]) {
    const value = Math.round(Number(scores[key]));
    if (value >= 1 && value <= 5) result[key] = value;
  }
  return result;
}

function cleanEconomics(economics: Partial<Economics> | undefined) {
  if (!economics) return undefined;
  const result = emptyEconomics();
  for (const key of Object.keys(economicsFields) as EconomicsField[]) {
    const raw = economics[key];
    const value = raw === null || raw === undefined || (raw as unknown) === "" ? null : Number(raw);
    result[key] = value !== null && Number.isFinite(value) && value >= 0 ? value : null;
  }
  return result;
}

function cleanRoute(route: Partial<Record<RouteStep, Partial<RouteEntry>>> | undefined) {
  if (!route) return undefined;
  const result = emptyRoute();
  for (const key of Object.keys(routeSteps) as RouteStep[]) {
    result[key] = { value: String(route[key]?.value ?? "").trim(), done: Boolean(route[key]?.done) };
  }
  return result;
}

function cleanDeadlines(deadlines: Partial<Deadline>[] | undefined): Deadline[] | undefined {
  return deadlines
    ?.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "") && d.title?.trim())
    .map((d) => ({ id: d.id || randomUUID(), date: d.date!, title: d.title!.trim(), done: Boolean(d.done) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function cleanObligations(obligations: Partial<Obligation>[] | undefined): Obligation[] | undefined {
  return obligations
    ?.filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date ?? "") && o.kind && o.kind in obligationKinds)
    .map((o) => {
      const amount = o.amount === null || o.amount === undefined ? null : Number(o.amount);
      return {
        id: o.id || randomUUID(),
        date: o.date!,
        kind: o.kind!,
        title: String(o.title ?? "").trim(),
        amount: amount !== null && Number.isFinite(amount) && amount >= 0 ? amount : null,
        done: Boolean(o.done),
        evidence: String(o.evidence ?? "").trim(),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Сложные поля проверяются отдельно; undefined — поле не прислали, оставляем как было
function cleanPlotInput(input: Partial<PlotInput>) {
  const fields: Partial<PlotInput> = pick(emptyPlot(), input);
  const findings = cleanFindings(input.findings);
  const checks = cleanChecks(input.checks);
  const scores = cleanScores(input.scores);
  const economics = cleanEconomics(input.economics);
  const route = cleanRoute(input.route);
  const deadlines = cleanDeadlines(input.deadlines);
  const obligations = cleanObligations(input.obligations);
  delete fields.obligations;
  delete fields.findings;
  delete fields.checks;
  delete fields.scores;
  delete fields.economics;
  delete fields.route;
  delete fields.deadlines;
  return {
    ...fields,
    ...(findings && { findings }),
    ...(checks && { checks }),
    ...(scores && { scores }),
    ...(economics && { economics }),
    ...(route && { route }),
    ...(deadlines && { deadlines }),
    ...(obligations && { obligations }),
  };
}

export function createPlot(input: Partial<PlotInput>): Promise<Plot> {
  return mutate((data) => {
    const now = new Date().toISOString();
    const plot: Plot = { ...emptyPlot(), ...cleanPlotInput(input), id: randomUUID(), createdAt: now, updatedAt: now };
    data.plots.push(plot);
    return plot;
  });
}

export function updatePlot(id: string, input: Partial<PlotInput>) {
  return mutate((data) => {
    const plot = data.plots.find((p) => p.id === id);
    if (!plot) return null;
    Object.assign(plot, cleanPlotInput(input), { updatedAt: new Date().toISOString() });
    return plot;
  });
}

export function updateWeights(input: Partial<Weights>) {
  return mutate((data) => {
    for (const key of Object.keys(criteria) as Criterion[]) {
      const value = Number(input[key]);
      if (Number.isFinite(value) && value >= 0) data.settings.weights[key] = Math.round(value);
    }
    return data.settings;
  });
}

export function deletePlot(id: string) {
  return mutate((data) => {
    const before = data.plots.length;
    data.plots = data.plots.filter((p) => p.id !== id);
    return data.plots.length < before;
  });
}
