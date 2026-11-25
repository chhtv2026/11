// Участок, которого ещё нет в ЕГРН: контур на свободной земле, нарисованный для схемы расположения
// и заявления о предварительном согласовании (ст. 39.15 ЗК РФ). Координаты — WGS84, как на картах.

export type SchemePoint = { lat: number; lon: number };
export type Scheme = {
  // Кадастровый квартал, в котором лежит контур (60:19:0024502) — по нему заказывают КПТ для схемы
  quarter: string;
  points: SchemePoint[];
  // Когда контур сверен со слоями участков НСПД (ЕГРН, чужие схемы, проекты межевания, аукционы, границы НП)
  checkedAt: string | null;
};

export function emptyScheme(): Scheme {
  return { quarter: "", points: [], checkedAt: null };
}

// Участок по схеме, ещё не поставленный на учёт: у него нет кадастрового номера
export function isPendingScheme(plot: { scheme?: Scheme | null; cadastralNumber?: string }) {
  return Boolean(plot.scheme) && !plot.cadastralNumber?.trim();
}

const QUARTER = /^\d{2}:\d{2}:\d{6,7}$/;
export const validQuarter = (q: string) => QUARTER.test(q.trim());

// Одна вершина на строку: «56.419393, 29.215552», «56,419393; 29,215552» или строка таблицы «1 | 56.419393 | 29.215552»
export function parseSchemePoints(text: string): { points: SchemePoint[]; bad: number[] } {
  const points: SchemePoint[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let nums = line.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length !== 2 && nums.length !== 3) nums = line.replace(/(\d),(\d)/g, "$1.$2").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    // Номер вершины в начале строки отбрасываем
    if (nums.length === 3 && Number.isInteger(nums[0]) && nums[0] < 1000) nums = nums.slice(1);
    const [lat, lon] = nums;
    if (nums.length === 2 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) points.push({ lat, lon });
    else bad.push(i + 1);
  });
  // Последняя вершина, повторяющая первую (замкнутый контур), не нужна
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 3 && first.lat === last.lat && first.lon === last.lon) points.pop();
  return { points, bad };
}

export const schemePointsText = (points: SchemePoint[]) => points.map((p) => `${p.lat}, ${p.lon}`).join("\n");

export function schemeCenter(points: SchemePoint[]): SchemePoint | null {
  if (!points.length) return null;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    lat: round(points.reduce((s, p) => s + p.lat, 0) / points.length),
    lon: round(points.reduce((s, p) => s + p.lon, 0) / points.length),
  };
}

// Площадь и периметр в местной плоской проекции — для участков в несколько километров погрешность доли процента
export function schemeMeasure(points: SchemePoint[]): { areaHa: number; perimeterM: number } | null {
  if (points.length < 3) return null;
  const R = 6371008.8;
  const lat0 = (points.reduce((s, p) => s + p.lat, 0) / points.length) * (Math.PI / 180);
  const xy = points.map((p) => ({ x: R * Math.cos(lat0) * p.lon * (Math.PI / 180), y: R * p.lat * (Math.PI / 180) }));
  let twice = 0;
  let perimeter = 0;
  xy.forEach((a, i) => {
    const b = xy[(i + 1) % xy.length];
    twice += a.x * b.y - b.x * a.y;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  });
  return { areaHa: Math.round(Math.abs(twice) / 2 / 100) / 100, perimeterM: Math.round(perimeter) };
}

// Пересекаются ли стороны контура (нарисован «восьмёркой») — тогда площадь считается неверно
export function schemeSelfCrossing(points: SchemePoint[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const cross = (o: SchemePoint, a: SchemePoint, b: SchemePoint) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

const ring = (points: SchemePoint[]) => [...points, points[0]];

export function schemeGeoJson(points: SchemePoint[], name: string): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name },
          geometry: { type: "Polygon", coordinates: [ring(points).map((p) => [p.lon, p.lat])] },
        },
      ],
    },
    null,
    2,
  );
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// KML открывают Google Earth, Яндекс Конструктор карт и большинство ГИС
export function schemeKml(points: SchemePoint[], name: string): string {
  const coords = ring(points)
    .map((p) => `${p.lon},${p.lat},0`)
    .join(" ");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
    `<Placemark><name>${xml(name)}</name>`,
    '<Style><LineStyle><color>ff0000ff</color><width>3</width></LineStyle><PolyStyle><color>330000ff</color></PolyStyle></Style>',
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`,
    "</Placemark></Document></kml>",
  ].join("\n");
}

// Для хранилища: только корректные вершины, не больше 500
export function cleanScheme(input: unknown): Scheme | null {
  if (!input || typeof input !== "object") return null;
  const s = input as Partial<Scheme>;
  const points = (Array.isArray(s.points) ? s.points : [])
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
    .slice(0, 500);
  const quarter = String(s.quarter ?? "").trim().slice(0, 20);
  const checkedAt = typeof s.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.checkedAt) ? s.checkedAt : null;
  return { quarter, points, checkedAt };
}
