// Типы и справочники реестра. Файл без серверных импортов — его использует и интерфейс.
import { emptyEconomics, type Economics } from "./economics";
import { classifyUse, type VriOverrides } from "./vri";
import { isPendingScheme, type Scheme } from "./scheme";
import { emptySurvey, type Survey } from "./water";

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

// Итог проверки генплана: "" — не смотрели, ok — сельхоззона и ничего не планируется, check — есть что уточнить
export type PlanResult = "" | "ok" | "check";

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
  permittedUse: "ВРИ подходит под стратегию (по классификатору ВРИ)",
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

// Последняя полная выгрузка torgi.gov.ru (все торги по сельхозземле): по ней отмечаем и участки, добавленные позже
export type TorgiExportInfo = { date: string; districtCodes: string[]; numbers: string[] };
// Сколько дней полная выгрузка торгов считается свежей для отметки новых участков
export const TORGI_EXPORT_FRESH_DAYS = 30;

// Журнал импортов: когда и по каким кадастровым районам (60:03 …) загружали выгрузку НСПД или торгов.
// complete — выгрузка торгов без фильтров ВРИ и статуса: охватывает весь регион, а не только районы с лотами.
export type ImportRecord = { kind: "nspd" | "torgi"; date: string; districtCodes: string[]; numbers: number; complete?: boolean };

// torgiExcluded — участки, отсеянные по выгрузке торгов (аукцион идёт, победитель, одна заявка): номер → дата лота.
// В реестр их не заносим и при импорте НСПД пропускаем.
export type Settings = {
  weights: Weights;
  vri: VriOverrides;
  torgiExport: TorgiExportInfo | null;
  torgiExcluded: Record<string, string>;
  imports: ImportRecord[];
  applicant: Applicant;
  // Ставки расчистки заросшей сельхозземли, ₽/га (задаёт пользователь)
  clearing: { shrubPerHa: number | null; forestPerHa: number | null };
};

// Заявитель — для заявлений в администрацию
export type Applicant = { name: string; status: string; address: string; phone: string; email: string };
export const emptyApplicant: Applicant = { name: "", status: "", address: "", phone: "", email: "" };

// Срок ответа на обращение — 30 дней (ст. 12 59-ФЗ)
export const ADMIN_ANSWER_DAYS = 30;

export function emptyChecks(): Record<StopFactor, CheckValue> {
  return { category: "unknown", rights: "unknown", route: "unknown", restrictions: "unknown", access: "unknown", permittedUse: "unknown" };
}

// Итоговое значение стоп-фактора. ВРИ оценивается по классификатору: «не подходит» исключает участок,
// что бы ни стояло вручную; «подходит» ставит «да», пока вручную ничего не выбрано.
// Подъезд: если при осмотре по карте видна дорога или грунтовка, а вручную ничего не выбрано — «да».
// «Подъезда не видно» участок не исключает: проезд можно получить сервитутом — остаётся «не проверено».
// Что нужно знать об участке, чтобы оценить его по стоп-факторам (owner, площадь и торги — для ст. 10.1)
export type CheckablePlot = Pick<Plot, "checks" | "permittedUse"> &
  Partial<Pick<Plot, "owner" | "areaHa" | "torgiCheckedAt" | "rightsCheckedAt" | "scheme" | "cadastralNumber">> & {
    survey?: Pick<Survey, "access">;
  };

// Предельный размер участка для деятельности КФХ в Псковской области — 300 га
// (закон Псковской области от 03.10.2003 № 299-ОЗ в ред. закона от 09.03.2016 № 1649-ОЗ; п. 7 ст. 10.1 101-ФЗ)
export const KFH_MAX_HA = 300;

// later — то, что заранее не узнать: выяснится из ответа на заявление (при отказе администрация обязана назвать причину)
export type RouteBasis = { value: CheckValue; ok: string[]; missing: string[]; blocking: string[]; later: string[] };

