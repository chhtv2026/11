// Осмотр участка по карте: вода рядом и что из неё следует по Водному кодексу.
// Ширина зон — по закону, без учёта того, внесены ли они в ЕГРН: водоохранные зоны и прибрежные полосы
// действуют прямо по ВК, береговая полоса — общего пользования.

export const waterKinds = {
  river: "река",
  stream: "ручей",
  lake: "озеро",
  pond: "пруд",
  swamp: "болото",
  ditch: "канава / мелиоративный канал",
} as const;
export type WaterKind = keyof typeof waterKinds;

// size: для реки и ручья — длина от истока до устья, км; для озера и пруда — площадь зеркала, км²
export type WaterItem = { kind: WaterKind; name: string; distanceM: number | null; size: number | null };

export const accessKinds = {
  "": "не смотрели",
  road: "есть дорога к участку",
  track: "грунтовка / полевая дорога",
  none: "подъезда не видно",
} as const;
export type AccessKind = keyof typeof accessKinds;

// Зарастание: степень и доля площади на глаз (по космоснимку). forest — признаки леса по ПП РФ № 1509:
// деревья выше 5 м, покров больше 75 % площади, сомкнутость крон 0,8–1
export const overgrowthKinds = {
  "": "не смотрели",
  clean: "чистое поле / луг",
  partial: "местами кустарник",
  dense: "сплошь кустарник, молодой лес",
  forest: "лес: деревья выше 5 м, сомкнутый",
} as const;
export type OvergrowthKind = keyof typeof overgrowthKinds;

export type Survey = {
  water: WaterItem[];
  overgrowth: OvergrowthKind;
  // Доля заросшей площади, % (на глаз)
  overgrownShare: number | null;
  access: AccessKind;
  note: string;
  // Точка внутри участка (WGS84) — чтобы открывать снимки сразу на месте
  lat: number | null;
  lon: number | null;
};

export function emptySurvey(): Survey {
  return { water: [], overgrowth: "", overgrownShare: null, access: "", note: "", lat: null, lon: null };
}

// Доля зарастания: указанная или типичная для степени
export function overgrownPercent(s: Pick<Survey, "overgrowth" | "overgrownShare">): number | null {
  if (s.overgrownShare !== null) return s.overgrownShare;
  return { "": null, clean: 0, partial: 20, dense: 80, forest: 100 }[s.overgrowth];
}

// Подсказка балла «Затраты на сельхозиспользование» (5 — можно сразу косить, 1 — зарос, нужна расчистка)
export function usageCostSuggestion(s: Pick<Survey, "overgrowth" | "overgrownShare">): number | null {
  if (!s.overgrowth) return null;
  if (s.overgrowth === "clean") return 5;
  if (s.overgrowth === "forest") return 1;
  const share = overgrownPercent(s) ?? 0;
  if (s.overgrowth === "dense") return share >= 50 ? 1 : 2;
  return share <= 15 ? 4 : share < 50 ? 3 : 2;
}

export const sizeLabel = (kind: WaterKind) =>
  kind === "river" || kind === "stream" ? "длина, км" : kind === "lake" || kind === "pond" ? "площадь, км²" : null;

export type WaterStrips = {
  // Водоохранная зона, м (null — не установлена или не определить без размера)
  protection: number | null;
  protectionNote: string;
  // Прибрежная защитная полоса, м: 30–50 по уклону берега, берём наибольшую
  coastal: number | null;
  // Береговая полоса общего пользования, м
  shore: number | null;
  // Задевает ли участок хоть одна полоса (null — расстояние или размер неизвестны)
  touches: boolean | null;
};

