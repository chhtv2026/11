// Типы и справочники реестра. Файл без серверных импортов — его использует и интерфейс.
import { emptyEconomics, type Economics } from "./economics";

export const sourceTypes = {
  fund: "Фонд перераспределения земель",
  publicRegistry: "Реестр публичной собственности",
  municipal: "Муниципальный перечень свободных земель",
  auction: "Торги / несостоявшиеся аукционы",
  shares: "Невостребованные земельные доли",
  map: "Картографический ресурс (НСПД и др.)",
  other: "Другое",
} as const;
export type SourceType = keyof typeof sourceTypes;

export const plotStatuses = {
  found: "Найден",
  checking: "На проверке",
  promising: "Перспективный",
  applying: "Оформление",
  leased: "В аренде",
  bought: "Выкуплен",
  rejected: "Отклонён",
} as const;
export type PlotStatus = keyof typeof plotStatuses;

// Направления поиска из концепции: А — участок уже сформирован, Б — ещё нет
export const plotDirections = {
  formed: "А. Сформирован (есть кадастровый номер)",
  unformed: "Б. Не сформирован (территория-кандидат)",
} as const;
export type PlotDirection = keyof typeof plotDirections;

export const owners = {
  unknown: "Не установлен",
  federal: "Российская Федерация",
  region: "Субъект РФ",
  municipal: "Муниципалитет",
  undelimited: "Гос. собственность не разграничена",
  private: "Частная",
} as const;
export type Owner = keyof typeof owners;

// Оценка участка в два шага (см. концепцию, п. 7): сначала жёсткие стоп-факторы, потом баллы
export const stopFactors = {
  category: "Категория — земли сельскохозяйственного назначения",
  rights: "Нет прав третьих лиц, мешающих предоставлению",
  route: "Есть законный способ получить участок именно вам",
  restrictions: "Нет ограничений, запрещающих сельхозиспользование (ООПТ, ЗОУИТ и т. п.)",
  access: "Есть физический подъезд к участку",
} as const;
export type StopFactor = keyof typeof stopFactors;
export type CheckValue = "unknown" | "yes" | "no";
export const checkValues: Record<CheckValue, string> = { unknown: "не проверено", yes: "да", no: "нет" };

export const criteria = {
  legal: { label: "Юридическая определённость", low: "статус и маршрут неясны", high: "собственник и маршрут подтверждены документами" },
  economics: { label: "Экономика аренды и выкупа", low: "дорого или выкуп сомнителен", high: "низкая аренда, понятный выгодный выкуп" },
  usageCost: { label: "Затраты на сельхозиспользование", low: "зарос, нужна расчистка", high: "можно сразу косить или пасти" },
  liquidity: { label: "Ликвидность и рыночный спрос", low: "продать или сдать трудно", high: "высокий спрос поблизости" },
  potential: { label: "Потенциал развития", low: "глушь, нет дорог и сетей", high: "дороги, сети, рядом населённые пункты" },
} as const;
export type Criterion = keyof typeof criteria;
export type Weights = Record<Criterion, number>;

// Условные веса из концепции; подлежат проверке на реальных случаях
export const defaultWeights: Weights = { legal: 30, economics: 25, usageCost: 20, liquidity: 15, potential: 10 };

export type Settings = { weights: Weights };

export function emptyChecks(): Record<StopFactor, CheckValue> {
  return { category: "unknown", rights: "unknown", route: "unknown", restrictions: "unknown", access: "unknown" };
}

export type Assessment =
  | { kind: "excluded"; reasons: StopFactor[] }
  | { kind: "incomplete"; rated: number }
  | { kind: "scored"; score: number; checksDone: boolean };

export function assess(plot: Pick<Plot, "checks" | "scores">, weights: Weights): Assessment {
  const reasons = (Object.keys(stopFactors) as StopFactor[]).filter((k) => plot.checks[k] === "no");
  if (reasons.length) return { kind: "excluded", reasons };
  const keys = Object.keys(criteria) as Criterion[];
  const rated = keys.filter((k) => plot.scores[k]);
  if (rated.length < keys.length) return { kind: "incomplete", rated: rated.length };
  const total = keys.reduce((sum, k) => sum + weights[k], 0) || 1;
  const score = keys.reduce((sum, k) => sum + (weights[k] * plot.scores[k]!) / 5, 0) / total;
  const checksDone = (Object.keys(stopFactors) as StopFactor[]).every((k) => plot.checks[k] === "yes");
  return { kind: "scored", score: Math.round(score * 100), checksDone };
}