// Законный способ по умолчанию — аренда без торгов по ст. 10.1 101-ФЗ: гражданину или КФХ, до 5 лет,
// из земель государственной или муниципальной собственности. Отказ — по ст. 39.16 ЗК, сверх предельного
// размера или если раньше подано чужое заявление (п. 7). Заявления рассматривают по очереди поступления, поэтому
// заранее администрацию не спрашиваем: чужое заявление и остальное, чего нет в открытых источниках, покажет ответ на своё.
export function routeBasis(plot: CheckablePlot, vri: VriOverrides = {}): RouteBasis {
  const ok: string[] = [];
  const missing: string[] = [];
  const blocking: string[] = [];
  const later: string[] = [];
  const pending = isPendingScheme(plot);
  const owner = plot.owner ?? "unknown";
  if (owner === "private") blocking.push("земля частная, а ст. 10.1 — только для государственных и муниципальных земель");
  else if (owner === "unknown") missing.push("собственник (карточка НСПД)");
  else ok.push(`земля публичная: ${owners[owner]}`);
  const other: [StopFactor, string, string][] = [
    ["category", "категория — сельхозназначение", "категория земель"],
    ["permittedUse", "ВРИ подходит (менять назначение по 10.1 нельзя, п. 6)", "вид разрешённого использования"],
    [
      "rights",
      "нет аренды, ареста и претендентов (ст. 39.16 ЗК)",
      pending ? "права третьих лиц — нет ли в контуре участков без границ" : "права третьих лиц — справочная информация Росреестра",
    ],
    ["restrictions", "зоны не запрещают сельхозиспользование", "режим зоны (ООПТ, лесничество)"],
  ];
  for (const [key, good, need] of other) {
    const v = checkValue(plot, key, vri);
    // Справку Росреестра посмотрели (или контур сверили с картой), а сомнение осталось — его снимет только ответ на заявление
    const checked = pending ? Boolean(plot.scheme?.checkedAt) : Boolean(plot.rightsCheckedAt);
    if (key === "rights" && v === "unknown" && checked) {
      later.push(pending ? "нет ли в контуре участков без границ (паи)" : "права третьих лиц — сомнение после справки Росреестра");
      continue;
    }
    if (v === "yes") ok.push(good);
    // «нет» по другому пункту уже исключает участок — здесь только отмечаем, что вопрос не закрыт
    else missing.push(v === "no" ? `${need} — там «нет»` : need);
  }
  // Участок по схеме ещё не образован: по нему нет лотов, а чужие аукционы и схемы видны на слоях НСПД при сверке контура
  if (pending) {
    if (plot.scheme?.checkedAt) ok.push("контур не задевает чужие участки, схемы и аукционы (слои НСПД)");
    else missing.push("контур — сверить со слоями участков НСПД");
  } else if (plot.torgiCheckedAt) ok.push("на torgi.gov.ru нет аукциона и претендентов");
  else missing.push("торги и извещения на torgi.gov.ru");
  if (plot.areaHa === null || plot.areaHa === undefined) missing.push("площадь участка");
  else if (plot.areaHa > KFH_MAX_HA) blocking.push(`площадь ${plot.areaHa} га больше предельных ${KFH_MAX_HA} га для КФХ`);
  else ok.push(`площадь ${String(plot.areaHa).replace(".", ",")} га — в пределах ${KFH_MAX_HA} га`);
  later.push("не подал ли кто-то заявление раньше вас (п. 7 ст. 10.1)");
  return { value: blocking.length ? "no" : missing.length ? "unknown" : "yes", ok, missing, blocking, later };
}

export function checkValue(plot: CheckablePlot, key: StopFactor, vri: VriOverrides = {}): CheckValue {
  if (key === "route" && plot.checks.route === "unknown") return routeBasis(plot, vri).value;
  if (key === "permittedUse") {
    const use = classifyUse(plot.permittedUse, vri);
    if (use?.verdict === "no") return "no";
    if (use?.verdict === "ok" && plot.checks[key] === "unknown") return "yes";
  }
  if (key === "access" && plot.checks.access === "unknown" && (plot.survey?.access === "road" || plot.survey?.access === "track")) {
    return "yes";
  }
  return plot.checks[key];
}

