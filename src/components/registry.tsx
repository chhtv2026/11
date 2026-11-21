"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  assess,
  checkValues,
  deadlinePresets,
  holdingStatuses,
  localDate,
  obligationKinds,
  routeSteps,
  summarizeYear,
  type Obligation,
  type ObligationKind,
  type Deadline,
  type RouteStep,
  criteria,
  defaultWeights,
  defaultRegion,
  emptyPlot,
  emptySource,
  owners,
  plotDirections,
  plotStatuses,
  sourceTypes,
  stopFactors,
  workingStatuses,
  checkValue,
  checkProgress,
  type Assessment,
  type CheckProgress,
  type CheckValue,
  type Criterion,
  type Finding,
  type Plot,
  type PlotInput,
  type PlotStatus,
  type Settings,
  type Source,
  type SourceInput,
  type StopFactor,
  type Weights,
} from "@/lib/registry";

import { calculate, economicsFields, type Economics, type EconomicsField, type EconomicsResult } from "@/lib/economics";
import { classifyUse, vriClassifier, vriVerdicts, type VriOverrides, type VriVerdict } from "@/lib/vri";
import { regionByCadastralNumber } from "@/lib/regions";
import { extractCadastralNumbers, isAgriculturalLand, normalizeCadastralNumber, parseNspdCard } from "@/lib/nspd";

type Data = { sources: Source[]; plots: Plot[]; settings: Settings };

const rub = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const rubCompact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

function money(value: number, compact = false) {
  const text = compact ? rubCompact.format(value) : rub.format(value);
  return `${value > 0 && compact ? "+" : ""}${text} ₽`;
}

const today = () => localDate();

const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function formatDay(date: string) {
  return dayFormat.format(new Date(`${date}T00:00:00`));
}

// Сколько дней до срока: отрицательное — просрочено
function daysUntil(date: string) {
  return Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86_400_000);
}

function dueLabel(days: number) {
  if (days < 0) return `просрочено на ${-days} дн.`;
  if (days === 0) return "сегодня";
  return `через ${days} дн.`;
}

function dueColor(days: number, done: boolean) {
  if (done) return "text-zinc-400";
  if (days < 0) return "text-rose-700 dark:text-rose-400";
  if (days <= 30) return "text-amber-700 dark:text-amber-400";
  return "text-zinc-600 dark:text-zinc-400";
}

function moneyColor(value: number) {
  return value > 0 ? "text-emerald-700 dark:text-emerald-400" : value < 0 ? "text-rose-700 dark:text-rose-400" : "";
}

const statusColors: Record<PlotStatus, string> = {
  found: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  checking: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  promising: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  applying: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  leased: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  bought: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });

async function api(url: string, method: string, body?: object) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `Ошибка ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900";

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-zinc-500 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

// Подтверждение внутри страницы: системное окно confirm() во встроенном браузере не показывается
function ConfirmButton({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-sm text-rose-600 hover:underline">
        {label}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-rose-600">{question}</span>
      <button type="button" onClick={onConfirm} className="rounded-lg bg-rose-600 px-3 py-1 text-white hover:bg-rose-700">
        Да
      </button>
      <button type="button" onClick={() => setAsking(false)} className="rounded-lg px-3 py-1 text-zinc-500 hover:text-zinc-800">
        Нет
      </button>
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-zinc-50 p-5 shadow-xl dark:bg-zinc-950"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700" aria-label="Закрыть">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FindingsEditor({ findings, onChange }: { findings: Finding[]; onChange: (f: Finding[]) => void }) {
  function update(index: number, patch: Partial<Finding>) {
    onChange(findings.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  return (
    <div className="sm:col-span-2">
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
        <span>Правовые выводы</span>
        <button
          type="button"
          onClick={() => onChange([...findings, { id: "", text: "", basis: "", verified: false, createdAt: "" }])}
          className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
        >
          + добавить вывод
        </button>
      </div>
      {findings.length === 0 && <p className="text-xs text-zinc-400">Пока нет выводов.</p>}
      <ul className="flex flex-col gap-2">
        {findings.map((f, i) => (
          <li
            key={f.id || i}
            className={`rounded-xl border p-3 ${f.verified ? "border-emerald-300 dark:border-emerald-800" : "border-amber-300 dark:border-amber-800"}`}
          >
            <textarea
              value={f.text}
              onChange={(e) => update(i, { text: e.target.value })}
              placeholder="Например: участок можно получить без торгов как КФХ"
              rows={2}
              className={inputClass}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={f.basis}
                onChange={(e) => update(i, { basis: e.target.value })}
                placeholder="Основание: статья, пункт, документ"
                className={`${inputClass} flex-1`}
              />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={f.verified} onChange={(e) => update(i, { verified: e.target.checked })} />
                {f.verified ? "проверено" : "не проверено"}
              </label>
              <button
                type="button"
                onClick={() => onChange(findings.filter((_, j) => j !== i))}
                className="text-xs text-rose-600 hover:underline"
              >
                удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssessmentBadge({ assessment }: { assessment: Assessment }) {
  if (assessment.kind === "excluded") {
    return (
      <span
        className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300"
        title={`Не выполнено: ${assessment.reasons.map((k) => stopFactors[k]).join("; ")}`}
      >
        исключён{assessment.reasons.includes("permittedUse") ? " · ВРИ" : ""}
      </span>
    );
  }
  if (assessment.kind === "incomplete") {
    return <span className="text-xs text-zinc-400">оценено {assessment.rated} из 5</span>;
  }
  const color =
    assessment.score >= 70
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : assessment.score >= 50
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
      title={assessment.checksDone ? undefined : "Не все стоп-факторы проверены"}
    >
      {assessment.score} / 100{assessment.checksDone ? "" : " *"}
    </span>
  );
}

const checkColors: Record<CheckValue, string> = {
  unknown: "text-zinc-500",
  yes: "text-emerald-700 dark:text-emerald-400",
  no: "text-rose-700 dark:text-rose-400",
};

function AssessmentEditor({
  form,
  settings,
  onChecks,
  onScores,
}: {
  form: PlotInput;
  settings: Settings;
  onChecks: (checks: PlotInput["checks"]) => void;
  onScores: (scores: PlotInput["scores"]) => void;
}) {
  const { weights, vri } = settings;
  const assessment = assess(form, weights, vri);
  const use = classifyUse(form.permittedUse, vri);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-3 sm:col-span-2 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Оценка участка</span>
        <AssessmentBadge assessment={assessment} />
      </div>

      <div>
        <p className="mb-1 text-xs text-zinc-500">Шаг 1. Стоп-факторы — любое «нет» исключает участок</p>
        <ul className="flex flex-col gap-1">
          {(Object.keys(stopFactors) as StopFactor[]).map((key) => {
            const value = checkValue(form, key, vri);
            // ВРИ «не подходит» по классификатору выставляет «нет» сам, вручную не поменять — сначала нужно изменить ВРИ
            const auto = key === "permittedUse" && use?.verdict === "no";
            return (
            <li key={key} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {stopFactors[key]}
                {key === "permittedUse" && form.permittedUse.trim() && <VriHint permittedUse={form.permittedUse} vri={vri} />}
              </span>
              <select
                value={value}
                disabled={auto}
                onChange={(e) => onChecks({ ...form.checks, [key]: e.target.value as CheckValue })}
                className={`shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-900 ${checkColors[value]}`}
                aria-label={stopFactors[key]}
              >
                {(Object.keys(checkValues) as CheckValue[]).map((v) => (
                  <option key={v} value={v}>{checkValues[v]}</option>
                ))}
              </select>
            </li>
            );
          })}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-xs text-zinc-500">Шаг 2. Баллы от 1 до 5 (вес критерия — в скобках)</p>
        <ul className="flex flex-col gap-2">
          {(Object.keys(criteria) as Criterion[]).map((key) => (
            <li key={key}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {criteria[key].label} <span className="text-xs text-zinc-400">({weights[key]}%)</span>
                </span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onScores({ ...form.scores, [key]: form.scores[key] === n ? undefined : n })}
                      className={`h-7 w-7 rounded-md border text-xs ${
                        form.scores[key] === n
                          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                          : "border-zinc-200 dark:border-zinc-700"
                      }`}
                      aria-label={`${criteria[key].label}: ${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-zinc-400">
                1 — {criteria[key].low}; 5 — {criteria[key].high}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EconomicsEditor({
  economics,
  areaHa,
  onChange,
}: {
  economics: Economics;
  areaHa: number | null;
  onChange: (e: Economics) => void;
}) {
  const result = calculate(economics, areaHa);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 sm:col-span-2 dark:border-zinc-800">
      <span className="text-sm font-medium">Экономика участка</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(Object.keys(economicsFields) as EconomicsField[]).map((key) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-zinc-500">
            {economicsFields[key].label}
            <input
              type="number"
              min="0"
              step="any"
              value={economics[key] ?? ""}
              onChange={(e) => onChange({ ...economics, [key]: e.target.value === "" ? null : Number(e.target.value) })}
              className={inputClass}
            />
            <span className="text-zinc-400">{economicsFields[key].hint}</span>
          </label>
        ))}
      </div>
      <EconomicsSummary result={result} areaHa={areaHa} />
    </div>
  );
}

