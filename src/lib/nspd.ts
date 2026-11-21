// Разбор того, что пользователь копирует из НСПД (nspd.gov.ru): список кадастровых номеров
// из «Скачать список объектов» и текст карточки участка. Сами с сайта ничего не скачиваем.
import type { Owner } from "./registry";

// Квартал дополняем нулями до 7 цифр — так номера записаны в ЕГРН и в нашем реестре
export function normalizeCadastralNumber(value: string) {
  const m = value.trim().match(/^(\d{2}):(\d{2}):(\d{1,7}):(\d+)$/);
  return m ? `${m[1]}:${m[2]}:${m[3].padStart(7, "0")}:${m[4]}` : value.trim();
}

// Номера участков из любого текста (CSV выгрузки, список, письмо); части участка «…:611/1» пропускаем
export function extractCadastralNumbers(text: string): string[] {
  const found = text.match(/(?<![\d:])\d{2}:\d{2}:\d{1,7}:\d+(?![\d/:])/g) ?? [];
  return [...new Set(found.map(normalizeCadastralNumber))];
}

const cardLabels = [
  "Вид объекта недвижимости",
  "Вид земельного участка",
  "Дата присвоения",
  "Кадастровый номер",
  "Кадастровый квартал",
  "Адрес",
  "Площадь уточненная",
  "Площадь декларированная",
  "Площадь",
  "Статус",
  "Категория земель",
  "Вид разрешенного использования",
  "Форма собственности",
  "Кадастровая стоимость",
  "Удельный показатель кадастровой стоимости",
  "Предоставление сведений ЕГРН",
  "Список объектов",
  "Части земельного участка",
  "Состав ЕЗП не найден",
];

function parseNumber(text: string) {
  const value = Number(text.replace(/[\s ]/g, "").replace(",", ".").match(/[\d.]+/)?.[0]);
  return Number.isFinite(value) ? value : null;
}

function parseOwner(text: string): Owner | null {
  const t = text.toLowerCase();
  if (t.includes("не разграничен") || t.includes("неразграничен")) return "undelimited";
  if (t.includes("субъект")) return "region";
  if (t.includes("муниципальн")) return "municipal";
  if (t.includes("российской федерации") || t.includes("федеральн")) return "federal";
  if (t.includes("частн")) return "private";
  return null;
}

export type NspdCard = {
  cadastralNumber?: string;
  address?: string;
  district?: string;
  areaHa?: number;
  landCategory?: string;
  permittedUse?: string;
  ownerText?: string;
  owner?: Owner;
  cadastralValue?: number;
  // Номера частей участка: часто это обременения или зоны, их нужно смотреть в выписке ЕГРН
  parts: string[];
};

export function parseNspdCard(text: string): NspdCard {
  // Скопированная карточка — строки «название поля» и «значение» (иногда через табуляцию)
  const lines = text
    .replace(/\r/g, "")
    .split(/[\n\t]/)
    .map((l) => l.trim())
    .filter((l) => l && l !== "Развернуть" && l !== "Свернуть");
  const values: Record<string, string> = {};
  let label: string | null = null;
  for (const line of lines) {
    const known = cardLabels.find((l) => line.toLowerCase() === l.toLowerCase() || line.toLowerCase() === `${l.toLowerCase()}:`);
    if (known) {
      label = known;
      values[label] ??= "";
    } else if (label) {
      values[label] = values[label] ? `${values[label]} ${line}` : line;
    }
  }

  const card: NspdCard = { parts: text.match(/\d{2}:\d{2}:\d{1,7}:\d+\/\d+/g) ?? [] };
  const number = values["Кадастровый номер"] && extractCadastralNumbers(values["Кадастровый номер"])[0];
  if (number) card.cadastralNumber = number;
  if (values["Адрес"]) {
    card.address = values["Адрес"];
    const district = card.address.match(/([А-ЯЁ][а-яё-]+)\s+(?:р-н|район)/);
    if (district) card.district = `${district[1]} район`;
  }
  const area = values["Площадь уточненная"] || values["Площадь декларированная"] || values["Площадь"];
  if (area) {
    const value = parseNumber(area);
    // В НСПД площадь в квадратных метрах; в реестре — в гектарах
    if (value !== null) card.areaHa = /га/.test(area) ? value : Math.round(value) / 10_000;
  }
  if (values["Категория земель"]) card.landCategory = values["Категория земель"];
  if (values["Вид разрешенного использования"]) card.permittedUse = values["Вид разрешенного использования"];
  if (values["Форма собственности"]) {
    card.ownerText = values["Форма собственности"];
    card.owner = parseOwner(card.ownerText) ?? undefined;
  }
  if (values["Кадастровая стоимость"]) {
    const value = parseNumber(values["Кадастровая стоимость"]);
    if (value !== null) card.cadastralValue = value;
  }
  return card;
}

export function isAgriculturalLand(category: string) {
  return /сельскохозяйственного назначения/i.test(category);
}