export type Assessment =
  | { kind: "excluded"; reasons: StopFactor[] }
  | { kind: "incomplete"; rated: number }
  | { kind: "scored"; score: number; checksDone: boolean };

export function assess(
  plot: CheckablePlot & Pick<Plot, "scores">,
  weights: Weights,
  vri: VriOverrides = {},
): Assessment {
  const reasons = (Object.keys(stopFactors) as StopFactor[]).filter((k) => checkValue(plot, k, vri) === "no");
  if (reasons.length) return { kind: "excluded", reasons };
  const keys = Object.keys(criteria) as Criterion[];
  const rated = keys.filter((k) => plot.scores[k]);
  if (rated.length < keys.length) return { kind: "incomplete", rated: rated.length };
  const total = keys.reduce((sum, k) => sum + weights[k], 0) || 1;
  const score = keys.reduce((sum, k) => sum + (weights[k] * plot.scores[k]!) / 5, 0) / total;
  const checksDone = (Object.keys(stopFactors) as StopFactor[]).every((k) => checkValue(plot, k, vri) === "yes");
  return { kind: "scored", score: Math.round(score * 100), checksDone };
}

// Порядок проверки участка: сначала карточка НСПД (категория, ВРИ, собственник), потом то,
// чего НСПД не показывает, — начиная с прав третьих лиц по справочной информации Росреестра
const checkSteps: { factor: StopFactor; label: string }[] = [
  { factor: "rights", label: "права третьих лиц — справочная информация Росреестра" },
  { factor: "restrictions", label: "ограничения (ЗОУИТ, ООПТ) — слои карты НСПД" },
  { factor: "route", label: "законный способ получить участок" },
  { factor: "access", label: "подъезд к участку" },
  { factor: "category", label: "категория земель" },
  { factor: "permittedUse", label: "вид разрешённого использования" },
];

// warn — следующий шаг требует внимания (например, риск по свежей регистрации собственности)
export type CheckProgress = {
  nspd: boolean;
  rights: boolean;
  torgi: boolean;
  restrictions: boolean;
  next: string | null;
  warn?: boolean;
  // Дата отправки запроса в администрацию
  request: string | null;
  // Зоны на карте сверены, но режим зоны (ООПТ, лесничество краем и т. п.) не выяснен — видно в любой момент проверки
  zoneOpen: boolean;
  // Генплан смотрят отдельно от очереди проверок: "" — не смотрели
  plan: PlanResult;
  // Осмотр по карте записан (вода, зарастание или подъезд) — генплан при этом могли ещё не смотреть
  surveyed: boolean;
};

// Где участок в проверке и что делать дальше; у исключённого следующего шага нет
export function checkProgress(
  plot: Pick<
    Plot,
    | "checks"
    | "scores"
    | "permittedUse"
    | "nspdCheckedAt"
    | "rightsCheckedAt"
    | "torgiCheckedAt"
    | "restrictionsCheckedAt"
    | "adminRequestAt"
    | "planResult"
  > &
    Partial<Pick<Plot, "route" | "survey">> &
    CheckablePlot,
  vri: VriOverrides = {},
): CheckProgress {
  const nspd = Boolean(plot.nspdCheckedAt);
  const rights = Boolean(plot.rightsCheckedAt);
  const torgi = Boolean(plot.torgiCheckedAt);
  const restrictions = Boolean(plot.restrictionsCheckedAt);
  const request = plot.adminRequestAt ?? null;
  const excluded = (Object.keys(stopFactors) as StopFactor[]).some((k) => checkValue(plot, k, vri) === "no");
  // У исключённого участка режим зоны выяснять незачем — плашку не показываем
  const zoneOpen = !excluded && restrictions && checkValue(plot, "restrictions", vri) === "unknown";
  const plan = excluded ? "" : (plot.planResult ?? "");
  const s = plot.survey;
  const surveyed = Boolean(s && (s.water?.length || s.overgrowth || s.access));
  const done = (next: string | null) => ({ nspd, rights, torgi, restrictions, next, request, zoneOpen, plan, surveyed });
  if (excluded) return done(null);
  if (isPendingScheme(plot)) return schemeProgress(plot, vri, done);
  if (!nspd) return done("сверить с карточкой НСПД");
  const first = checkSteps.find((s) => checkValue(plot, s.factor, vri) === "unknown");
  if (first?.factor === "rights" && !rights) return done(first.label);
  // Права третьих лиц: после Росреестра — торги и извещения, их видно только на torgi.gov.ru
  if (!torgi) return done("права третьих лиц — проверить torgi.gov.ru");
  // Справка Росреестра вставлена, а вопрос остался (свежая регистрация собственности) — администрацию заранее
  // не спрашиваем: ответ даст само заявление. Идём дальше по остальным пунктам
  return finishProgress(plot, vri, done, (f) => f === "rights" && rights);
}

