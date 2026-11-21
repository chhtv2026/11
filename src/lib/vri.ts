// Классификатор видов разрешённого использования (приказ Росреестра от 10.11.2020 № П/0412)
// с оценкой под стратегию: КФХ с перспективой построек. Оценки по умолчанию можно менять в настройках.

export type VriVerdict = "ok" | "no" | "check";
export const vriVerdicts: Record<VriVerdict, string> = { ok: "подходит", no: "не подходит", check: "проверить" };

export type VriEntry = {
  code: string;
  name: string;
  verdict: VriVerdict;
  // Почему не подходит или что проверить — показывается в карточке участка
  note?: string;
  // Как этот ВРИ записывают в ЕГРН и НСПД, в том числе старыми формулировками
  pattern: RegExp;
};

const onlyOneActivity = "строго один вид деятельности, построек классификатор не предусматривает";
const notAgri = "не для сельхозпроизводства";

// Порядок важен: сначала узкие виды, общее «сельскохозяйственное использование» — в конце,
// иначе «Выпас сельскохозяйственных животных» попадёт под общий вид
export const vriClassifier: VriEntry[] = [
  { code: "1.16", name: "Ведение личного подсобного хозяйства на полевых участках", verdict: "no", note: "ЛПХ — без права капитального строительства, нет перспективы для КФХ", pattern: /полев\S*\s+участ|лпх|личн\S*\s+подсобн/i },
  { code: "2.2", name: "Для ведения личного подсобного хозяйства (приусадебный земельный участок)", verdict: "no", note: "ЛПХ — не под стратегию КФХ", pattern: /приусадебн/i },
  { code: "1.19", name: "Сенокошение", verdict: "no", note: onlyOneActivity, pattern: /сенокош|заготовк\S*\s+сена/i },
  { code: "1.20", name: "Выпас сельскохозяйственных животных", verdict: "no", note: onlyOneActivity, pattern: /выпас|пастбищ/i },
  { code: "13.1", name: "Ведение огородничества", verdict: "no", note: "для собственных нужд, без капитальных построек", pattern: /огородничеств/i },
  { code: "13.2", name: "Ведение садоводства", verdict: "check", note: "садоводство для собственных нужд (садовый дом) — не то же, что 1.5", pattern: /ведени\S*\s+садоводств|для\s+садоводств|садов\S*\s+дом/i },
  { code: "7.1", name: "Железнодорожные пути", verdict: "no", note: notAgri, pattern: /железнодорожн/i },
  { code: "7.2", name: "Автомобильный транспорт", verdict: "no", note: notAgri, pattern: /автомобильн\S*\s+(дорог|транспорт)|дорог/i },
  { code: "12.0", name: "Земельные участки (территории) общего пользования", verdict: "no", note: notAgri, pattern: /общего\s+пользования/i },
  { code: "12.0.1", name: "Улично-дорожная сеть", verdict: "no", note: notAgri, pattern: /улично/i },
  { code: "12.0.2", name: "Благоустройство территории", verdict: "no", note: notAgri, pattern: /благоустройств/i },
  { code: "12.1", name: "Ритуальная деятельность", verdict: "no", note: notAgri, pattern: /ритуальн|кладбищ/i },
  { code: "1.1", name: "Растениеводство", verdict: "ok", pattern: /растениеводств/i },
  { code: "1.2", name: "Выращивание зерновых и иных сельскохозяйственных культур", verdict: "ok", pattern: /зерновых/i },
  { code: "1.3", name: "Овощеводство", verdict: "ok", pattern: /овощеводств/i },
  { code: "1.4", name: "Выращивание тонизирующих, лекарственных, цветочных культур", verdict: "ok", pattern: /тонизирующ|лекарственн|цветочн/i },
  { code: "1.5", name: "Садоводство", verdict: "ok", pattern: /садоводств/i },
  { code: "1.5.1", name: "Виноградарство", verdict: "ok", pattern: /виноградарств/i },
  { code: "1.6", name: "Выращивание льна и конопли", verdict: "ok", pattern: /льна|конопл/i },
  { code: "1.7", name: "Животноводство", verdict: "ok", pattern: /животноводств/i },
  { code: "1.8", name: "Скотоводство", verdict: "ok", pattern: /скотоводств/i },
  { code: "1.9", name: "Звероводство", verdict: "ok", pattern: /звероводств/i },
  { code: "1.10", name: "Птицеводство", verdict: "ok", pattern: /птицеводств/i },
  { code: "1.11", name: "Свиноводство", verdict: "ok", pattern: /свиноводств/i },
  { code: "1.12", name: "Пчеловодство", verdict: "ok", pattern: /пчеловодств/i },
  { code: "1.13", name: "Рыбоводство", verdict: "ok", pattern: /рыбоводств|аквакультур/i },
  { code: "1.14", name: "Научное обеспечение сельского хозяйства", verdict: "ok", pattern: /научн\S*\s+обеспечени/i },
  { code: "1.15", name: "Хранение и переработка сельскохозяйственной продукции", verdict: "ok", pattern: /хранени\S*\s+и\s+переработк/i },
  { code: "1.17", name: "Питомники", verdict: "ok", pattern: /питомник/i },
  { code: "1.18", name: "Обеспечение сельскохозяйственного производства", verdict: "ok", pattern: /обеспечени\S*\s+сельскохозяйственн/i },
  { code: "КФХ", name: "Ведение крестьянского (фермерского) хозяйства (старая формулировка)", verdict: "ok", pattern: /крестьянск|фермерск/i },
  { code: "1.0", name: "Сельскохозяйственное использование (в т. ч. «для сельскохозяйственного производства»)", verdict: "ok", pattern: /сельскохозяйственн\S*\s+(использовани|производств)/i },
];

export type VriOverrides = Partial<Record<string, VriVerdict>>;

// Вид по тексту ВРИ: сначала по коду («… (1.19)»), потом по формулировке
export function classifyUse(permittedUse: string, overrides: VriOverrides = {}) {
  const text = permittedUse.trim();
  if (!text) return null;
  const codes = [...text.matchAll(/(?:^|[^\d.])(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])/g)].map((m) => m[1]);
  const entry = vriClassifier.find((e) => codes.includes(e.code)) ?? vriClassifier.find((e) => e.pattern.test(text));
  if (!entry) return null;
  return { entry, verdict: overrides[entry.code] ?? entry.verdict };
}
