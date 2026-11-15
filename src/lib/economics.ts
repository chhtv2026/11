// Экономика участка: три сценария из концепции (п. 7) — выкуп и продажа частями,
// выкуп без возможности раздела, выкуп не состоялся. Файл без серверных импортов.

export const economicsFields = {
  years: { label: "Срок аренды до выкупа, лет", hint: "выкуп без торгов возможен не ранее чем через 3 года аренды" },
  rentPerHa: { label: "Арендная плата, ₽/га в год", hint: "из договора или расчёта арендной платы" },
  usagePerHa: { label: "Сельхозработы, ₽/га в год", hint: "покос, вспашка, подсев — чтобы подтвердить использование" },
  incomePerHa: { label: "Доход от использования, ₽/га в год", hint: "сено, выпас, субаренда; если нет — 0" },
  startCosts: { label: "Расходы на старте, ₽", hint: "кадастровые работы, расчистка, подъезд" },
  buyoutPrice: { label: "Цена выкупа, ₽ за весь участок", hint: "зависит от правового основания" },
  exitCosts: { label: "Расходы при выходе, ₽", hint: "раздел, межевание, пошлины, налоги, посредники" },
  salePerHa: { label: "Цена продажи частями, ₽/га", hint: "если раздел законно возможен" },
  wholeSalePerHa: { label: "Цена продажи целиком, ₽/га", hint: "если раздел окажется невозможен" },
  capitalRate: { label: "Стоимость денег, % годовых", hint: "например, ставка по вкладу; 0 — не учитывать" },
} as const;
export type EconomicsField = keyof typeof economicsFields;
export type Economics = Record<EconomicsField, number | null>;

export function emptyEconomics(): Economics {
  return {
    years: 3,
    rentPerHa: null,
    usagePerHa: null,
    incomePerHa: null,
    startCosts: null,
    buyoutPrice: null,
    exitCosts: null,
    salePerHa: null,
    wholeSalePerHa: null,
    capitalRate: null,
  };
}

export type Scenario = {
  key: "split" | "whole" | "failed";
  label: string;
  invested: number;
  received: number;
  profit: number;
  // Итог за вычетом того, что те же деньги принесли бы под ставку «стоимости денег»
  profitAfterCapital: number;
};

type Flow = { year: number; amount: number };

// Переносит денежный поток на конец срока под ставку стоимости денег
function futureValue(flows: Flow[], years: number, rate: number) {
  return flows.reduce((sum, f) => sum + f.amount * Math.pow(1 + rate, years - f.year), 0);
}

export type EconomicsResult =
  | { ok: false; missing: string[] }
  | { ok: true; scenarios: Scenario[]; breakEvenPerHa: number | null };

export function calculate(e: Economics, areaHa: number | null): EconomicsResult {
  const missing: string[] = [];
  if (!areaHa) missing.push("площадь участка");
  if (!e.years) missing.push(economicsFields.years.label);
  if (e.rentPerHa === null) missing.push(economicsFields.rentPerHa.label);
  if (e.buyoutPrice === null) missing.push(economicsFields.buyoutPrice.label);
  if (e.salePerHa === null && e.wholeSalePerHa === null) missing.push("цена продажи частями или целиком");
  if (missing.length) return { ok: false, missing };

  const area = areaHa!;
  const years = e.years!;
  const rate = (e.capitalRate ?? 0) / 100;
  const yearlyNet = area * ((e.incomePerHa ?? 0) - e.rentPerHa! - (e.usagePerHa ?? 0));

  // Общая часть всех сценариев: старт в год 0, затем годовой результат аренды и использования
  const holding: Flow[] = [{ year: 0, amount: -(e.startCosts ?? 0) }];
  for (let y = 1; y <= years; y++) holding.push({ year: y, amount: yearlyNet });

  function scenario(key: Scenario["key"], label: string, exit: Flow[]): Scenario {
    const flows = [...holding, ...exit];
    const invested = -flows.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0);
    const received = flows.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
    // При нулевой ставке будущая стоимость потоков равна номинальному итогу
    return { key, label, invested, received, profit: received - invested, profitAfterCapital: futureValue(flows, years, rate) };
  }

  const buyout = (sale: number): Flow[] => [
    { year: years, amount: -e.buyoutPrice! - (e.exitCosts ?? 0) },
    { year: years, amount: sale },
  ];

  const scenarios: Scenario[] = [];
  if (e.salePerHa !== null) scenarios.push(scenario("split", "Выкуп и продажа частями", buyout(area * e.salePerHa)));
  if (e.wholeSalePerHa !== null) scenarios.push(scenario("whole", "Выкуп, раздел невозможен", buyout(area * e.wholeSalePerHa)));
  scenarios.push(scenario("failed", "Выкуп не состоялся", []));

  // При какой цене продажи (за га) выкуп и продажа выходят в ноль с учётом стоимости денег
  const costAtExit = -futureValue([...holding, { year: years, amount: -e.buyoutPrice! - (e.exitCosts ?? 0) }], years, rate);
  const breakEvenPerHa = costAtExit > 0 ? costAtExit / area : 0;

  return { ok: true, scenarios, breakEvenPerHa };
}
