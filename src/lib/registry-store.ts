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
  owners,
  workingStatuses,
  type Owner,
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
import { normalizeCadastralNumber } from "./nspd";
import { regionByCadastralNumber } from "./regions";
import { vriClassifier, vriVerdicts, type VriVerdict } from "./vri";

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
      cadastralValue: p.cadastralValue ?? null,
      // Карточки, вставленные до появления отметки, узнаём по кадастровой стоимости — её даёт только НСПД
      nspdCheckedAt: p.nspdCheckedAt !== undefined ? p.nspdCheckedAt : p.cadastralValue != null ? p.updatedAt.slice(0, 10) : null,
      rightsCheckedAt: p.rightsCheckedAt ?? null,
      torgiCheckedAt: p.torgiCheckedAt ?? null,
      checks: { ...emptyChecks(), ...p.checks },
      scores: p.scores ?? {},
      economics: { ...emptyEconomics(), ...p.economics },
      route: { ...emptyRoute(), ...p.route },
      deadlines: p.deadlines ?? [],
      obligations: p.obligations ?? [],
    })),
    settings: { weights: { ...defaultWeights, ...data.settings?.weights }, vri: data.settings?.vri ?? {} },
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

// withPlots — удалить и участки этого источника (например, неудачную выгрузку из НСПД),
// кроме тех, с которыми уже идёт работа: они остаются, просто теряют ссылку на источник
export function deleteSource(id: string, withPlots = false) {
  return mutate((data) => {
    const before = data.sources.length;
    data.sources = data.sources.filter((s) => s.id !== id);
    if (withPlots) data.plots = data.plots.filter((p) => p.sourceId !== id || workingStatuses.includes(p.status));
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
  for (const key of ["nspdCheckedAt", "rightsCheckedAt", "torgiCheckedAt"] as const) {
    if (fields[key] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields[key]))) fields[key] = null;
  }
  if (fields.cadastralValue !== undefined) {
    const value = fields.cadastralValue === null ? null : Number(fields.cadastralValue);
    fields.cadastralValue = value !== null && Number.isFinite(value) && value >= 0 ? value : null;
  }
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

export type ImportResult = { created: number; skipped: string[]; sourceId: string };

// Массовое добавление кандидатов по списку кадастровых номеров (выгрузка НСПД и т. п.).
// Уже известные номера пропускаем; район подставляем по коду кадастрового района (60:10 → как у других участков).
export function importPlots(input: { numbers?: unknown; sourceName?: unknown; owner?: unknown }): Promise<ImportResult> {
  return mutate((data) => {
    const now = new Date().toISOString();
    const numbers = [...new Set((Array.isArray(input.numbers) ? input.numbers : []).map((n) => normalizeCadastralNumber(String(n))))].filter(
      (n) => /^\d{2}:\d{2}:\d{7}:\d+$/.test(n),
    );
    const known = new Set(data.plots.map((p) => normalizeCadastralNumber(p.cadastralNumber)));

    const sourceName = String(input.sourceName ?? "").trim() || "НСПД";
    let source = data.sources.find((s) => s.name === sourceName);
    if (!source) {
      source = {
        ...emptySource(),
        name: sourceName,
        type: "map",
        url: "https://nspd.gov.ru/map?thematic=PKK",
        notes: "Список номеров из поиска НСПД. Сведения по участкам заполняются вставкой карточки НСПД.",
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      data.sources.push(source);
    }

    const districts = new Map<string, string>();
    for (const p of data.plots) {
      const code = p.cadastralNumber.slice(0, 5);
      if (p.district && !districts.has(code)) districts.set(code, p.district.split(",")[0].trim());
    }
    const owner = typeof input.owner === "string" && input.owner in owners ? (input.owner as Owner) : "unknown";

    const skipped: string[] = [];
    let created = 0;
    for (const number of numbers) {
      if (known.has(number)) {
        skipped.push(number);
        continue;
      }
      data.plots.push({
        ...emptyPlot(),
        cadastralNumber: number,
        region: regionByCadastralNumber(number) ?? emptyPlot().region,
        district: districts.get(number.slice(0, 5)) ?? "",
        owner,
        sourceId: source.id,
        notes: "Добавлен списком из НСПД. Откройте карточку участка в НСПД и вставьте её текст — поля заполнятся.",
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      known.add(number);
      created++;
    }
    return { created, skipped, sourceId: source.id };
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

// Своя оценка вида ВРИ вместо оценки по умолчанию; значение по умолчанию — убрать переопределение
export function updateVri(input: Record<string, unknown>) {
  return mutate((data) => {
    for (const [code, verdict] of Object.entries(input)) {
      const entry = vriClassifier.find((e) => e.code === code);
      if (!entry || !(typeof verdict === "string" && verdict in vriVerdicts)) continue;
      if (verdict === entry.verdict) delete data.settings.vri[code];
      else data.settings.vri[code] = verdict as VriVerdict;
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
