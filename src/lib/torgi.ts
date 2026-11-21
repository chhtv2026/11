// Разбор Excel-выгрузки «Реестра лотов» torgi.gov.ru (синий значок над списком). Файл .xlsx — ZIP с XML;
// сюда приходят уже распакованные sharedStrings.xml и лист. Разбирается в браузере (DOMParser).
import { normalizeCadastralNumber } from "./nspd";
import type { Owner } from "./registry";

export const TORGI_LOTS = "https://torgi.gov.ru/new/public/lots/reg";

// Что показывает самый свежий лот по участку
export const torgiOutcomes = {
  active: "идёт аукцион (объявлен, приём заявок)",
  won: "аукцион состоялся или определяется победитель",
  single: "не состоялся, одна заявка (указана итоговая цена)",
  free: "не состоялся, итоговой цены нет — заявок, скорее всего, не было",
  cancelled: "торги отменены или аннулированы",
  other: "другой статус",
} as const;
export type TorgiOutcome = keyof typeof torgiOutcomes;
// Исключаем: у участка есть претендент или идёт аукцион
export const torgiExcludes: TorgiOutcome[] = ["active", "won", "single"];

export type TorgiItem = {
  cadastralNumber: string;
  owner?: Owner;
  areaHa?: number;
  lots: number;
  outcome: TorgiOutcome;
  // Начало приёма заявок последнего лота, ГГГГ-ММ-ДД
  lotDate?: string;
  note: string;
};

export type TorgiExport = {
  lots: number;
  items: TorgiItem[];
  // Лоты, которые не подходят под 10.1: частная собственность, имущество должников
  privateLots: number;
  privateNumbers: number;
  noNumber: number;
  outcomes: Record<TorgiOutcome, number>;
  // В выгрузке есть не только «Не состоялся» — значит, её делали без фильтра статуса и по ней видно,
  // не выставили ли участок снова. Только тогда ставим отметку «торги проверены».
  allStatuses: boolean;
  // Кадастровые районы (60:19 и т. п.), лоты которых есть в выгрузке, — включая частные
  districtCodes: string[];
  // Все номера участков с лотами, включая частные
  allNumbers: string[];
};

function outcomeOf(status: string, finalPrice: string): TorgiOutcome {
  if (/не\s*состоял/i.test(status)) return finalPrice ? "single" : "free";
  if (/отмен|аннулир/i.test(status)) return "cancelled";
  if (/определение победител|состоял|заверш/i.test(status)) return "won";
  if (/при[её]м заявок|объявлен|опубликован|рассмотрени|приостанов|торг|аукцион/i.test(status)) return "active";
  return "other";
}

type Row = Record<string, string>;

