// Разбор карточки сервиса Росреестра «Справочная информация по объектам недвижимости в режиме online»:
// раздел «Сведения о правах и ограничениях (обременениях)». Сами с сайта ничего не скачиваем.
import { addMonths } from "./registry";
import { extractCadastralNumbers } from "./nspd";

export const ROSREESTR_ONLINE = "https://lk.rosreestr.ru/eservices/real-estate-objects-online";

export type RightRecord = {
  kind: "ownership" | "encumbrance" | "other";
  type: string;
  number: string;
  date: string | null; // ГГГГ-ММ-ДД
};

export type RosreestrCard = {
  cadastralNumber?: string;
  updatedAt?: string; // «Дата обновления информации», ГГГГ-ММ-ДД
  hasRightsSection: boolean;
  records: RightRecord[];
};

// Записи, которые означают права или притязания третьих лиц на участок
const encumbrancePattern =
  /аренд|субаренд|ипотек|залог|сервитут|арест|запрет|доверительн|безвозмездн|постоянн|бессрочн|пожизненн|хозяйственн\S* ведени|оперативн\S* управлени|ограничени|обременени|концесси|рент/i;

function isoDate(text: string) {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Строки-заголовки полей, а не значения
function isLabel(line: string) {
  return /государственной регистрации|^ограничение прав и обременение|^сведения о|^дата\b|^номер\b|^вид\b/i.test(line);
}

export function parseRosreestrCard(text: string): RosreestrCard {
  const lines = text
    .replace(/\r/g, "")
    .split(/[\n\t]/)
    .map((l) => l.replace(/^[*•·-]\s*/, "").trim())
    .filter(Boolean);
  const card: RosreestrCard = { hasRightsSection: false, records: [] };

  const numberAt = lines.findIndex((l) => /^кадастровый номер/i.test(l));
  if (numberAt >= 0) {
    const number = extractCadastralNumbers(lines.slice(numberAt, numberAt + 2).join(" "))[0];
    if (number) card.cadastralNumber = number;
  }
  const updatedAt = lines.findIndex((l) => /^дата обновления информации/i.test(l));
  if (updatedAt >= 0) card.updatedAt = isoDate(lines.slice(updatedAt, updatedAt + 2).join(" ")) ?? undefined;

  const start = lines.findIndex((l) => /^сведения о правах/i.test(l));
  if (start < 0) return card;
  card.hasRightsSection = true;
  const section = lines.slice(start + 1);

  // Запись — «вид» (Собственность, Аренда…), затем «№ …», затем «от ДД.ММ.ГГГГ» (иногда в одной строке)
  section.forEach((line, i) => {
    if (!/^№/.test(line)) return;
    let type = "";
    for (let j = i - 1; j >= 0; j--) {
      if (/^№|^от\s/.test(section[j])) break;
      if (!isLabel(section[j])) {
        type = section[j];
        break;
      }
    }
    const date = isoDate(line) ?? (section[i + 1] && /^от\s/i.test(section[i + 1]) ? isoDate(section[i + 1]) : null);
    const kind = /^собственност/i.test(type) ? "ownership" : encumbrancePattern.test(type) ? "encumbrance" : "other";
    card.records.push({ kind, type: type || "без названия", number: line.replace(/^№\s*/, "").replace(/\s+от\s.*$/, ""), date });
  });

  // Если записи разобрать не удалось, но в разделе есть слова об аренде или обременении — считаем, что они есть
  if (!card.records.length) {
    const hit = section.find((l) => !isLabel(l) && encumbrancePattern.test(l));
    if (hit) card.records.push({ kind: "encumbrance", type: hit, number: "", date: null });
  }
  return card;
}

// Срок, в течение которого тот, кто уже использует участок из невостребованных долей,
// может получить его без торгов (п. 4 ст. 12 101-ФЗ): 6 месяцев с регистрации муниципальной собственности
export function ownershipClaimDeadline(card: RosreestrCard, today: string) {
  const own = card.records.filter((r) => r.kind === "ownership" && r.date).map((r) => r.date!);
  const latest = own.sort().at(-1);
  if (!latest) return null;
  const deadline = addMonths(latest, 6);
  return deadline > today ? { registeredAt: latest, deadline } : null;
}
