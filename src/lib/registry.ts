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
  };
}
