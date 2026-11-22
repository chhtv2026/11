import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  checkValues,
  criteria,
  defaultWeights,
  TORGI_EXPORT_FRESH_DAYS,
  emptyApplicant,
  emptyChecks,
  type Applicant,
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
import { districtByCadastralNumber, regionByCadastralNumber } from "./regions";
import { vriClassifier, vriVerdicts, type VriVerdict } from "./vri";
import { accessKinds, emptySurvey, waterKinds, type Survey, type WaterItem } from "./water";

// Осмотр по карте: только известные виды воды, числа — неотрицательные
function cleanSurvey(survey: Partial<Survey> | undefined): Survey | undefined {
  if (!survey || typeof survey !== "object") return undefined;
  const num = (v: unknown) => {
    const n = v === null || v === undefined || v === "" ? null : Number(v);
    return n !== null && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const water: WaterItem[] = (Array.isArray(survey.water) ? survey.water : [])
    .filter((w) => w && w.kind in waterKinds)
    .slice(0, 20)
    .map((w) => ({ kind: w.kind, name: String(w.name ?? "").trim().slice(0, 100), distanceM: num(w.distanceM), size: num(w.size) }));
  return {
    water,
    overgrown: Boolean(survey.overgrown),
    access: survey.access && survey.access in accessKinds ? survey.access : "",
    note: String(survey.note ?? "").slice(0, 2000),
  };
}

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
      // Район не указан — берём по кадастровому номеру
      district: p.district?.trim() ? p.district : (districtByCadastralNumber(p.cadastralNumber ?? "") ?? ""),
      rightsCheckedAt: p.rightsCheckedAt ?? null,
      torgiCheckedAt: p.torgiCheckedAt ?? null,
      torgiLotDate: p.torgiLotDate ?? null,
      restrictionsCheckedAt: p.restrictionsCheckedAt ?? null,
      restrictionZones: p.restrictionZones ?? [],
      planCheckedAt: p.planCheckedAt ?? null,
      planResult: p.planResult ?? "",
      planFindings: p.planFindings ?? [],
      survey: { ...emptySurvey(), ...p.survey },
      adminRequestAt: p.adminRequestAt ?? null,
      checks: { ...emptyChecks(), ...p.checks },
      scores: p.scores ?? {},
      economics: { ...emptyEconomics(), ...p.economics },
      route: { ...emptyRoute(), ...p.route },
      deadlines: p.deadlines ?? [],
      obligations: p.obligations ?? [],
    })),
    settings: {
      weights: { ...defaultWeights, ...data.settings?.weights },
      vri: data.settings?.vri ?? {},
      torgiExport: data.settings?.torgiExport ?? null,
      torgiExcluded: data.settings?.torgiExcluded ?? {},
      imports: data.settings?.imports ?? [],
      applicant: { ...emptyApplicant, ...data.settings?.applicant },
    },
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
  if (fields.planResult !== undefined && !["", "ok", "check"].includes(fields.planResult)) fields.planResult = "";
  if (fields.planFindings !== undefined) {
    const items = Array.isArray(fields.planFindings) ? fields.planFindings : [];
    fields.planFindings = [...new Set(items.filter((z) => typeof z === "string" && /^[a-zA-Z]{1,20}$/.test(z)))];
  }
  for (const key of ["nspdCheckedAt", "rightsCheckedAt", "torgiCheckedAt", "torgiLotDate", "restrictionsCheckedAt", "planCheckedAt", "adminRequestAt"] as const) {
    if (fields[key] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields[key]))) fields[key] = null;
  }
  if (fields.restrictionZones !== undefined) {
    const zones = Array.isArray(fields.restrictionZones) ? fields.restrictionZones : [];
    fields.restrictionZones = [...new Set(zones.filter((z) => typeof z === "string" && /^[a-zA-Z]{1,20}$/.test(z)))];
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
  const survey = cleanSurvey(input.survey);
  delete fields.survey;
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
    ...(survey && { survey }),
  };
}

// Ошибка, которую можно показать пользователю как есть
export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// Район по коду кадастрового района (первые 5 символов номера) — как у уже известных участков
function districtsByCode(plots: Plot[]) {
  const districts = new Map<string, string>();
  for (const p of plots) {
    const code = p.cadastralNumber.slice(0, 5);
    if (p.district && !districts.has(code)) districts.set(code, p.district.split(",")[0].trim());
  }
  return districts;
}