function RouteEditor({ route, onChange }: { route: PlotInput["route"]; onChange: (r: PlotInput["route"]) => void }) {
  const keys = Object.keys(routeSteps) as RouteStep[];
  const done = keys.filter((k) => route[k].done).length;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 sm:col-span-2 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Правовой маршрут</span>
        <span className="text-xs text-zinc-500">
          пройдено {done} из {keys.length}
        </span>
      </div>
      <ol className="flex flex-col gap-3">
        {keys.map((key, i) => {
          const step = routeSteps[key];
          return (
            <li key={key} className="flex gap-2">
              <input
                type="checkbox"
                checked={route[key].done}
                onChange={(e) => onChange({ ...route, [key]: { ...route[key], done: e.target.checked } })}
                className="mt-1"
                aria-label={`${step.label}: выяснено`}
              />
              <div className="flex flex-1 flex-col gap-1">
                <span className={`text-sm ${route[key].done ? "text-zinc-400 line-through" : ""}`}>
                  {i + 1}. {step.label} <span className="text-xs text-zinc-400 no-underline">— {step.hint}</span>
                </span>
                <input
                  value={route[key].value}
                  onChange={(e) => onChange({ ...route, [key]: { ...route[key], value: e.target.value } })}
                  list={step.options.length ? `route-${key}` : undefined}
                  className={inputClass}
                  aria-label={step.label}
                />
                {step.options.length > 0 && (
                  <datalist id={`route-${key}`}>
                    {step.options.map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DeadlinesEditor({ deadlines, onChange }: { deadlines: Deadline[]; onChange: (d: Deadline[]) => void }) {
  const [preset, setPreset] = useState(-1);
  const [fromDate, setFromDate] = useState("");

  function update(index: number, patch: Partial<Deadline>) {
    onChange(deadlines.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function add() {
    if (preset >= 0) {
      if (!fromDate) return;
      const p = deadlinePresets[preset];
      onChange([...deadlines, { id: "", date: addMonths(fromDate, p.months), title: p.title, done: false }]);
      setFromDate("");
    } else {
      onChange([...deadlines, { id: "", date: today(), title: "", done: false }]);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 sm:col-span-2 dark:border-zinc-800">
      <span className="text-sm font-medium">Сроки и события</span>
      {deadlines.length === 0 && <p className="text-xs text-zinc-400">Сроков пока нет.</p>}
      <ul className="flex flex-col gap-2">
        {deadlines.map((d, i) => {
          const days = daysUntil(d.date);
          return (
            <li key={d.id || i} className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={d.done} onChange={(e) => update(i, { done: e.target.checked })} aria-label="Выполнено" />
              <input
                type="date"
                value={d.date}
                onChange={(e) => update(i, { date: e.target.value })}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <input
                value={d.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Что должно произойти"
                className={`${inputClass} min-w-48 flex-1 ${d.done ? "text-zinc-400 line-through" : ""}`}
              />
              <span className={`text-xs ${dueColor(days, d.done)}`}>{d.done ? "выполнено" : dueLabel(days)}</span>
              <button type="button" onClick={() => onChange(deadlines.filter((_, j) => j !== i))} className="text-xs text-rose-600 hover:underline">
                удалить
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <select value={preset} onChange={(e) => setPreset(Number(e.target.value))} className={`${inputClass} w-auto max-w-full`} aria-label="Шаблон срока">
          <option value={-1}>Свой срок</option>
          {deadlinePresets.map((p, i) => (
            <option key={p.title} value={i}>
              {p.title}
            </option>
          ))}
        </select>
        {preset >= 0 && (
          <label className="flex items-center gap-1 text-xs text-zinc-500">
            {deadlinePresets[preset].from}:
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        )}
        <button
          type="button"
          onClick={add}
          disabled={preset >= 0 && !fromDate}
          className="text-sm text-zinc-700 underline-offset-2 hover:underline disabled:text-zinc-300 dark:text-zinc-300"
        >
          + добавить срок
        </button>
      </div>
      <p className="text-xs text-zinc-400">Шаблоны считают дату автоматически, но сам срок по вашему участку нужно сверить с законом и документами.</p>
    </div>
  );
}

function ObligationsEditor({
  obligations,
  holding,
  onChange,
}: {
  obligations: Obligation[];
  holding: boolean;
  onChange: (o: Obligation[]) => void;
}) {
  const currentYear = new Date().getFullYear();
  const years = [...new Set([currentYear, ...obligations.map((o) => Number(o.date.slice(0, 4)))])].sort();
  const [year, setYear] = useState(currentYear);
  const summary = summarizeYear(obligations, year, holding);
  // Индексы в общем массиве, чтобы правка строки выбранного года меняла нужную запись
  const rows = obligations.map((o, i) => ({ o, i })).filter(({ o }) => o.date.startsWith(`${year}-`));

  function update(index: number, patch: Partial<Obligation>) {
    onChange(obligations.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  function add(kind: ObligationKind) {
    const date = year === currentYear ? today() : `${year}-01-01`;
    onChange([...obligations, { id: "", date, kind, title: "", amount: null, done: false, evidence: "" }]);
  }

  // Перенести записи года на следующий как план: удобно для ежегодной аренды и работ
  function repeatNextYear() {
    const next = rows.map(({ o }) => ({
      ...o,
      id: "",
      date: addMonths(o.date, 12),
      done: false,
      evidence: "",
    }));
    onChange([...obligations, ...next]);
    setYear(year + 1);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 sm:col-span-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Паспорт обязательств</span>
        <div className="flex flex-wrap gap-1">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`rounded-full px-3 py-1 text-xs ${y === year ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}
            >
              {y}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setYear(Math.max(...years) + 1)}
            className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:text-zinc-800"
            aria-label="Следующий год"
          >
            +
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
          <div className="text-zinc-500">Аренда оплачена</div>
          <div className="font-medium">
            {money(summary.rentPaid)} из {money(summary.rentPlanned)}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
          <div className="text-zinc-500">Сельхозработ выполнено</div>
          <div className="font-medium">{summary.worksDone}</div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
          <div className="text-zinc-500">Подтверждений</div>
          <div className="font-medium">{summary.evidence}</div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
          <div className="text-zinc-500">Потрачено за год</div>
          <div className="font-medium">{money(summary.expenses)}</div>
        </div>
      </div>
      {summary.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-rose-700 dark:text-rose-400">
          {summary.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {rows.length === 0 && <p className="text-xs text-zinc-400">За {year} год записей нет.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map(({ o, i }) => (
          <li key={o.id || `new-${i}`} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={o.done} onChange={(e) => update(i, { done: e.target.checked })} aria-label="Выполнено" />
              <input
                type="date"
                value={o.date}
                onChange={(e) => e.target.value && update(i, { date: e.target.value })}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <select
                value={o.kind}
                onChange={(e) => update(i, { kind: e.target.value as ObligationKind })}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                aria-label="Вид записи"
              >
                {(Object.keys(obligationKinds) as ObligationKind[]).map((k) => (
                  <option key={k} value={k}>{obligationKinds[k]}</option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                value={o.amount ?? ""}
                onChange={(e) => update(i, { amount: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="₽"
                className="w-28 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                aria-label="Сумма, ₽"
              />
              <button type="button" onClick={() => onChange(obligations.filter((_, j) => j !== i))} className="ml-auto text-xs text-rose-600 hover:underline">
                удалить
              </button>
            </div>
            <input
              value={o.title}
              onChange={(e) => update(i, { title: e.target.value })}
              placeholder="Что именно: покос 10 га, платёж за II квартал…"
              className={inputClass}
              aria-label="Описание"
            />
            <input
              value={o.evidence}
              onChange={(e) => update(i, { evidence: e.target.value })}
              placeholder="Чем подтверждено: акт, договор подряда, фото, платёжка (название или ссылка)"
              className={inputClass}
              aria-label="Подтверждение"
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        <span className="text-xs text-zinc-500">Добавить:</span>
        {(Object.keys(obligationKinds) as ObligationKind[]).map((k) => (
          <button key={k} type="button" onClick={() => add(k)} className="text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">
            + {obligationKinds[k].toLowerCase()}
          </button>
        ))}
        {rows.length > 0 && (
          <button type="button" onClick={repeatNextYear} className="ml-auto text-xs text-zinc-500 hover:text-zinc-800">
            Повторить на {year + 1} год как план
          </button>
        )}
      </div>
    </div>
  );
}

function EconomicsSummary({ result, areaHa }: { result: EconomicsResult; areaHa: number | null }) {
  if (!result.ok) {
    return <p className="text-xs text-zinc-500">Для расчёта не хватает: {result.missing.join(", ")}.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-2 font-normal">Сценарий</th>
              <th className="py-1 pr-2 text-right font-normal">Вложено</th>
              <th className="py-1 pr-2 text-right font-normal">Получено</th>
              <th className="py-1 pr-2 text-right font-normal">Итог</th>
              <th className="py-1 text-right font-normal">С учётом стоимости денег</th>
            </tr>
          </thead>
          <tbody>
            {result.scenarios.map((s) => (
              <tr key={s.key} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1 pr-2">{s.label}</td>
                <td className="whitespace-nowrap py-1 pr-2 text-right">{money(s.invested)}</td>
                <td className="whitespace-nowrap py-1 pr-2 text-right">{money(s.received)}</td>
                <td className={`whitespace-nowrap py-1 pr-2 text-right font-medium ${moneyColor(s.profit)}`}>{money(s.profit)}</td>
                <td className={`whitespace-nowrap py-1 text-right ${moneyColor(s.profitAfterCapital)}`}>{money(s.profitAfterCapital)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.breakEvenPerHa !== null && areaHa && (
        <p className="text-xs text-zinc-500">
          Выкуп окупается, если продать дороже {money(result.breakEvenPerHa)} за га (весь участок — {money(result.breakEvenPerHa * areaHa)}).
        </p>
      )}
    </div>
  );
}

const verdictColors: Record<VriVerdict, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  no: "text-rose-600",
  check: "text-amber-700 dark:text-amber-400",
};

// Что классификатор ВРИ говорит о виде использования участка
function VriHint({ permittedUse, vri }: { permittedUse: string; vri: VriOverrides }) {
  const use = classifyUse(permittedUse, vri);
  if (!use) return <span className="block text-xs text-zinc-500">вид не найден в классификаторе — оцените вручную</span>;
  return (
    <span className={`block text-xs ${verdictColors[use.verdict]}`}>
      {use.entry.code} «{use.entry.name}»: {vriVerdicts[use.verdict]}
      {use.verdict !== "ok" && use.entry.note ? ` — ${use.entry.note}` : ""}
      {use.verdict === "no" ? ", участок исключается" : ""}
    </span>
  );
}

function VriForm({ vri, onClose, onSaved }: { vri: VriOverrides; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, VriVerdict>>(() =>
    Object.fromEntries(vriClassifier.map((e) => [e.code, vri[e.code] ?? e.verdict])),
  );
  // По порядку кодов классификатора: 1.0, 1.1 … 1.20, затем 2.2, 7.1 …
  const entries = [...vriClassifier].sort((a, b) => a.code.localeCompare(b.code, "ru", { numeric: true }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api("/api/settings", "PATCH", { vri: form });
    onSaved();
  }

  return (
    <Modal title="Виды разрешённого использования" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500">
          Классификатор ВРИ (приказ Росреестра № П/0412). ВРИ участка сопоставляется с ним по коду или формулировке: «не
          подходит» исключает участок, «подходит» ставит стоп-фактору «да», «проверить» оставляет решение вам.
        </p>
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {entries.map((e) => (
            <li key={e.code} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="w-12 shrink-0 text-xs text-zinc-500">{e.code}</span>
              <span className="flex-1">
                {e.name}
                {e.note && <span className="block text-xs text-zinc-500">{e.note}</span>}
              </span>
              <select
                value={form[e.code]}
                onChange={(ev) => setForm((f) => ({ ...f, [e.code]: ev.target.value as VriVerdict }))}
                className={`shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 ${verdictColors[form[e.code]]}`}
                aria-label={e.name}
              >
                {(Object.keys(vriVerdicts) as VriVerdict[]).map((v) => (
                  <option key={v} value={v}>{vriVerdicts[v]}{v === e.verdict ? " (по умолчанию)" : ""}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
            Сохранить
          </button>
          <button
            type="button"
            onClick={() => setForm(Object.fromEntries(vriClassifier.map((e) => [e.code, e.verdict])))}
            className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800"
          >
            Вернуть исходные
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WeightsForm({ weights, onClose, onSaved }: { weights: Weights; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Weights>(weights);
  const total = (Object.keys(criteria) as Criterion[]).reduce((sum, k) => sum + (form[k] || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api("/api/settings", "PATCH", { weights: form });
    onSaved();
  }

  return (
    <Modal title="Веса критериев оценки" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500">
          Условные веса из концепции. Меняйте их, когда на реальных участках станет видно, что важнее. Итог считается
          пропорционально, поэтому сумма не обязана быть ровно 100.
        </p>
        {(Object.keys(criteria) as Criterion[]).map((key) => (
          <label key={key} className="flex items-center justify-between gap-3 text-sm">
            {criteria[key].label}
            <input
              type="number"
              min="0"
              max="100"
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
              className="w-20 shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-right text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        ))}
        <p className={`text-xs ${total === 100 ? "text-zinc-500" : "text-amber-600"}`}>Сумма: {total}</p>
        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
            Сохранить
          </button>
          <button type="button" onClick={() => setForm(defaultWeights)} className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800">
            Вернуть исходные
          </button>
        </div>
      </form>
    </Modal>
  );
}

const NSPD_MAP = "https://nspd.gov.ru/map?thematic=PKK";

// Вставка скопированной карточки участка из НСПД: раскладывает сведения по полям формы
function NspdPaste({ form, onApply }: { form: PlotInput; onApply: (patch: Partial<PlotInput>) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function apply() {
    const card = parseNspdCard(text);
    const current = normalizeCadastralNumber(form.cadastralNumber);
    if (card.cadastralNumber && current && card.cadastralNumber !== current) {
      setMessage({ ok: false, text: `В карточке другой участок: ${card.cadastralNumber}. Ничего не изменено.` });
      return;
    }
    const patch: Partial<PlotInput> = {};
    const filled: string[] = [];
    if (card.cadastralNumber && !current) {
      patch.cadastralNumber = card.cadastralNumber;
      filled.push("кадастровый номер");
    }
    const region = regionByCadastralNumber(card.cadastralNumber ?? current);
    if (region && region !== form.region) {
      patch.region = region;
      filled.push("регион");
    }
    if (card.district && !form.district.trim()) {
      patch.district = card.district;
      filled.push("район");
    }
    if (card.areaHa !== undefined) {
      patch.areaHa = card.areaHa;
      filled.push("площадь");
    }
    if (card.cadastralValue !== undefined) {
      patch.cadastralValue = card.cadastralValue;
      filled.push("кадастровая стоимость");
    }
    if (card.landCategory) {
      patch.landCategory = card.landCategory;
      // Категория — первый стоп-фактор: её НСПД показывает достоверно
      patch.checks = { ...form.checks, category: isAgriculturalLand(card.landCategory) ? "yes" : "no" };
      filled.push("категория (и стоп-фактор)");
    }
    if (card.permittedUse) {
      patch.permittedUse = card.permittedUse;
      filled.push("ВРИ");
    }
    if (card.owner) {
      patch.owner = card.owner;
      filled.push("собственник");
    }
    const notes: string[] = [];
    if (card.address && !form.notes.includes(card.address)) notes.push(`Адрес по НСПД: ${card.address}`);
    if (card.parts.length && !form.notes.includes(card.parts[0])) {
      notes.push(`В НСПД есть части участка (${card.parts.join(", ")}) — часто это обременения или зоны, проверить по выписке ЕГРН.`);
    }
    if (notes.length) {
      patch.notes = [form.notes.trim(), `НСПД, ${formatDay(today())}:`, ...notes].filter(Boolean).join("\n");
      filled.push("заметки");
    }
    if (!filled.length) {
      setMessage({
        ok: false,
        text: "Не нашёл в тексте полей карточки НСПД. Скопируйте карточку целиком, от «Вид объекта недвижимости» до «Кадастровая стоимость».",
      });
      return;
    }
    patch.nspdCheckedAt = today();
    if (form.status === "found") patch.status = "checking";
    onApply(patch);
    setText("");
    setMessage({
      ok: true,
      text: `Заполнено: ${filled.join(", ")}. Первый шаг пройден${form.status === "found" ? ", статус — «На проверке»" : ""}. Сохраните участок.`,
    });
  }

  async function copyNumber() {
    await navigator.clipboard.writeText(form.cadastralNumber.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-3 text-sm sm:col-span-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} className="font-medium hover:underline">
          {open ? "▾" : "▸"} Вставить карточку из НСПД
        </button>
        {form.nspdCheckedAt && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ сверено с НСПД {formatDay(form.nspdCheckedAt)}
          </span>
        )}
        {form.cadastralNumber.trim() && (
          <button type="button" onClick={copyNumber} className="text-xs text-zinc-500 hover:text-zinc-800">
            {copied ? "номер скопирован" : "скопировать номер"}
          </button>
        )}
        <a href={NSPD_MAP} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline dark:text-sky-400">
          открыть НСПД ↗
        </a>
      </div>
      {open && (
        <>
          <p className="text-xs text-zinc-500">
            В НСПД найдите участок по номеру, откройте карточку, выделите её текст мышкой (от «Вид объекта недвижимости»
            до «Кадастровая стоимость»), скопируйте и вставьте сюда. Аренду и обременения НСПД не показывает — их смотрят
            в выписке ЕГРН.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className={inputClass}
            placeholder={"Вид объекта недвижимости\nЗемельный участок\n…"}
          />
          <button
            type="button"
            onClick={apply}
            disabled={!text.trim()}
            className="self-start rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Заполнить поля
          </button>
        </>
      )}
      {message && <p className={`text-xs ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}`}>{message.text}</p>}
    </div>
  );
}

// Читает текст первого файла из ZIP (выгрузка НСПД приходит архивом с одним CSV)
async function readZipText(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  let end = buf.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Не удалось прочитать архив");
  const entry = view.getUint32(end + 16, true);
  const method = view.getUint16(entry + 10, true);
  const size = view.getUint32(entry + 20, true);
  const local = view.getUint32(entry + 42, true);
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = buf.slice(start, start + size);
  if (method === 0) return new TextDecoder().decode(data);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function ImportForm({ plots, onClose, onSaved }: { plots: Plot[]; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState(() => `НСПД, выгрузка от ${formatDay(today())}`);
  const [owner, setOwner] = useState<keyof typeof owners>("unknown");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ created: number; skipped: string[] } | null>(null);

  const numbers = useMemo(() => extractCadastralNumbers(text), [text]);
  const known = useMemo(() => new Set(plots.map((p) => normalizeCadastralNumber(p.cadastralNumber))), [plots]);
  const fresh = numbers.filter((n) => !known.has(n));

  async function loadFile(file: File) {
    try {
      setError("");
      setText(/\.zip$/i.test(file.name) ? await readZipText(file) : await file.text());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submit() {
    try {
      setResult(await api("/api/plots/import", "POST", { numbers: fresh, sourceName, owner }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Импорт из НСПД" onClose={result ? onSaved : onClose}>
      {result ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Добавлено участков: <b>{result.created}</b>. Источник — «{sourceName}», статус «Найден».
          </p>
          <p className="text-zinc-500">
            Дальше по каждому: откройте участок, нажмите «Вставить карточку из НСПД» — заполнятся категория, ВРИ,
            собственник и площадь, а неподходящие (не сельхозземли, ЛПХ, дороги) сразу отсеются.
          </p>
          <button
            onClick={onSaved}
            className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Готово
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="list-decimal pl-5 text-sm text-zinc-500">
            <li>
              В{" "}
              <a href={NSPD_MAP} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline dark:text-sky-400">
                НСПД
              </a>{" "}
              — кнопка фильтра у строки поиска → «Поиск по атрибуту слоя» → «Земельные участки ЕГРН». Три условия сразу:
              <b> вид разрешенного использования</b> содержит «сельскохозяйствен», <b>адрес</b> содержит «Новоржевский»,
              <b> форма собственности</b> содержит «Муниципальная» (или «субъекта»). Так дороги, кладбища и частные
              участки в список не попадут. Другие подходящие ВРИ — отдельными поисками: «растениевод», «животновод»,
              «крестьянск», «садоводство».
            </li>
            <li>
              НСПД показывает не больше 40 участков за один поиск («Поиск прекращён… Уточните параметры»). Делите поиск
              на части условием <b>«Кадастровая стоимость»</b> — «Больше» / «Меньше»: у сельхозземли она около 1 ₽ за кв. м,
              то есть примерно равна площади (например, 20 000–100 000 ₽ ≈ 2–10 га, 100 000–400 000 ₽, больше 400 000 ₽).
              Условие «Площадь, кв.м» в НСПД не работает — ничего не находит. Ещё можно сузить <b>адрес</b> до волости.
              Каждую часть скачивайте и импортируйте — повторы пропустятся.
            </li>
            <li>«Скачать список объектов» и выберите скачанный файл ниже (можно прямо ZIP) или вставьте номера текстом.</li>
          </ol>
          <input
            type="file"
            accept=".zip,.csv,.txt"
            onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-sm dark:file:bg-zinc-800"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className={inputClass}
            placeholder="Кадастровые номера — в любом виде, по одному или списком"
          />
          <p className="text-sm">
            Найдено номеров: <b>{numbers.length}</b>
            {numbers.length > 0 && (
              <>
                {" "}
                · уже в реестре: {numbers.length - fresh.length} · новых: <b>{fresh.length}</b>
              </>
            )}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Источник">
              <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Собственник (если фильтровали по нему в НСПД)">
              <select value={owner} onChange={(e) => setOwner(e.target.value as keyof typeof owners)} className={inputClass}>
                {Object.entries(owners).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={!fresh.length}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Добавить {fresh.length || ""} в реестр
            </button>
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800">
              Отмена
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PlotForm({
  plot,
  sources,
  settings,
  onClose,
  onSaved,
}: {
  plot: Plot | null;
  sources: Source[];
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PlotInput>(() => (plot ? { ...plot } : emptyPlot()));
  const [error, setError] = useState("");
  const set = <K extends keyof PlotInput>(key: K, value: PlotInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.cadastralNumber.trim() && !form.title.trim()) {
      setError("Укажите кадастровый номер или название участка");
      return;
    }
    try {
      await (plot ? api(`/api/plots/${plot.id}`, "PATCH", form) : api("/api/plots", "POST", form));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove() {
    if (!plot) return;
    try {
      await api(`/api/plots/${plot.id}`, "DELETE");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Отклонить — сохранить со статусом «Отклонён»: участок остаётся в реестре и повторно не импортируется
  async function reject() {
    if (!plot) return;
    try {
      await api(`/api/plots/${plot.id}`, "PATCH", { ...form, status: "rejected" });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={plot ? "Участок" : "Новый участок"} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {plot && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
            {form.status !== "rejected" && (
              <button
                type="button"
                onClick={reject}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:border-zinc-500 dark:border-zinc-700"
                title="Участок останется в реестре со статусом «Отклонён» и не добавится повторно при импорте"
              >
                Не подходит — отклонить
              </button>
            )}
            <ConfirmButton label="Удалить участок" question="Удалить совсем?" onConfirm={remove} />
            <span className="text-xs text-zinc-500">
              Отклонённый остаётся в реестре и не вернётся при импорте; удалённый может добавиться снова.
            </span>
          </div>
        )}
        <p className="flex flex-wrap gap-x-3 text-sm sm:col-span-2">
          <ProgressLine progress={checkProgress(form, settings.vri)} />
        </p>
        <NspdPaste form={form} onApply={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        <Field label="Кадастровый номер">
          <input
            value={form.cadastralNumber}
            onChange={(e) => {
              const value = e.target.value;
              const region = regionByCadastralNumber(value);
              // Регион подставляем по номеру, пока его не меняли вручную
              setForm((f) => ({
                ...f,
                cadastralNumber: value,
                ...(region && (!f.region.trim() || f.region === regionByCadastralNumber(f.cadastralNumber) || f.region === defaultRegion) && { region }),
              }));
            }}
            placeholder="60:00:0000000:000"
            className={inputClass}
          />
        </Field>
        <Field label="Название (если нет номера)">
          <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Поле у д. ..." className={inputClass} />
        </Field>
        <Field label="Статус">
          <select value={form.status} onChange={(e) => set("status", e.target.value as PlotInput["status"])} className={inputClass}>
            {Object.entries(plotStatuses).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Направление">
          <select value={form.direction} onChange={(e) => set("direction", e.target.value as PlotInput["direction"])} className={inputClass}>
            {Object.entries(plotDirections).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Регион">
          <input value={form.region} onChange={(e) => set("region", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Район / поселение">
          <input value={form.district} onChange={(e) => set("district", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Площадь, га">
          <input
            type="number"
            step="any"
            min="0"
            value={form.areaHa ?? ""}
            onChange={(e) => set("areaHa", e.target.value === "" ? null : Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Кадастровая стоимость, ₽">
          <input
            type="number"
            step="any"
            min="0"
            value={form.cadastralValue ?? ""}
            onChange={(e) => set("cadastralValue", e.target.value === "" ? null : Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Собственник">
          <select value={form.owner} onChange={(e) => set("owner", e.target.value as PlotInput["owner"])} className={inputClass}>
            {Object.entries(owners).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Категория земель">
          <input value={form.landCategory} onChange={(e) => set("landCategory", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Вид разрешённого использования">
          <input value={form.permittedUse} onChange={(e) => set("permittedUse", e.target.value)} className={inputClass} />
          {form.permittedUse.trim() && <VriHint permittedUse={form.permittedUse} vri={settings.vri} />}
        </Field>
        <Field label="Источник" wide>
          <select value={form.sourceId} onChange={(e) => set("sourceId", e.target.value)} className={inputClass}>
            <option value="">— не указан —</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Ссылки и документы (по одной в строке)" wide>
          <textarea value={form.links} onChange={(e) => set("links", e.target.value)} rows={2} className={inputClass} />
        </Field>
        <Field label="Заметки" wide>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={inputClass} />
        </Field>
        <AssessmentEditor
          form={form}
          settings={settings}
          onChecks={(checks) => set("checks", checks)}
          onScores={(scores) => set("scores", scores)}
        />
        <EconomicsEditor economics={form.economics} areaHa={form.areaHa} onChange={(e) => set("economics", e)} />
        <RouteEditor route={form.route} onChange={(r) => set("route", r)} />
        <DeadlinesEditor deadlines={form.deadlines} onChange={(d) => set("deadlines", d)} />
        <ObligationsEditor
          obligations={form.obligations}
          holding={holdingStatuses.includes(form.status)}
          onChange={(o) => set("obligations", o)}
        />
        <FindingsEditor findings={form.findings} onChange={(f) => set("findings", f)} />

        {error && <p className="text-sm text-rose-600 sm:col-span-2">{error}</p>}
        <div className="flex items-center gap-2 sm:col-span-2">
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
            Сохранить
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800">
            Отмена
          </button>
          {plot && (
            <span className="ml-auto">
              <ConfirmButton label="Удалить участок" question="Удалить совсем?" onConfirm={remove} />
            </span>
          )}
        </div>
      </form>
    </Modal>
  );
}

function SourceForm({
  source,
  plots,
  onClose,
  onSaved,
}: {
  source: Source | null;
  plots: Plot[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const own = source ? plots.filter((p) => p.sourceId === source.id) : [];
  const kept = own.filter((p) => workingStatuses.includes(p.status)).length;
  const [form, setForm] = useState<SourceInput>(() => (source ? { ...source } : emptySource()));
  const [error, setError] = useState("");
  const set = <K extends keyof SourceInput>(key: K, value: SourceInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Укажите название источника");
      return;
    }
    try {
      await (source ? api(`/api/sources/${source.id}`, "PATCH", form) : api("/api/sources", "POST", form));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(withPlots = false) {
    if (!source) return;
    try {
      await api(`/api/sources/${source.id}${withPlots ? "?withPlots=1" : ""}`, "DELETE");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={source ? "Источник" : "Новый источник"} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Название" wide>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Фонд перераспределения Псковской области" className={inputClass} />
        </Field>
        <Field label="Тип">
          <select value={form.type} onChange={(e) => set("type", e.target.value as SourceInput["type"])} className={inputClass}>
            {Object.entries(sourceTypes).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Регион">
          <input value={form.region} onChange={(e) => set("region", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Ссылка" wide>
          <input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://..." className={inputClass} />
        </Field>
        <Field label="Заметки (что содержит, как часто обновляется, на что обратить внимание)" wide>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={4} className={inputClass} />
        </Field>
        {error && <p className="text-sm text-rose-600 sm:col-span-2">{error}</p>}
        <div className="flex items-center gap-2 sm:col-span-2">
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
            Сохранить
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800">
            Отмена
          </button>
          {source && (
            <span className="ml-auto">
              <ConfirmButton label="Удалить источник" question="Участки останутся без ссылки на него. Удалить?" onConfirm={() => remove()} />
            </span>
          )}
        </div>
        {own.length - kept > 0 && (
          <div className="flex flex-col gap-1 rounded-xl border border-rose-200 p-3 text-sm sm:col-span-2 dark:border-rose-900">
            <ConfirmButton
              label={`Удалить источник вместе с его участками (${own.length - kept})`}
              question={`Удалить ${own.length - kept} участк. безвозвратно?`}
              onConfirm={() => remove(true)}
            />
            <span className="text-xs text-zinc-500">
              Для неудачной выгрузки: очистит список, после чего можно импортировать заново с другими фильтрами.
              {kept > 0 && ` Участки, с которыми уже идёт работа (${kept}: на проверке, перспективные и дальше), останутся.`}
            </span>
          </div>
        )}
      </form>
    </Modal>
  );
}

// Коротко в списке: лучший сценарий с выкупом и сценарий, где выкуп сорвался
function PlotEconomicsLine({ plot }: { plot: Plot }) {
  const result = calculate(plot.economics, plot.areaHa);
  if (!result.ok) return null;
  const best = result.scenarios.find((s) => s.key !== "failed");
  const failed = result.scenarios.find((s) => s.key === "failed")!;
  return (
    <span>
      экономика:{" "}
      {best && <span className={moneyColor(best.profit)}>{money(best.profit, true)}</span>}
      {" / без выкупа "}
      <span className={moneyColor(failed.profit)}>{money(failed.profit, true)}</span>
    </span>
  );
}

// Сроки участка вместе с запланированными обязательствами (платежи, работы) — для календаря
function plotDeadlines(plot: Plot): Deadline[] {
  const fromObligations = plot.obligations.map((o) => ({
    id: o.id,
    date: o.date,
    title: `${obligationKinds[o.kind]}${o.title ? `: ${o.title}` : ""}${o.amount ? ` — ${money(o.amount)}` : ""}`,
    done: o.done,
  }));
  return [...plot.deadlines, ...fromObligations].sort((a, b) => a.date.localeCompare(b.date));
}

// Коротко в списке: сколько шагов маршрута пройдено, ближайший срок и риски паспорта за текущий год
function PlotRouteLine({ plot }: { plot: Plot }) {
  const steps = Object.values(plot.route);
  const done = steps.filter((s) => s.done).length;
  const next = plotDeadlines(plot).find((d) => !d.done);
  const holding = holdingStatuses.includes(plot.status);
  const warnings = holding ? summarizeYear(plot.obligations, new Date().getFullYear(), true).warnings : [];
  if (!done && !next && !warnings.length) return null;
  const days = next ? daysUntil(next.date) : 0;
  return (
    <>
      {warnings.map((w) => (
        <span key={w} className="text-rose-700 dark:text-rose-400">
          ⚠ {w}
        </span>
      ))}
      {done > 0 && (
        <span>
          маршрут: {done}/{steps.length}
        </span>
      )}
      {next && (
        <span className={dueColor(days, false)}>
          срок {formatDay(next.date)} ({dueLabel(days)})
        </span>
      )}
    </>
  );
}

// Раздел списка: регион и район участка (в поле «район» после запятой бывает поселение — его отбрасываем)
const regionOf = (p: Plot) => p.region.trim() || "Регион не указан";
const districtOf = (p: Plot) => p.district.split(",")[0].trim() || "Район не указан";

type Place = { region: string | null; district: string | null };

// Где участок в проверке: отметка «НСПД ✓» и следующий шаг
function ProgressLine({ progress }: { progress: CheckProgress }) {
  return (
    <>
      {progress.nspd && <span className="text-emerald-700 dark:text-emerald-400">✓ НСПД</span>}
      {progress.next && <span className="text-sky-700 dark:text-sky-400">далее: {progress.next}</span>}
    </>
  );
}

function PlotCard({
  plot: p,
  assessment,
  progress,
  sourceName,
  onEdit,
}: {
  plot: Plot;
  assessment: Assessment;
  progress: CheckProgress;
  sourceName?: string;
  onEdit: () => void;
}) {
  const unverified = p.findings.filter((f) => !f.verified).length;
  return (
    <button
      onClick={onEdit}
      className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{p.cadastralNumber || p.title}</span>
        {p.cadastralNumber && p.title && <span className="text-sm text-zinc-500">{p.title}</span>}
        <span className="ml-auto flex items-center gap-2">
          <AssessmentBadge assessment={assessment} />
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[p.status]}`}>{plotStatuses[p.status]}</span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        <ProgressLine progress={progress} />
        {p.district.includes(",") && <span>{p.district.split(",").slice(1).join(",").trim()}</span>}
        {p.areaHa !== null && <span>{p.areaHa.toLocaleString("ru-RU")} га</span>}
        <span>{owners[p.owner]}</span>
        {sourceName && <span>источник: {sourceName}</span>}
        {p.findings.length > 0 && (
          <span className={unverified ? "text-amber-600" : "text-emerald-600"}>
            выводов: {p.findings.length}
            {unverified ? `, не проверено: ${unverified}` : ", все проверены"}
          </span>
        )}
        <PlotEconomicsLine plot={p} />
        <PlotRouteLine plot={p} />
        <span className="ml-auto">изм. {dateFormat.format(new Date(p.updatedAt))}</span>
      </div>
    </button>
  );
}

// Дерево «регион → районы» со счётчиками; выбор сужает список
function RegionTree({ plots, place, onChange }: { plots: Plot[]; place: Place; onChange: (p: Place) => void }) {
  const tree = useMemo(() => {
    const regions = new Map<string, Map<string, number>>();
    for (const p of plots) {
      const districts = regions.get(regionOf(p)) ?? new Map<string, number>();
      districts.set(districtOf(p), (districts.get(districtOf(p)) ?? 0) + 1);
      regions.set(regionOf(p), districts);
    }
    return [...regions.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ru"))
      .map(([region, districts]) => ({
        region,
        total: [...districts.values()].reduce((sum, n) => sum + n, 0),
        districts: [...districts.entries()].sort(([a], [b]) => a.localeCompare(b, "ru")),
      }));
  }, [plots]);

  const item = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm ${active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`;

  return (
    <>
      {/* Узкий экран — выпадающий список */}
      <select
        value={place.district ? `${place.region}|${place.district}` : place.region ?? ""}
        onChange={(e) => {
          const [region, district] = e.target.value.split("|");
          onChange({ region: region || null, district: district || null });
        }}
        className={`${inputClass} mb-3 lg:hidden`}
        aria-label="Регион и район"
      >
        <option value="">Все регионы · {plots.length}</option>
        {tree.map((r) => (
          <optgroup key={r.region} label={r.region}>
            <option value={r.region}>{r.region} — все районы · {r.total}</option>
            {r.districts.map(([d, n]) => (
              <option key={d} value={`${r.region}|${d}`}>{d} · {n}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Широкий экран — дерево слева */}
      <nav className="hidden flex-col gap-0.5 lg:flex" aria-label="Регионы и районы">
        <button onClick={() => onChange({ region: null, district: null })} className={item(!place.region)}>
          <span>Все регионы</span>
          <span className="text-xs opacity-70">{plots.length}</span>
        </button>
        {tree.map((r) => (
          <div key={r.region} className="mt-2 flex flex-col gap-0.5">
            <button onClick={() => onChange({ region: r.region, district: null })} className={`${item(place.region === r.region && !place.district)} font-medium`}>
              <span>{r.region}</span>
              <span className="text-xs opacity-70">{r.total}</span>
            </button>
            {r.districts.map(([d, n]) => (
              <button
                key={d}
                onClick={() => onChange({ region: r.region, district: d })}
                className={`${item(place.region === r.region && place.district === d)} pl-5`}
              >
                <span>{d}</span>
                <span className="text-xs opacity-70">{n}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

type SortMode = "checked" | "areaAsc" | "area" | "score" | "updated";

function PlotsView({ data, onEdit }: { data: Data; onEdit: (plot: Plot | null) => void }) {
  const [status, setStatus] = useState<PlotStatus | "all">("all");
  const [place, setPlace] = useState<Place>({ region: null, district: null });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("checked");
  const sourceNames = useMemo(() => new Map(data.sources.map((s) => [s.id, s.name])), [data.sources]);

  const counts = useMemo(() => {
    const result: Partial<Record<PlotStatus, number>> = {};
    for (const p of data.plots) result[p.status] = (result[p.status] ?? 0) + 1;
    return result;
  }, [data.plots]);

  const assessments = useMemo(
    () => new Map(data.plots.map((p) => [p.id, assess(p, data.settings.weights, data.settings.vri)])),
    [data.plots, data.settings.weights, data.settings.vri],
  );
  // Для сортировки: оценённые по баллу, затем недооценённые, исключённые в конце
  const rank = (a: Assessment) => (a.kind === "scored" ? a.score : a.kind === "incomplete" ? -1 : -2);

  const q = query.trim().toLowerCase();
  const plots = data.plots.filter(
    (p) =>
      (status === "all" || p.status === status) &&
      (!place.region || regionOf(p) === place.region) &&
      (!place.district || districtOf(p) === place.district) &&
      (!q || [p.cadastralNumber, p.title, p.district, p.notes].some((v) => v.toLowerCase().includes(q))),
  );
  // Площадь без значения — в конец списка
  const areaAsc = (a: Plot, b: Plot) => (a.areaHa ?? Infinity) - (b.areaHa ?? Infinity);
  // Сначала сверенные с НСПД, потом ещё не сверенные, исключённые — в самом низу
  const stage = (p: Plot) => (assessments.get(p.id)!.kind === "excluded" ? 2 : p.nspdCheckedAt ? 0 : 1);
  if (sort === "checked") plots.sort((a, b) => stage(a) - stage(b) || areaAsc(a, b));
  if (sort === "score") plots.sort((a, b) => rank(assessments.get(b.id)!) - rank(assessments.get(a.id)!));
  if (sort === "areaAsc") plots.sort(areaAsc);
  if (sort === "area") plots.sort((a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0));

  // Разделы: регион → район; внутри раздела — выбранная сортировка
  const groups = new Map<string, Map<string, Plot[]>>();
  for (const p of plots) {
    const districts = groups.get(regionOf(p)) ?? new Map<string, Plot[]>();
    districts.set(districtOf(p), [...(districts.get(districtOf(p)) ?? []), p]);
    groups.set(regionOf(p), districts);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .map(([region, districts]) => ({ region, districts: [...districts.entries()].sort(([a], [b]) => a.localeCompare(b, "ru")) }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <RegionTree plots={data.plots} place={place} onChange={setPlace} />
      </aside>
      <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatus("all")}
          className={`rounded-full px-3 py-1 text-xs ${status === "all" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-white dark:bg-zinc-900"}`}
        >
          Все · {data.plots.length}
        </button>
        {(Object.keys(plotStatuses) as PlotStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs ${status === s ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : ""} ${statusColors[s]}`}
          >
            {plotStatuses[s]} · {counts[s] ?? 0}
          </button>
        ))}
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по номеру, району, заметкам"
            className={`${inputClass} sm:w-64`}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${inputClass} w-auto`} aria-label="Сортировка">
            <option value="checked">Сверенные с НСПД сверху, площадь ↑</option>
            <option value="areaAsc">По площади ↑ (от меньшей)</option>
            <option value="area">По площади ↓ (от большей)</option>
            <option value="score">По баллу</option>
            <option value="updated">Недавно изменённые</option>
          </select>
        </div>
      </div>

      {data.plots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          В реестре пока нет участков. Начните с источника на вкладке «Источники», затем добавьте участки из него.
        </div>
      ) : plots.length === 0 ? (
        <p className="text-sm text-zinc-500">Ничего не найдено.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map(({ region, districts }) => (
            <section key={region} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{region}</h2>
              {districts.map(([district, list]) => {
                const area = list.reduce((sum, p) => sum + (p.areaHa ?? 0), 0);
                const excluded = list.filter((p) => assessments.get(p.id)!.kind === "excluded").length;
                return (
                  <details key={district} open className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 border-b border-zinc-200 pb-1 dark:border-zinc-800">
                      <span className="text-zinc-400 transition group-open:rotate-90">▸</span>
                      <span className="font-medium">{district}</span>
                      <span className="text-xs text-zinc-500">
                        участков: {list.length}
                        {area > 0 && ` · ${area.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га`}
                        {excluded > 0 && ` · исключено: ${excluded}`}
                      </span>
                    </summary>
                    <ul className="mt-2 flex flex-col gap-2">
                      {list.map((p) => (
                        <li key={p.id}>
                          <PlotCard
                            plot={p}
                            assessment={assessments.get(p.id)!}
                            progress={checkProgress(p, data.settings.vri)}
                            sourceName={sourceNames.get(p.sourceId)}
                            onEdit={() => onEdit(p)}
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </section>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

function SourcesView({ data, onEdit }: { data: Data; onEdit: (source: Source) => void }) {
  if (data.sources.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Источников пока нет. Например: фонд перераспределения земель Псковской области, реестр областного имущества,
        муниципальные перечни.
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {data.sources.map((s) => {
        const count = data.plots.filter((p) => p.sourceId === s.id).length;
        return (
          <li key={s.id}>
            <button
              onClick={() => onEdit(s)}
              className="h-full w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="font-medium">{s.name}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {sourceTypes[s.type]} · {s.region} · участков: {count}
              </div>
              {s.url && <div className="mt-1 truncate text-xs text-sky-700 dark:text-sky-400">{s.url}</div>}
              {s.notes && <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{s.notes}</p>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Все сроки по всем участкам: просроченные, ближайшие 30 дней, позже, выполненные
function DeadlinesView({ data, onEdit }: { data: Data; onEdit: (plot: Plot) => void }) {
  const [showDone, setShowDone] = useState(false);
  const items = data.plots
    .flatMap((plot) => plotDeadlines(plot).map((deadline) => ({ plot, deadline, days: daysUntil(deadline.date) })))
    .sort((a, b) => a.deadline.date.localeCompare(b.deadline.date));

  const groups = [
    { title: "Просрочено", items: items.filter((i) => !i.deadline.done && i.days < 0) },
    { title: "Ближайшие 30 дней", items: items.filter((i) => !i.deadline.done && i.days >= 0 && i.days <= 30) },
    { title: "Позже", items: items.filter((i) => !i.deadline.done && i.days > 30) },
  ];
  const done = items.filter((i) => i.deadline.done);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Сроков пока нет. Их добавляют в карточке участка — в блоках «Сроки и события» и «Паспорт обязательств».
      </div>
    );
  }

  const row = ({ plot, deadline, days }: (typeof items)[number]) => (
    <li key={deadline.id}>
      <button
        onClick={() => onEdit(plot)}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-zinc-200 bg-white p-3 text-left hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <span className="w-36 shrink-0 text-sm font-medium">{formatDay(deadline.date)}</span>
        <span className={`flex-1 text-sm ${deadline.done ? "text-zinc-400 line-through" : ""}`}>{deadline.title}</span>
        <span className={`text-xs ${dueColor(days, deadline.done)}`}>{deadline.done ? "выполнено" : dueLabel(days)}</span>
        <span className="w-full text-xs text-zinc-500">
          {plot.cadastralNumber || plot.title}
          {plot.district && ` · ${plot.district}`}
        </span>
      </button>
    </li>
  );

  return (
    <div className="flex flex-col gap-5">
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-sm font-medium text-zinc-500">
              {g.title} · {g.items.length}
            </h2>
            <ul className="flex flex-col gap-2">{g.items.map(row)}</ul>
          </section>
        ))}
      {done.length > 0 && (
        <section>
          <button onClick={() => setShowDone((v) => !v)} className="mb-2 text-sm text-zinc-500 hover:text-zinc-800">
            {showDone ? "▾" : "▸"} Выполнено · {done.length}
          </button>
          {showDone && <ul className="flex flex-col gap-2">{done.map(row)}</ul>}
        </section>
      )}
    </div>
  );
}

type Editing =
  | { kind: "plot"; item: Plot | null }
  | { kind: "source"; item: Source | null }
  | { kind: "weights" }
  | { kind: "vri" }
  | { kind: "import" }
  | null;

export default function Registry() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"plots" | "deadlines" | "sources">("plots");
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      setData(await api("/api/registry", "GET"));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первая загрузка данных
    reload();
  }, [reload]);

  function saved() {
    setEditing(null);
    reload();
  }

  const open = data?.plots.flatMap((p) => plotDeadlines(p).filter((d) => !d.done)) ?? [];
  const openDeadlines = open.length;
  const overdue = open.filter((d) => daysUntil(d.date) < 0).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Земля в аренду</h1>
          <p className="text-sm text-zinc-500">Реестр земельных возможностей · пилот: Псковская область</p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {tab === "plots" && data && (
            <>
              <button
                onClick={() => setEditing({ kind: "weights" })}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:border-zinc-500 dark:border-zinc-700"
              >
                Веса оценки
              </button>
              <button
                onClick={() => setEditing({ kind: "vri" })}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:border-zinc-500 dark:border-zinc-700"
              >
                ВРИ
              </button>
              <button
                onClick={() => setEditing({ kind: "import" })}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:border-zinc-500 dark:border-zinc-700"
              >
                Импорт из НСПД
              </button>
            </>
          )}
          {tab !== "deadlines" && (
            <button
              onClick={() => setEditing(tab === "plots" ? { kind: "plot", item: null } : { kind: "source", item: null })}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {tab === "plots" ? "+ Участок" : "+ Источник"}
            </button>
          )}
        </div>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ["plots", `Участки${data ? ` (${data.plots.length})` : ""}`],
            ["deadlines", `Сроки${data ? ` (${openDeadlines})` : ""}${overdue ? ` · просрочено ${overdue}` : ""}`],
            ["sources", `Источники${data ? ` (${data.sources.length})` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === key ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {!data ? (
        <p className="text-sm text-zinc-500">Загрузка…</p>
      ) : tab === "plots" ? (
        <PlotsView data={data} onEdit={(item) => setEditing({ kind: "plot", item })} />
      ) : tab === "deadlines" ? (
        <DeadlinesView data={data} onEdit={(item) => setEditing({ kind: "plot", item })} />
      ) : (
        <SourcesView data={data} onEdit={(item) => setEditing({ kind: "source", item })} />
      )}

      {data && editing?.kind === "plot" && (
        <PlotForm
          plot={editing.item}
          sources={data.sources}
          settings={data.settings}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {data && editing?.kind === "vri" && <VriForm vri={data.settings.vri} onClose={() => setEditing(null)} onSaved={saved} />}
      {data && editing?.kind === "weights" && (
        <WeightsForm weights={data.settings.weights} onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {data && editing?.kind === "import" && (
        <ImportForm plots={data.plots} onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {data && editing?.kind === "source" && <SourceForm source={editing.item} plots={data.plots} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
}