// Общий хвост проверки: зоны, законный способ, остальные стоп-факторы, баллы и, наконец, заявление
function finishProgress(
  plot: Parameters<typeof checkProgress>[0],
  vri: VriOverrides,
  done: (next: string | null) => CheckProgress,
  later: (factor: StopFactor) => boolean,
): CheckProgress {
  const step = checkSteps.find((s) => !later(s.factor) && checkValue(plot, s.factor, vri) === "unknown");
  // Зоны на карте сверены, но режим зоны (ООПТ, культурное наследие) ещё надо уточнить
  if (step?.factor === "restrictions" && plot.restrictionsCheckedAt) return { ...done("ограничения — уточнить режим зоны"), warn: true };
  if (step?.factor === "route") {
    const missing = routeBasis(plot, vri).missing;
    return done(missing.length ? `законный способ (ст. 10.1) — ${missing[0]}` : step.label);
  }
  if (step) return done(step.label);
  const rated = (Object.keys(criteria) as Criterion[]).filter((k) => plot.scores[k]).length;
  if (rated < Object.keys(criteria).length) return done("оценить баллами");
  if (plot.route?.submission?.done) return done(null);
  return done(
    isPendingScheme(plot)
      ? "подать заявление о предварительном согласовании со схемой (ст. 39.15 ЗК)"
      : "подать заявление об аренде без торгов (ст. 10.1 101-ФЗ)",
  );
}

