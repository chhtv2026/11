// Типы и справочники реестра. Файл без серверных импортов — его использует и интерфейс.

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
  };
}