// Один кадастровый номер — один участок в реестре
function assertUniqueNumber(data: Data, number: string, exceptId?: string) {
  const n = normalizeCadastralNumber(number);
  if (!n) return;
  const twin = data.plots.find((p) => p.id !== exceptId && normalizeCadastralNumber(p.cadastralNumber) === n);
  if (twin) {
    throw new RegistryError(`Участок ${n} уже есть в реестре${twin.district ? ` (${twin.district})` : ""} — найдите его поиском по номеру.`, 409);
  }
}

export function createPlot(input: Partial<PlotInput>): Promise<Plot> {
  return mutate((data) => {
    const now = new Date().toISOString();
    const plot: Plot = { ...emptyPlot(), ...cleanPlotInput(input), id: randomUUID(), createdAt: now, updatedAt: now };
    plot.cadastralNumber = normalizeCadastralNumber(plot.cadastralNumber);
    assertUniqueNumber(data, plot.cadastralNumber);
    // Без района участок попадает в «Район не указан» и теряется в списке
    if (!plot.district.trim()) plot.district = districtsByCode(data.plots).get(plot.cadastralNumber.slice(0, 5)) ?? districtByCadastralNumber(plot.cadastralNumber) ?? "";
    data.plots.push(plot);
    return plot;
  });
}

export function updatePlot(id: string, input: Partial<PlotInput>) {
  return mutate((data) => {
    const plot = data.plots.find((p) => p.id === id);
    if (!plot) return null;
    const fields = cleanPlotInput(input);
    if (fields.cadastralNumber !== undefined) {
      fields.cadastralNumber = normalizeCadastralNumber(fields.cadastralNumber);
      assertUniqueNumber(data, fields.cadastralNumber, id);
    }
    Object.assign(plot, fields, { updatedAt: new Date().toISOString() });
    if (!plot.district.trim()) plot.district = districtsByCode(data.plots).get(plot.cadastralNumber.slice(0, 5)) ?? districtByCadastralNumber(plot.cadastralNumber) ?? "";
    return plot;
  });
}

// excluded — отсеяно по торгам и в реестр не попало (в том числе убранные из реестра); excludedBefore — номера НСПД, отсеянные раньше
export type ImportResult = {
  created: number;
  skipped: string[];
  updated: number;
  absentMarked: number;
  excluded: number;
  excludedBefore: number;
  sourceId: string;
};

// Участок из выгрузки торгов: номер плюс то, что о нём известно из лота
// exclude — у участка есть претендент или идёт аукцион; torgiCheckedAt — по выгрузке видно, что торгов нет
type ImportItem = {
  cadastralNumber: string;
  owner?: Owner;
  areaHa?: number;
  note?: string;
  exclude?: boolean;
  torgiCheckedAt?: string;
  lotDate?: string;
};

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function cleanImportItems(value: unknown): ImportItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const item = v as Record<string, unknown>;
    const cadastralNumber = normalizeCadastralNumber(String(item.cadastralNumber ?? ""));
    if (!/^\d{2}:\d{2}:\d{7}:\d+$/.test(cadastralNumber)) return [];
    const area = Number(item.areaHa);
    return [
      {
        cadastralNumber,
        owner: typeof item.owner === "string" && item.owner in owners ? (item.owner as Owner) : undefined,
        areaHa: Number.isFinite(area) && area > 0 ? area : undefined,
        note: typeof item.note === "string" ? item.note.slice(0, 2000) : undefined,
        exclude: item.exclude === true,
        torgiCheckedAt: isDay(item.torgiCheckedAt) ? item.torgiCheckedAt : undefined,
        lotDate: isDay(item.lotDate) ? item.lotDate : undefined,
      },
    ];
  });
}

// Полная выгрузка торгов годится для отметки новых участков, пока ей не больше TORGI_EXPORT_FRESH_DAYS дней
function torgiExportFresh(date: string) {
  return Date.now() - new Date(`${date}T00:00:00`).getTime() <= TORGI_EXPORT_FRESH_DAYS * 86_400_000;
}