export function waterStrips(w: WaterItem): WaterStrips {
  let protection: number | null = null;
  let protectionNote = "";
  let shore: number | null = 20;
  if (w.kind === "river" || w.kind === "stream") {
    const length = w.size ?? (w.kind === "stream" ? 5 : null);
    if (length === null) protectionNote = "50–200 м в зависимости от длины реки (ВК ст. 65 ч. 4) — укажите длину";
    else {
      protection = length < 10 ? 50 : length < 50 ? 100 : 200;
      protectionNote = `${protection} м — ${w.kind === "stream" && w.size === null ? "ручей, длина не указана, считаю до 10 км" : `длина ${length < 10 ? "до 10" : length < 50 ? "10–50" : "от 50"} км`} (ВК ст. 65 ч. 4)`;
    }
    if (length !== null && length <= 10) shore = 5;
  } else if (w.kind === "lake" || w.kind === "pond") {
    if (w.size === null) protectionNote = "50 м, если площадь от 0,5 км² (ВК ст. 65 ч. 6) — укажите площадь";
    else if (w.size >= 0.5) {
      protection = 50;
      protectionNote = "50 м — площадь от 0,5 км² (ВК ст. 65 ч. 6)";
    } else protectionNote = "не устанавливается — площадь меньше 0,5 км² (ВК ст. 65 ч. 6)";
  } else if (w.kind === "swamp") {
    shore = null;
    protectionNote = "для болота ширина не задана; проточные и сточные озёра в болоте — прибрежная полоса 50 м (ВК ст. 65 ч. 12)";
  } else {
    shore = 5;
    protectionNote = "у мелиоративного канала водоохранная зона совпадает с полосой отвода (ВК ст. 65 ч. 9) — по карте не определить";
  }
  const coastal = protection === null ? null : Math.min(50, protection);
  const widest = Math.max(protection ?? 0, shore ?? 0);
  // Размер не указан: если вода дальше самой широкой возможной зоны (река — 200 м, озеро — 50 м), ответ ясен и так
  const sizeMissing = protection === null && protectionNote.includes("укажите");
  const maxPossible = w.kind === "river" ? 200 : 50;
  if (w.distanceM === null) return { protection, protectionNote, coastal, shore, touches: null };
  if (sizeMissing) {
    return { protection, protectionNote, coastal, shore, touches: w.distanceM >= maxPossible ? false : null };
  }
  return { protection, protectionNote, coastal, shore, touches: w.distanceM < widest };
}

// Одной строкой: что значит эта вода для участка
export function waterSummary(w: WaterItem) {
  const s = waterStrips(w);
  const name = `${waterKinds[w.kind]}${w.name.trim() ? ` ${w.name.trim()}` : ""}`;
  const where = w.distanceM === null ? "расстояние не указано" : w.distanceM === 0 ? "на участке" : `в ${w.distanceM} м от участка`;
  const parts = [`водоохранная зона: ${s.protectionNote}`];
  if (s.coastal !== null) parts.push(`прибрежная полоса до ${s.coastal} м (30–50 м по уклону берега, ВК ст. 65 ч. 11)`);
  if (s.shore !== null) parts.push(`береговая полоса ${s.shore} м (ВК ст. 6 ч. 6)`);
  const d = w.distanceM ?? Infinity;
  const reach = [
    s.protection !== null && d < s.protection && "водоохранная зона",
    s.coastal !== null && d < s.coastal && "прибрежная полоса (не пахать, не пасти скот)",
    s.shore !== null && d < s.shore && "береговая полоса (общего пользования)",
  ].filter(Boolean);
  const verdict =
    s.touches === null
      ? "задевает ли участок — не определить"
      : s.touches
        ? `на участок заходит: ${reach.join(", ")}`
        : "до участка полосы не доходят";
  return `${name}, ${where}: ${parts.join("; ")} — ${verdict}.`;
}

// «56.40828, 29.22773» (как копируют из Яндекс/Google Карт) → широта и долгота
export function parsePoint(text: string): { lat: number; lon: number } | null {
  const numbers = (t: string) => t.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  // Сначала с точкой как разделителем дробей, иначе — с запятой («56,40828; 29,22773»)
  let nums = numbers(text);
  if (nums.length !== 2) nums = numbers(text.replace(/(\d),(\d)/g, "$1.$2"));
  if (nums.length !== 2) return null;
  const [lat, lon] = nums;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Космоснимок Яндекс Карт с меткой на участке
export function yandexSatelliteUrl(lat: number, lon: number): string {
  const ll = `${lon}%2C${lat}`;
  return `https://yandex.ru/maps/?ll=${ll}&z=16&l=sat&pt=${ll}%2Cpm2rdm`;
}

// Карта НСПД с центром на участке (координаты в веб-Меркаторе). Подложку НСПД при загрузке всегда сбрасывает на схему
export function nspdPointUrl(lat: number, lon: number): string {
  const R = 6378137;
  const x = Math.round((lon * Math.PI * R) / 180);
  const y = Math.round(R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)));
  return `https://nspd.gov.ru/map?thematic=PKK&coordinate_x=${x}&coordinate_y=${y}&zoom=16`;
}