// Участок по схеме, ещё не образованный: карточки НСПД, справки Росреестра и лотов на торгах у него нет.
// Сначала контур сверяют со слоями участков, потом зоны; участки без границ и чужие заявления покажет ответ на заявление
function schemeProgress(
  plot: Parameters<typeof checkProgress>[0],
  vri: VriOverrides,
  done: (next: string | null) => CheckProgress,
): CheckProgress {
  const scheme = plot.scheme!;
  if (scheme.points.length < 3) return done("контур — внести вершины (широта, долгота)");
  if (!scheme.checkedAt) return done("контур — сверить со слоями участков НСПД");
  if (!plot.restrictionsCheckedAt && checkValue(plot, "restrictions", vri) === "unknown") {
    return done(checkSteps.find((s) => s.factor === "restrictions")!.label);
  }
  return finishProgress(plot, vri, done, (f) => f === "rights");
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
  return localDate(d);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

// Дата в формате ГГГГ-ММ-ДД по местному времени, без перевода в UTC — иначе в Москве съезжает на день назад
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Паспорт годовых обязательств (концепция, п. 6): платежи, работы, подтверждения, проверки, расходы.
// Главное — накапливать доказательства надлежащего использования земли с первого года.
export const obligationKinds = {
  rent: "Арендный платёж",
  work: "Сельхозработы",
  evidence: "Подтверждение использования",
  inspection: "Проверка / контроль",
  expense: "Прочий расход",
} as const;
export type ObligationKind = keyof typeof obligationKinds;

export type Obligation = {
  id: string;
  date: string;
  kind: ObligationKind;
  title: string;
  amount: number | null;
  done: boolean;
  // Чем подтверждено: акт, договор подряда, фото, платёжка — название или ссылка
  evidence: string;
};

export type YearSummary = {
  year: number;
  rentPlanned: number;
  rentPaid: number;
  expenses: number;
  worksDone: number;
  worksWithoutEvidence: number;
  evidence: number;
  warnings: string[];
};

// Статусы участков, с которыми уже идёт работа: при чистке списка их не удаляем
export const workingStatuses: PlotStatus[] = ["checking", "promising", "applying", "leased", "bought"];

// Статусы, при которых земля уже на руках и её обязаны использовать
export const holdingStatuses: PlotStatus[] = ["leased", "bought"];

export function summarizeYear(obligations: Obligation[], year: number, holding: boolean): YearSummary {
  const items = obligations.filter((o) => o.date.startsWith(`${year}-`));
  const sum = (list: Obligation[]) => list.reduce((s, o) => s + (o.amount ?? 0), 0);
  const rent = items.filter((o) => o.kind === "rent");
  const works = items.filter((o) => o.kind === "work" && o.done);
  const summary: YearSummary = {
    year,
    rentPlanned: sum(rent),
    rentPaid: sum(rent.filter((o) => o.done)),
    expenses: sum(items.filter((o) => o.done)),
    worksDone: works.length,
    worksWithoutEvidence: works.filter((o) => !o.evidence.trim()).length,
    evidence: items.filter((o) => o.done && (o.kind === "evidence" || o.evidence.trim())).length,
    warnings: [],
  };
  if (holding && summary.worksDone === 0) summary.warnings.push("нет выполненных сельхозработ — риск признания земли неиспользуемой");
  if (summary.worksWithoutEvidence) summary.warnings.push(`работы без подтверждающего документа: ${summary.worksWithoutEvidence}`);
  if (summary.rentPlanned > summary.rentPaid) {
    const overdue = rent.filter((o) => !o.done && o.date < localDate()).length;
    if (overdue) summary.warnings.push(`просрочено арендных платежей: ${overdue}`);
  }
  return summary;
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
  // Кадастровая стоимость, ₽ — от неё часто считается цена выкупа и арендная плата
  cadastralValue: number | null;
  // Когда сведения сверены с карточкой НСПД (ГГГГ-ММ-ДД) — первый шаг проверки пройден
  nspdCheckedAt: string | null;
  // Когда права третьих лиц сверены со справочной информацией Росреестра (ГГГГ-ММ-ДД) — второй шаг
  rightsCheckedAt: string | null;
  // Когда участок проверен на torgi.gov.ru (торги, извещения по ст. 39.18 ЗК) и ничего не нашлось
  torgiCheckedAt: string | null;
  // Дата начала приёма заявок самого свежего известного лота: более старая выгрузка не перебивает новую
  torgiLotDate: string | null;
  // Когда участок сверен со слоями ЗОУИТ, ООПТ и лесничеств на карте НСПД
  restrictionsCheckedAt: string | null;
  // Какие зоны отмечены при проверке ограничений (ключи пунктов «Отметьте всё, что нашлось»)
  restrictionZones: string[];
  // Генплан по слоям ФГИС ТП на карте НСПД (функциональная зона, планируемые объекты): когда смотрели,
  // итог (ok — сельхоззона, ничего не планируется; check — есть что уточнить) и что нашлось
  planCheckedAt: string | null;
  planResult: PlanResult;
  planFindings: string[];
  // Осмотр по карте: вода рядом (для расчёта водоохранных полос), зарастание, подъезд
  survey: Survey;
  // Контур участка, который ещё предстоит образовать по схеме расположения (направление «Б»); у сформированного — null
  scheme: Scheme | null;
  // Когда по участку отправлен запрос в администрацию (договоры до года, заявления, торги); ответ — 30 дней (59-ФЗ)
  adminRequestAt: string | null;
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
  obligations: Obligation[];
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
    cadastralValue: null,
    nspdCheckedAt: null,
    rightsCheckedAt: null,
    torgiCheckedAt: null,
    torgiLotDate: null,
    restrictionsCheckedAt: null,
    restrictionZones: [],
    planCheckedAt: null,
    planResult: "",
    planFindings: [],
    survey: emptySurvey(),
    scheme: null,
    adminRequestAt: null,
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
    obligations: [],
  };
}