function readSheet(sharedXml: string, sheetXml: string): Row[] {
  const parser = new DOMParser();
  const shared = [...parser.parseFromString(sharedXml, "application/xml").getElementsByTagName("si")].map((si) =>
    [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""),
  );
  return [...parser.parseFromString(sheetXml, "application/xml").getElementsByTagName("row")].map((row) => {
    const cells: Row = {};
    for (const c of row.getElementsByTagName("c")) {
      const col = (c.getAttribute("r") ?? "").replace(/\d+/g, "");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      cells[col] =
        c.getAttribute("t") === "s"
          ? (shared[Number(v)] ?? "")
          : c.getAttribute("t") === "inlineStr"
            ? [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("")
            : v;
    }
    return cells;
  });
}

function parseOwner(text: string): Owner | undefined {
  const t = text.toLowerCase();
  if (t.includes("неразграничен")) return "undelimited";
  if (t.includes("субъект")) return "region";
  if (t.includes("муниципальн")) return "municipal";
  if (t.includes("российской федерации") || t.includes("федеральн")) return "federal";
  return undefined;
}

// «24.10.2026 00:00 (МСК)» → «2026-10-24»
const isoDate = (text: string) => text.match(/(\d{2})\.(\d{2})\.(\d{4})/)?.slice(1).reverse().join("-") ?? "";
const shortDate = (text: string) => text.match(/\d{2}\.\d{2}\.\d{4}/)?.[0] ?? "";

// null — это не выгрузка реестра лотов
export function parseTorgiExport(sharedXml: string, sheetXml: string): TorgiExport | null {
  const rows = readSheet(sharedXml, sheetXml);
  const headerAt = rows.findIndex((r) => Object.values(r).includes("Номер извещения") && Object.values(r).includes("Статус лота"));
  if (headerAt < 0) return null;
  // Название колонки → буква; повторяющиеся названия (организатор и правообладатель) берём по первому
  const col: Record<string, string> = {};
  for (const [letter, name] of Object.entries(rows[headerAt])) if (name && !(name in col)) col[name] = letter;
  const get = (r: Row, name: string) => (r[col[name]] ?? "").trim();

  const outcomes = Object.fromEntries(Object.keys(torgiOutcomes).map((k) => [k, 0])) as Record<TorgiOutcome, number>;
  const result: TorgiExport = { lots: 0, items: [], privateLots: 0, privateNumbers: 0, noNumber: 0, outcomes, allStatuses: false, districtCodes: [], allNumbers: [] };
  const codes = new Set<string>();
  const byNumber = new Map<string, Row[]>();
  const privateSet = new Set<string>();
  for (const r of rows.slice(headerAt + 1)) {
    if (!get(r, "Номер извещения")) continue;
    result.lots++;
    if (!/не\s*состоял/i.test(get(r, "Статус лота"))) result.allStatuses = true;
    const text = `${get(r, "Характеристики имущества")} ${get(r, "Описание лота")}`;
    const found =
      get(r, "Характеристики имущества").match(/Кадастровый номер земельного участка\s*:\s*(\d{2}:\d{2}:\d{1,7}:\d+)/)?.[1] ??
      text.match(/(?<![\d:])\d{2}:\d{2}:\d{1,7}:\d+(?![\d/:])/)?.[0];
    if (!found) {
      result.noNumber++;
      continue;
    }
    const number = normalizeCadastralNumber(found);
    codes.add(number.slice(0, 5));
    // По 10.1 предоставляют только государственную и муниципальную землю
    if (/иная/i.test(get(r, "Форма собственности")) || /должник/i.test(get(r, "Вид торгов"))) {
      result.privateLots++;
      privateSet.add(number);
      continue;
    }
    byNumber.set(number, [...(byNumber.get(number) ?? []), r]);
  }
  result.privateNumbers = [...privateSet].filter((n) => !byNumber.has(n)).length;
  result.districtCodes = [...codes].sort();
  result.allNumbers = [...new Set([...byNumber.keys(), ...privateSet])];

  for (const [number, lots] of byNumber) {
    // Решаем по самому свежему лоту: более ранние могли быть до повторного выставления
    const sorted = [...lots].sort((a, b) =>
      isoDate(get(b, "Дата и время начала подачи заявок")).localeCompare(isoDate(get(a, "Дата и время начала подачи заявок"))),
    );
    const last = sorted[0];
    const area = get(last, "Характеристики имущества").match(/Площадь земельного участка\s*:\s*([\d.]+)\s*м/)?.[1];
    const price = Number(get(last, "Начальная цена"));
    const outcome = outcomeOf(get(last, "Статус лота"), get(last, "Итоговая цена"));
    result.outcomes[outcome]++;
    const deal = /аренд/i.test(get(last, "Описание лота")) ? "аренда" : /продаж/i.test(get(last, "Описание лота")) ? "продажа" : "";
    const parts = [
      `torgi.gov.ru: лотов по участку в выгрузке — ${lots.length}.`,
      `Последний: «${get(last, "Статус лота")}»${deal ? `, ${deal}` : ""}, приём заявок ${shortDate(get(last, "Дата и время начала подачи заявок"))}–${shortDate(get(last, "Дата и время окончания подачи заявок"))}${Number.isFinite(price) && price > 0 ? `, начальная цена ${price.toLocaleString("ru-RU")} ₽` : ""}.`,
      `Извещение: ${get(last, "Ссылка на извещение в ОЧ Реестра извещений") || get(last, "Номер извещения")}`,
      {
        single: "Указана итоговая цена — по всей видимости, единственная заявка, договор заключают с этим участником. Участок исключён; если в протоколе другое — верните стоп-фактор «права третьих лиц».",
        free: `Итоговой цены нет — скорее всего, заявок не было, но бывает и так, что участники были, а цену никто не поднял (тогда участок могли ${deal === "продажа" ? "продать" : "передать"}). Подтвердите по протоколу и сверьте собственника в НСПД.`,
        active: "Идёт аукцион — по 10.1 сейчас не получить, участок исключён.",
        won: "Аукцион состоялся или определяется победитель — у участка есть претендент, участок исключён.",
        cancelled: "Торги отменены или аннулированы — посмотрите причину в извещении.",
        other: "Проверьте статус лота на сайте.",
      }[outcome],
    ];
    result.items.push({
      cadastralNumber: number,
      owner: parseOwner(get(last, "Форма собственности")),
      areaHa: area ? Math.round(Number(area)) / 10_000 : undefined,
      lots: lots.length,
      outcome,
      lotDate: isoDate(get(last, "Дата и время начала подачи заявок")) || undefined,
      note: parts.join(" "),
    });
  }
  return result;
}