// Правовой маршрут (концепция, п. 5): последовательность вопросов по каждому участку
export const routeSteps = {
  applicant: {
    label: "Заявитель",
    hint: "кто подаёт и соответствует ли требованиям",
    options: ["Гражданин", "ИП", "КФХ", "Юридическое лицо"],
  },
  plotState: {
    label: "Состояние участка",
    hint: "сформирован, нужны уточнение границ или образование",
    options: ["Сформирован", "Нужно уточнить границы", "Нужно образовать участок"],
  },
  method: {
    label: "Способ предоставления",
    hint: "без торгов, через торги или иной законный механизм",
    options: ["Без торгов", "Через торги", "Иной механизм"],
  },
  basis: { label: "Основание", hint: "конкретная статья и пункт закона", options: [] },
  authority: { label: "Куда подавать", hint: "компетентный орган", options: [] },
  submission: { label: "Подача", hint: "документы, форма заявления, срок рассмотрения", options: [] },
  refusal: { label: "Если отказ", hint: "законна ли мотивировка, как обжаловать", options: [] },
  nextSteps: { label: "Дальнейшее оформление", hint: "кадастровые работы, регистрация, договор, обязанности", options: [] },
} as const;
export type RouteStep = keyof typeof routeSteps;
export type RouteEntry = { value: string; done: boolean };

export function emptyRoute(): Record<RouteStep, RouteEntry> {
  return Object.fromEntries((Object.keys(routeSteps) as RouteStep[]).map((k) => [k, { value: "", done: false }])) as Record<
    RouteStep,
    RouteEntry
  >;
}

// Срок или событие по участку
export type Deadline = { id: string; date: string; title: string; done: boolean };

// Быстрые шаблоны сроков из концепции. Отсчёт — от даты, которую указывает пользователь.
// Конкретные сроки по своему участку всё равно нужно сверить с законом и документами.
export const deadlinePresets = [
  { title: "Истекает решение о предварительном согласовании (ст. 39.15 ЗК РФ, общий случай — 1 год)", months: 12, from: "дата решения" },
  { title: "Возникает право выкупа без торгов (3 года аренды, ст. 39.3 ЗК РФ — проверить условия)", months: 36, from: "дата договора аренды" },
] as const;

export function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // 29 февраля или 31-е число: если такого дня нет, берём последний день месяца
  if (d.getDate() !== day) d.setDate(0);
  // Локальная дата, без перевода в UTC — иначе в Москве съезжает на день назад
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type Source = {
  id: string;
  name: string;
  type: SourceType;
  region: string;
  url: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
export type SourceInput = Omit<Source, "id" | "createdAt" | "updatedAt">;

// Правовой вывод по участку; пока не проверен — на него нельзя опираться
export type Finding = {
  id: string;
  text: string;
  basis: string;
  verified: boolean;
  createdAt: string;
};

export type Plot = {
  id: string;
  cadastralNumber: string;
  title: string;
  region: string;
  district: string;
  areaHa: number | null;
  landCategory: string;
  permittedUse: string;
  owner: Owner;
  direction: PlotDirection;
  status: PlotStatus;
  sourceId: string;
  links: string;
  notes: string;
  findings: Finding[];
  checks: Record<StopFactor, CheckValue>;
  // Баллы 1–5; критерий без балла ещё не оценён
  scores: Partial<Record<Criterion, number>>;
  economics: Economics;
  route: Record<RouteStep, RouteEntry>;
  deadlines: Deadline[];
  createdAt: string;
  updatedAt: string;
};
export type PlotInput = Omit<Plot, "id" | "createdAt" | "updatedAt">;

export const defaultRegion = "Псковская область";

export function emptySource(): SourceInput {
  return { name: "", type: "fund", region: defaultRegion, url: "", notes: "" };
}

export function emptyPlot(): PlotInput {
  return {
    cadastralNumber: "",
    title: "",
    region: defaultRegion,
    district: "",
    areaHa: null,
    landCategory: "Земли сельскохозяйственного назначения",
    permittedUse: "",
    owner: "unknown",
    direction: "formed",
    status: "found",
    sourceId: "",
    links: "",
    notes: "",
    findings: [],
    checks: emptyChecks(),
    scores: {},
    economics: emptyEconomics(),
    route: emptyRoute(),
    deadlines: [],
  };
}