// Массовое добавление кандидатов по списку кадастровых номеров (выгрузка НСПД и т. п.).
// Уже известные номера пропускаем; район подставляем по коду кадастрового района (60:10 → как у других участков).
export function importPlots(input: {
  numbers?: unknown;
  items?: unknown;
  sourceName?: unknown;
  sourceType?: unknown;
  owner?: unknown;
  // Выгрузка torgi.gov.ru со всеми торгами по сельхозземле: участкам этих районов, которых в ней нет, ставим отметку
  absentDistrictCodes?: unknown;
  absentCheckedAt?: unknown;
  // Все номера с лотами в этой выгрузке — запоминаем, чтобы отмечать и участки, добавленные позже
  exportNumbers?: unknown;
}): Promise<ImportResult> {
  return mutate((data) => {
    const now = new Date().toISOString();
    const numbers = [...new Set((Array.isArray(input.numbers) ? input.numbers : []).map((n) => normalizeCadastralNumber(String(n))))].filter(
      (n) => /^\d{2}:\d{2}:\d{7}:\d+$/.test(n),
    );
    const items = new Map<string, ImportItem>(numbers.map((n) => [n, { cadastralNumber: n }]));
    for (const item of cleanImportItems(input.items)) items.set(item.cadastralNumber, item);
    const fromTorgi = input.sourceType === "auction";
    const known = new Set(data.plots.map((p) => normalizeCadastralNumber(p.cadastralNumber)));

    const sourceName = String(input.sourceName ?? "").trim() || "НСПД";
    let source = data.sources.find((s) => s.name === sourceName);
    if (!source) {
      source = {
        ...emptySource(),
        name: sourceName,
        type: fromTorgi ? "auction" : "map",
        url: fromTorgi ? "https://torgi.gov.ru/new/public/lots/reg" : "https://nspd.gov.ru/map?thematic=PKK",
        notes: fromTorgi
          ? "Выгрузка реестра лотов torgi.gov.ru. По каждому участку в заметках — последний лот; проверьте протокол."
          : "Список номеров из поиска НСПД. Сведения по участкам заполняются вставкой карточки НСПД.",
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      data.sources.push(source);
    }

    const districts = districtsByCode(data.plots);
    const owner = typeof input.owner === "string" && input.owner in owners ? (input.owner as Owner) : "unknown";

    const skipped: string[] = [];
    let created = 0;
    let updated = 0;
    let excluded = 0;
    let excludedBefore = 0;
    const torgiExcluded = data.settings.torgiExcluded;
    const listNote = `Добавлен списком из ${fromTorgi ? "выгрузки torgi.gov.ru" : "НСПД"}. Откройте карточку участка в НСПД и вставьте её текст — поля заполнятся.`;
    for (const [number, item] of items) {
      if (fromTorgi) {
        const stored = torgiExcluded[number];
        if (item.exclude) {
          // Участок занят по торгам — в реестр не заносим, уже известный убираем (если лот не старее учтённого)
          const plot = data.plots.find((p) => normalizeCadastralNumber(p.cadastralNumber) === number);
          if (plot && item.lotDate && plot.torgiLotDate && item.lotDate < plot.torgiLotDate) {
            skipped.push(number);
            continue;
          }
          if (stored === undefined || !item.lotDate || item.lotDate >= stored) torgiExcluded[number] = item.lotDate ?? stored ?? "";
          if (plot) {
            data.plots = data.plots.filter((p) => p !== plot);
            known.delete(number);
          }
          excluded++;
          continue;
        }
        // Свежий лот без претендента — участок снова может быть свободен
        if (stored !== undefined) {
          if (!item.lotDate || item.lotDate < stored) {
            excluded++;
            continue;
          }
          delete torgiExcluded[number];
        }
      } else if (torgiExcluded[number] !== undefined && !known.has(number)) {
        excludedBefore++;
        continue;
      }
      if (known.has(number)) {
        skipped.push(number);
        // Уже известному участку дописываем сведения о торгах, если такой записи ещё нет
        const plot = data.plots.find((p) => normalizeCadastralNumber(p.cadastralNumber) === number);
        if (!plot) continue;
        const link = item.note?.match(/https:\/\/\S+/)?.[0];
        let changed = false;
        if (item.note && !(link && plot.notes.includes(link))) {
          plot.notes = [plot.notes.trim(), item.note].filter(Boolean).join("\n");
          changed = true;
        }
        // Выгрузка старее уже учтённого лота — отметки не меняем, только заметку
        if (item.lotDate && plot.torgiLotDate && item.lotDate < plot.torgiLotDate) {
          if (changed) {
            plot.updatedAt = now;
            updated++;
          }
          continue;
        }
        if (item.lotDate && plot.torgiLotDate !== item.lotDate) {
          plot.torgiLotDate = item.lotDate;
          changed = true;
        }
        if (item.torgiCheckedAt && plot.torgiCheckedAt !== item.torgiCheckedAt) {
          plot.torgiCheckedAt = item.torgiCheckedAt;
          changed = true;
        }
        if (changed) {
          plot.updatedAt = now;
          updated++;
        }
        continue;
      }
      data.plots.push({
        ...emptyPlot(),
        cadastralNumber: number,
        region: regionByCadastralNumber(number) ?? emptyPlot().region,
        district: districts.get(number.slice(0, 5)) ?? districtByCadastralNumber(number) ?? "",
        owner: item.owner ?? owner,
        areaHa: item.areaHa ?? null,
        checks: emptyChecks(),
        torgiCheckedAt: item.torgiCheckedAt ?? null,
        torgiLotDate: item.lotDate ?? null,
        sourceId: source.id,
        notes: [listNote, item.note].filter(Boolean).join("\n"),
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      known.add(number);
      created++;
    }
    // Участки районов из выгрузки, которых в ней нет: по ним торгов не было (на дату выгрузки).
    // Полную выгрузку запоминаем; при импорте списков НСПД так же отмечаем новые участки, пока выгрузка свежая.
    let absentMarked = 0;
    let absent: { day: string; codes: Set<string>; numbers: Set<string>; onlyNew: boolean } | null = null;
    const absentCodes = Array.isArray(input.absentDistrictCodes) ? input.absentDistrictCodes.map(String) : [];
    if (fromTorgi && absentCodes.length && isDay(input.absentCheckedAt)) {
      const exportNumbers = (Array.isArray(input.exportNumbers) ? input.exportNumbers : []).map((n) => normalizeCadastralNumber(String(n)));
      const numbersSet = new Set([...exportNumbers, ...items.keys()]);
      data.settings.torgiExport = { date: input.absentCheckedAt, districtCodes: absentCodes, numbers: [...numbersSet] };
      absent = { day: input.absentCheckedAt, codes: new Set(absentCodes), numbers: numbersSet, onlyNew: false };
    } else if (!fromTorgi && data.settings.torgiExport && torgiExportFresh(data.settings.torgiExport.date)) {
      const info = data.settings.torgiExport;
      absent = { day: info.date, codes: new Set(info.districtCodes), numbers: new Set(info.numbers), onlyNew: true };
    }
    if (absent) {
      const day = absent.day;
      for (const plot of data.plots) {
        const number = normalizeCadastralNumber(plot.cadastralNumber);
        if (!absent.codes.has(number.slice(0, 5)) || absent.numbers.has(number)) continue;
        if (absent.onlyNew && plot.createdAt !== now) continue;
        if (plot.torgiCheckedAt || plot.checks.rights === "no") continue;
        plot.torgiCheckedAt = day;
        plot.notes = [plot.notes.trim(), `torgi.gov.ru, выгрузка от ${day.split("-").reverse().join(".")}: лотов по участку нет.`]
          .filter(Boolean)
          .join("\n");
        plot.updatedAt = now;
        absentMarked++;
      }
    }
    if (items.size) {
      const codes = new Set([...items.keys()].map((n) => n.slice(0, 5)));
      if (fromTorgi) for (const code of absentCodes) codes.add(code);
      data.settings.imports.push({
        kind: fromTorgi ? "torgi" : "nspd",
        date: now.slice(0, 10),
        districtCodes: [...codes].sort(),
        numbers: items.size,
        ...(fromTorgi && absent ? { complete: true } : {}),
      });
    }
    return { created, skipped, updated, absentMarked, excluded, excludedBefore, sourceId: source.id };
  });
}

export function updateApplicant(input: unknown) {
  return mutate((data) => {
    const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    for (const key of Object.keys(emptyApplicant) as (keyof Applicant)[]) {
      if (typeof value[key] === "string") data.settings.applicant[key] = (value[key] as string).slice(0, 500);
    }
    return data.settings;
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
