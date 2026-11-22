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
  type Applicant,
  type ImportRecord,
  type TorgiExportInfo,
  TORGI_EXPORT_FRESH_DAYS,
  type Source,
  type SourceInput,
  type StopFactor,
  type Weights,
} from "@/lib/registry";

import { calculate, economicsFields, type Economics, type EconomicsField, type EconomicsResult } from "@/lib/economics";
import { classifyUse, vriClassifier, vriVerdicts, type VriOverrides, type VriVerdict } from "@/lib/vri";
import { districtByCadastralNumber, districtsOfRegion, regionByCadastralNumber } from "@/lib/regions";
import { extractCadastralNumbers, isAgriculturalLand, normalizeCadastralNumber, parseNspdCard } from "@/lib/nspd";
import { ROSREESTR_ONLINE, ownershipClaimDeadline, parseRosreestrCard } from "@/lib/rosreestr";
import { TORGI_LOTS, parseTorgiExport, torgiExcludes, torgiOutcomes as lotOutcomes, type TorgiExport, type TorgiOutcome } from "@/lib/torgi";

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
// Кнопка «Сохранить» прямо в блоке проверки — чтобы не прокручивать форму вниз
function SaveHere() {
  return (
    <button
      type="submit"
      className="self-start rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
    >
      Сохранить участок
    </button>
  );
}

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
    // По 10.1 предоставляют только государственную и муниципальную землю: частный участок сразу исключаем
    if (card.owner === "private") {
      patch.checks = { ...(patch.checks ?? form.checks), route: "no" };
      if (!form.notes.includes("частная собственность")) {
        notes.push("Форма собственности — частная собственность: по ст. 10.1 такой участок не предоставляют, участок исключён (стоп-фактор «законный способ»).");
      }
    }
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
            в справочной информации Росреестра (блок ниже).
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
      {message?.ok && <SaveHere />}
    </div>
  );
}

// Второй шаг: права третьих лиц по справочной информации Росреестра (аренда, обременения, дата регистрации права)
function RightsPaste({ form, onApply }: { form: PlotInput; onApply: (patch: Partial<PlotInput>) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [applied, setApplied] = useState(false);

  function apply() {
    setApplied(false);
    const card = parseRosreestrCard(text);
    const current = normalizeCadastralNumber(form.cadastralNumber);
    if (card.cadastralNumber && current && card.cadastralNumber !== current) {
      setMessage({ tone: "bad", text: `В карточке другой участок: ${card.cadastralNumber}. Ничего не изменено.` });
      return;
    }
    if (!card.hasRightsSection) {
      setMessage({
        tone: "bad",
        text: "Не нашёл раздел «Сведения о правах и ограничениях (обременениях)». Скопируйте карточку целиком, до конца раздела прав.",
      });
      return;
    }
    const day = today();
    const describe = (r: (typeof card.records)[number]) =>
      `${r.type}${r.number ? ` № ${r.number}` : ""}${r.date ? ` от ${formatDay(r.date)}` : ""}`;
    const lines = [`Росреестр, справочная информация, ${formatDay(day)}${card.updatedAt ? ` (данные обновлены ${formatDay(card.updatedAt)})` : ""}:`];
    lines.push(card.records.length ? `Записи о правах: ${card.records.map(describe).join("; ")}`.replace(/\.?$/, ".") : "Записей о правах нет.");

    const encumbrances = card.records.filter((r) => r.kind === "encumbrance");
    const claim = ownershipClaimDeadline(card, day);
    let rights: CheckValue;
    if (encumbrances.length) {
      rights = "no";
      lines.push(`Есть права третьих лиц: ${encumbrances.map((r) => r.type).join(", ")} — участок исключён.`);
      setMessage({ tone: "bad", text: `Найдено: ${encumbrances.map(describe).join("; ")} — права третьих лиц есть, участок исключён.` });
    } else if (claim) {
      rights = "unknown";
      lines.push(
        `Собственность зарегистрирована недавно (${formatDay(claim.registeredAt)}). Если участок из невостребованных долей, тот, кто его уже использует, до ${formatDay(claim.deadline)} может получить его без торгов (п. 4 ст. 12 101-ФЗ) — спросить администрацию.`,
      );
      setMessage({
        tone: "warn",
        text: `Аренды и обременений нет, но собственность зарегистрирована ${formatDay(claim.registeredAt)} — до ${formatDay(claim.deadline)} участок может уйти тому, кто его уже использует. Спросите администрацию; ответ отметьте в стоп-факторе «права третьих лиц».`,
      });
    } else {
      rights = "yes";
      lines.push("Аренды и обременений нет. Не видно в реестре: аренда до 1 года, поданные заявления, фактические пользователи.");
      setMessage({ tone: "ok", text: "Аренды и обременений нет — второй шаг пройден. Сохраните участок." });
    }
    onApply({
      rightsCheckedAt: day,
      checks: { ...form.checks, rights },
      notes: [form.notes.trim(), ...lines].filter(Boolean).join("\n"),
    });
    setApplied(true);
    setText("");
  }

  const tone = { ok: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-rose-600" };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-3 text-sm sm:col-span-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} className="font-medium hover:underline">
          {open ? "▾" : "▸"} Вставить справочную информацию Росреестра (права третьих лиц)
        </button>
        {form.rightsCheckedAt && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ сверено с Росреестром {formatDay(form.rightsCheckedAt)}
          </span>
        )}
        <a href={ROSREESTR_ONLINE} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline dark:text-sky-400">
          открыть справочную информацию ↗
        </a>
      </div>
      {open && (
        <>
          <p className="text-xs text-zinc-500">
            Найдите участок по кадастровому номеру, скопируйте карточку целиком (вместе с разделом «Сведения о правах и
            ограничениях») и вставьте сюда. Есть аренда или обременение — участок исключается. Только запись «Собственность»
            — аренды и обременений нет.
          </p>
          <ul className="list-disc pl-5 text-xs text-zinc-500">
            <li>Аренда сроком до 1 года не регистрируется и в карточке не видна.</li>
            <li>Чужие поданные заявления (10.1, предварительное согласование, аукцион) в реестре не видны — смотрите torgi.gov.ru.</li>
            <li>
              Свежая регистрация собственности (меньше 6 месяцев) — если участок из невостребованных долей, его может получить
              тот, кто уже обрабатывает (п. 4 ст. 12 101-ФЗ). Спросите администрацию.
            </li>
            <li>Сервис обновляется с задержкой: смотрите «Дату обновления информации».</li>
          </ul>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className={inputClass}
            placeholder={"Земельный участок\nДата обновления информации:\n…\nСведения о правах и ограничениях (обременениях)\n…"}
          />
          <button
            type="button"
            onClick={apply}
            disabled={!text.trim()}
            className="self-start rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Проверить права
          </button>
        </>
      )}
      {message && <p className={`text-xs ${tone[message.tone]}`}>{message.text}</p>}
      {applied && message && <SaveHere />}
    </div>
  );
}

// Что нашлось на torgi.gov.ru и что это значит для участка.
// rights: "no" — исключить; "unknown" — вопрос открыт, нужен ответ администрации; null — стоп-фактор не трогаем
const torgiOutcomes = [
  {
    key: "none",
    label: "Ничего не нашлось",
    rights: null,
    note: "торгов и извещений по участку нет (все статусы).",
    message: "Отмечено: на торгах ничего нет.",
  },
  {
    key: "empty",
    label: "«Не состоялся» — заявок не было",
    rights: null,
    note: "аукцион не состоялся, заявок не было — участок свободен, спрос низкий. При подаче заявления уточнить, не готовят ли повторный аукцион.",
    message: "Отмечено: участок свободен, заявок не было.",
  },
  {
    key: "cancelled",
    label: "Отменён / аннулирован",
    rights: null,
    note: "торги отменены или аннулированы — посмотреть причину в извещении; если причина — права третьих лиц, исключить участок.",
    message: "Отмечено. Посмотрите причину отмены в извещении.",
  },
  {
    key: "active",
    label: "Аукцион идёт (объявлен, приём заявок) — исключить",
    rights: "no",
    note: "идёт аукцион — по 10.1 сейчас не получить, можно только участвовать в аукционе. Участок исключён.",
    message: "Участок исключён: идёт аукцион.",
  },
  {
    key: "taken",
    label: "Победитель / одна заявка / извещение по ст. 39.18 — исключить",
    rights: "no",
    note: "есть победитель, единственный участник или заявление по ст. 39.18 ЗК — у участка есть претендент. Участок исключён.",
    message: "Участок исключён: у него есть претендент.",
  },
] as const;

// Торги и извещения по участку (аукционы, ст. 39.18 ЗК) — их нет ни в НСПД, ни в справочной информации Росреестра
function TorgiCheck({ form, onApply }: { form: PlotInput; onApply: (patch: Partial<PlotInput>) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const number = form.cadastralNumber.trim();

  async function copyNumber() {
    await navigator.clipboard.writeText(number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function mark(outcome: (typeof torgiOutcomes)[number]) {
    const day = today();
    onApply({
      torgiCheckedAt: day,
      checks: outcome.rights ? { ...form.checks, rights: outcome.rights } : form.checks,
      notes: [form.notes.trim(), `torgi.gov.ru, ${formatDay(day)}: ${outcome.note}`].filter(Boolean).join("\n"),
    });
    setMessage({ ok: outcome.rights !== "no", text: `${outcome.message} Сохраните участок.` });
  }

  const button = "rounded-lg px-3 py-1.5 text-xs disabled:opacity-40";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-3 text-sm sm:col-span-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} className="font-medium hover:underline">
          {open ? "▾" : "▸"} Проверить торги и извещения (torgi.gov.ru)
        </button>
        {form.torgiCheckedAt && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ торги проверены {formatDay(form.torgiCheckedAt)}
          </span>
        )}
        {number && (
          <button type="button" onClick={copyNumber} className="text-xs text-zinc-500 hover:text-zinc-800">
            {copied ? "номер скопирован" : "скопировать номер"}
          </button>
        )}
        <a href={TORGI_LOTS} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline dark:text-sky-400">
          открыть реестр лотов ↗
        </a>
      </div>
      {open && (
        <>
          <p className="text-xs text-zinc-500">
            В «Реестре лотов» вставьте номер в поле поиска и снимите фильтр «Статус» (крестик у «Статус: 2») — так видны и
            завершённые, и отменённые торги. Поиск выдаёт и соседние участки: сверяйте «Кадастровый номер земельного участка»
            до последней цифры. При «Не состоялся» откройте извещение и посмотрите протокол: одна заявка — договор заключают с
            этим участником, ни одной — участок свободен. Если лотов несколько, выбирайте по самому свежему.
          </p>
          <p className="text-xs text-zinc-500">
            Чего торги не покажут: права того, кто уже обрабатывает участок (п. 4 ст. 12 101-ФЗ), чужое заявление по 10.1 до
            публикации, аренду до 1 года.
          </p>
          <div className="flex flex-col items-start gap-1.5">
            {torgiOutcomes.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => mark(o)}
                className={`${button} ${
                  o.rights === "no"
                    ? "border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400"
                    : o.rights === "unknown"
                      ? "border border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300"
                      : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
      {message && <p className={`text-xs ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}`}>{message.text}</p>}
      {message && <SaveHere />}
    </div>
  );
}

// Читает текст первого файла из ZIP (выгрузка НСПД приходит архивом с одним CSV)
// При импорте из НСПД: новые участки районов последней полной выгрузки торгов без лотов получат «✓ торги»
// Предупреждение: по этим районам такая выгрузка уже загружалась
function RepeatImportHint({ imports, kind, numbers }: { imports: ImportRecord[]; kind: ImportRecord["kind"]; numbers: string[] }) {
  const codes = [...new Set(numbers.map((n) => n.slice(0, 5)))];
  // Торги выгружаются сразу по всему региону — достаточно даты последней выгрузки
  const lastTorgi = imports.filter((r) => r.kind === "torgi").map((r) => r.date).sort().at(-1);
  const done = kind === "torgi" ? (numbers.length && lastTorgi ? [`последняя — ${formatDay(lastTorgi)}`] : []) : codes.flatMap((code) => {
    const dates = imports.filter((r) => r.kind === kind && r.districtCodes.includes(code)).map((r) => r.date);
    if (!dates.length) return [];
    const last = dates.sort().at(-1)!;
    return [`${districtByCadastralNumber(code + ":0000000:1") ?? code} — ${formatDay(last)}`];
  });
  if (!done.length) return null;
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      Выгрузка {kind === "torgi" ? "торгов" : "НСПД"} уже загружалась: {done.join("; ")}. Повторная добавит только новые номера
      {kind === "torgi" ? " и обновит сведения о торгах" : ""}.
    </p>
  );
}

function TorgiExportHint({ info, numbers }: { info: TorgiExportInfo; numbers: string[] }) {
  const age = Math.floor((Date.now() - new Date(`${info.date}T00:00:00`).getTime()) / 86_400_000);
  const codes = new Set(info.districtCodes);
  const withLots = new Set(info.numbers);
  const marked = numbers.filter((n) => codes.has(n.slice(0, 5)) && !withLots.has(n)).length;
  if (age > TORGI_EXPORT_FRESH_DAYS) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Последней полной выгрузке торгов уже {age} дн. (от {formatDay(info.date)}) — отметку «✓ торги» новым участкам не ставлю.
        Выгрузите торги заново (регион и категория, без фильтров ВРИ и статуса) и импортируйте с галочкой.
      </p>
    );
  }
  return (
    <p className="text-sm text-emerald-700 dark:text-emerald-400">
      По полной выгрузке торгов от {formatDay(info.date)} новым участкам без лотов поставится «✓ торги»: <b>{marked}</b>
      {numbers.length - marked > 0 && <> (остальные — из районов не из выгрузки или с лотами)</>}.
    </p>
  );
}

// Читает все файлы архива: ZIP из НСПД (один CSV) и Excel .xlsx с torgi.gov.ru (тоже ZIP, внутри XML)
async function readZipEntries(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  let end = buf.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Не удалось прочитать архив");
  const count = view.getUint16(end + 10, true);
  let entry = view.getUint32(end + 16, true);
  const texts = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const name = new TextDecoder().decode(buf.slice(entry + 46, entry + 46 + view.getUint16(entry + 28, true)));
    const method = view.getUint16(entry + 10, true);
    const size = view.getUint32(entry + 20, true);
    const local = view.getUint32(entry + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.slice(start, start + size);
    if (method === 0) texts.set(name, new TextDecoder().decode(data));
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      texts.set(name, await new Response(stream).text());
    }
    entry += 46 + view.getUint16(entry + 28, true) + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true);
  }
  return texts;
}

function ImportForm({
  plots,
  settings,
  onClose,
  onSaved,
}: {
  plots: Plot[];
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState(() => `НСПД, выгрузка от ${formatDay(today())}`);
  const [owner, setOwner] = useState<keyof typeof owners>("unknown");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    created: number;
    skipped: string[];
    updated: number;
    absentMarked: number;
    excluded: number;
    excludedBefore: number;
  } | null>(null);
  // Выгрузка со всеми торгами по сельхозземле (без фильтров ВРИ и статуса): отсутствие участка в ней — значит, торгов не было
  const [complete, setComplete] = useState(false);
  // Выгрузка реестра лотов torgi.gov.ru: номера вместе со сведениями о последнем лоте
  const [torgi, setTorgi] = useState<TorgiExport | null>(null);

  const numbers = useMemo(() => (torgi ? torgi.items.map((i) => i.cadastralNumber) : extractCadastralNumbers(text)), [text, torgi]);
  const known = useMemo(() => new Set(plots.map((p) => normalizeCadastralNumber(p.cadastralNumber))), [plots]);
  const fresh = numbers.filter((n) => !known.has(n));

  async function loadFile(file: File) {
    try {
      setError("");
      setTorgi(null);
      if (!/\.(zip|xlsx)$/i.test(file.name)) return setText(await file.text());
      const entries = await readZipEntries(file);
      const sheet = [...entries.keys()].find((n) => /^xl\/worksheets\/sheet\d*\.xml$/.test(n));
      const parsed = sheet ? parseTorgiExport(entries.get("xl/sharedStrings.xml") ?? "", entries.get(sheet)!) : null;
      if (parsed) {
        setTorgi(parsed);
        setText("");
        setSourceName(`torgi.gov.ru, выгрузка от ${formatDay(today())}`);
      } else setText([...entries.values()].join("\n"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const canMarkAbsent = Boolean(torgi?.allStatuses && torgi.lots < 500);
  const torgiNumbers = new Set(torgi?.items.map((i) => i.cadastralNumber));
  const absentPlots = canMarkAbsent
    ? plots.filter((p) => {
        const n = normalizeCadastralNumber(p.cadastralNumber);
        return torgi!.districtCodes.includes(n.slice(0, 5)) && !torgiNumbers.has(n) && !p.torgiCheckedAt && p.checks.rights !== "no";
      })
    : [];

  async function submit() {
    try {
      // Отметку «торги проверены» ставим, только если выгрузка без фильтра статуса: иначе не видно повторных лотов
      const day = today();
      const body = torgi
        ? {
            items: torgi.items.map((i) => ({
              ...i,
              exclude: torgiExcludes.includes(i.outcome),
              torgiCheckedAt: torgi.allStatuses && (i.outcome === "free" || i.outcome === "cancelled") ? day : undefined,
            })),
            sourceName,
            sourceType: "auction",
            owner,
            ...(complete && canMarkAbsent
              ? { absentDistrictCodes: torgi.districtCodes, absentCheckedAt: day, exportNumbers: torgi.allNumbers }
              : {}),
          }
        : { numbers: fresh, sourceName, owner };
      setResult(await api("/api/plots/import", "POST", body));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Импорт из НСПД" onClose={result ? onSaved : onClose}>
      {result ? (
        <div className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1">
            <li>
              Добавлено участков: <b>{result.created}</b>. Источник — «{sourceName}», статус «Найден».
            </li>
            {result.updated > 0 && (
              <li>
                Уже известным участкам обновлены сведения о торгах: <b>{result.updated}</b>.
              </li>
            )}
            {result.excluded > 0 && (
              <li className="text-rose-700 dark:text-rose-400">
                Отсеяно по торгам (аукцион идёт, победитель, одна заявка) — в реестр не занесены: <b>{result.excluded}</b>.
              </li>
            )}
            {result.excludedBefore > 0 && (
              <li className="text-rose-700 dark:text-rose-400">
                Пропущено — раньше отсеяны по торгам: <b>{result.excludedBefore}</b>.
              </li>
            )}
            {result.absentMarked > 0 && (
              <li className="text-emerald-700 dark:text-emerald-400">
                ✓ торги отмечены участкам без лотов в выгрузке: <b>{result.absentMarked}</b>.
              </li>
            )}
          </ul>
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
            <li>
              С{" "}
              <a href="https://torgi.gov.ru/new/public/lots/reg" target="_blank" rel="noreferrer" className="text-sky-700 hover:underline dark:text-sky-400">
                torgi.gov.ru
              </a>{" "}
              — в «Реестре лотов» задайте фильтры (регион, категория, ВРИ, форма собственности без «иной») <b>без фильтра
              «Статус»</b> — тогда по каждому участку виден самый свежий лот, и проверка торгов отметится сама. Нажмите синий
              значок выгрузки в Excel справа над списком (рядом с оранжевым RSS). Выберите скачанный .xlsx ниже — номера найдутся сами, повторно выставленные лоты дадут один
              участок. Длинный список ограничьте датой (например, за последний год) и выгружайте частями. Источник назовите,
              например, «torgi.gov.ru, несостоявшиеся».
            </li>
          </ol>
          <input
            type="file"
            accept=".zip,.xlsx,.csv,.txt"
            onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-sm dark:file:bg-zinc-800"
          />
          {torgi ? (
            <div className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
              <p>
                Выгрузка torgi.gov.ru: лотов <b>{torgi.lots}</b>, разных участков <b>{torgi.items.length}</b> — по каждому
                возьмётся последний лот (статус, даты, цена, ссылка на извещение) в заметки, площадь и собственник.
              </p>
              <ul className="flex flex-col gap-0.5">
                {(Object.keys(lotOutcomes) as TorgiOutcome[])
                  .filter((k) => torgi.outcomes[k])
                  .map((k) => (
                    <li key={k} className={torgiExcludes.includes(k) ? "text-rose-700 dark:text-rose-400" : ""}>
                      {lotOutcomes[k]}: <b>{torgi.outcomes[k]}</b>
                      {torgiExcludes.includes(k) && " — в реестр не попадут"}
                    </li>
                  ))}
              </ul>
              {torgi.allStatuses ? (
                <p className="text-emerald-700 dark:text-emerald-400">
                  Выгрузка со всеми статусами: участкам без претендентов поставится «✓ торги проверены» на сегодня, уже
                  известным участкам — тоже. Занятые в реестр не заносятся, уже известные занятые уберутся из него.
                </p>
              ) : (
                <p className="text-amber-700 dark:text-amber-400">
                  В выгрузке только «Не состоялся» — по ней не видно, не выставили ли участок снова, поэтому отметку «✓ торги» не
                  ставлю. Для отметки выгрузите тот же поиск без фильтра «Статус».
                </p>
              )}
              {torgi.privateLots > 0 && (
                <p className="text-zinc-500">
                  Пропущено лотов частной собственности и имущества должников: {torgi.privateLots} — по 10.1 такие участки не
                  предоставляют.
                </p>
              )}
              {torgi.noNumber > 0 && <p className="text-zinc-500">Лотов без кадастрового номера: {torgi.noNumber}.</p>}
              {torgi.lots >= 500 && (
                <p className="text-amber-700 dark:text-amber-400">
                  В выгрузке ровно {torgi.lots} лотов — похоже, это предел сайта, и более старые торги не попали. Сузьте поиск
                  по дате или району и выгрузите остальное отдельно.
                </p>
              )}
              {canMarkAbsent && absentPlots.length > 0 && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} className="mt-1" />
                  <span>
                    Это выгрузка всех торгов по сельхозземле — только регион и категория, <b>без фильтров ВРИ и статуса</b>.
                    Отметить «✓ торги» участкам этих районов, которых в выгрузке нет: <b>{absentPlots.length}</b>.
                    <span className="block text-xs text-zinc-500">
                      Ставьте галочку, только если фильтров ВРИ не было: иначе лот с другой формулировкой ВРИ мог не попасть в
                      выгрузку. Если делили выгрузку по датам — импортируйте все части. Районы в выгрузке: {torgi.districtCodes.map((c) => districtByCadastralNumber(`${c}:`) ?? c).join(", ")}.
                    </span>
                  </span>
                </label>
              )}
              {torgi.allStatuses && torgi.lots >= 500 && (
                <p className="text-xs text-zinc-500">
                  Участки без лотов не отмечаются: выгрузка упёрлась в 500 лотов и может быть неполной.
                </p>
              )}
              <button type="button" onClick={() => setTorgi(null)} className="self-start text-xs text-zinc-500 hover:text-zinc-800">
                отменить выбор файла
              </button>
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className={inputClass}
              placeholder="Кадастровые номера — в любом виде, по одному или списком"
            />
          )}
          {!torgi && settings.torgiExport && (
            <TorgiExportHint info={settings.torgiExport} numbers={fresh} />
          )}
          <RepeatImportHint imports={settings.imports} kind={torgi ? "torgi" : "nspd"} numbers={numbers} />
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
              disabled={!fresh.length && !torgi?.items.length}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {torgi && !fresh.length ? "Обновить сведения о торгах" : `Добавить ${fresh.length || ""} в реестр`}
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
        {error && <p className="text-sm text-rose-600 sm:col-span-2">{error}</p>}
        <NspdPaste form={form} onApply={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        <RightsPaste form={form} onApply={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        <TorgiCheck form={form} onApply={(patch) => setForm((f) => ({ ...f, ...patch }))} />
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
      {progress.rights && <span className="text-emerald-700 dark:text-emerald-400">✓ Росреестр</span>}
      {progress.torgi && <span className="text-emerald-700 dark:text-emerald-400">✓ торги</span>}
      {progress.request && <span className="text-violet-700 dark:text-violet-400">✉ запрос {shortDay(progress.request)}</span>}
      {progress.next &&
        (progress.warn ? (
          <span className="rounded-full bg-amber-100 px-2 font-medium text-amber-900 ring-1 ring-amber-400 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-700">
            ⚠ далее: {progress.next}
          </span>
        ) : (
          <span className="text-sky-700 dark:text-sky-400">далее: {progress.next}</span>
        ))}
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
// Последние выгрузки по кадастровому району: «НСПД 22.11», «торги 22.11» — чтобы не загружать район повторно
function importMarks(plots: Plot[], imports: ImportRecord[]) {
  const latest = (kind: ImportRecord["kind"], code: string) =>
    imports
      .filter((r) => r.kind === kind && (r.districtCodes.includes(code) || (r.complete && r.districtCodes.some((c) => c.slice(0, 2) === code.slice(0, 2)))))
      .reduce<string | null>((max, r) => (max && max > r.date ? max : r.date), null);
  // Район в дереве → его кадастровые коды (у района обычно один)
  const codes = new Map<string, Set<string>>();
  for (const p of plots) {
    const key = `${regionOf(p)}|${districtOf(p)}`;
    const set = codes.get(key) ?? new Set<string>();
    if (/^\d{2}:\d{2}:/.test(p.cadastralNumber)) set.add(p.cadastralNumber.slice(0, 5));
    codes.set(key, set);
  }
  for (const region of new Set(plots.map(regionOf))) {
    for (const { code, name } of districtsOfRegion(region)) {
      const key = `${region}|${name}`;
      codes.set(key, (codes.get(key) ?? new Set<string>()).add(code));
    }
  }
  const pick = (kind: ImportRecord["kind"], set: Set<string>) =>
    [...set].map((c) => latest(kind, c)).reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);
  return new Map([...codes].map(([key, set]) => [key, { nspd: pick("nspd", set), torgi: pick("torgi", set) }]));
}

const shortDay = (date: string) => date.slice(8, 10) + "." + date.slice(5, 7);

function ImportMarks({ marks }: { marks?: { nspd: string | null; torgi: string | null } }) {
  if (!marks) return null;
  const mark = (label: string, date: string | null) => (
    <span className={date ? "" : "opacity-60"} title={date ? `Выгрузка ${label} загружена ${formatDay(date)}` : `Выгрузки ${label} не было`}>
      {date ? `✓ ${label} ${shortDay(date)}` : `${label} —`}
    </span>
  );
  return (
    <span className="flex gap-2 text-[11px] opacity-70">
      {mark("НСПД", marks.nspd)}
      {mark("торги", marks.torgi)}
    </span>
  );
}

function RegionTree({
  plots,
  imports,
  place,
  onChange,
}: {
  plots: Plot[];
  imports: ImportRecord[];
  place: Place;
  onChange: (p: Place) => void;
}) {
  const marks = useMemo(() => importMarks(plots, imports), [plots, imports]);
  // Районы без участков показываем по кнопке — так видно, куда выгрузку ещё не загружали
  const [showAll, setShowAllState] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- читаем localStorage только после гидрации
      setShowAllState(localStorage.getItem("plots.showAllDistricts") === "1");
    } catch {}
  }, []);
  const setShowAll = (value: boolean) => {
    setShowAllState(value);
    try {
      localStorage.setItem("plots.showAllDistricts", value ? "1" : "0");
    } catch {}
  };
  const tree = useMemo(() => {
    const regions = new Map<string, Map<string, number>>();
    for (const p of plots) {
      const districts = regions.get(regionOf(p)) ?? new Map<string, number>();
      districts.set(districtOf(p), (districts.get(districtOf(p)) ?? 0) + 1);
      regions.set(regionOf(p), districts);
    }
    if (showAll) {
      for (const [region, districts] of regions) {
        for (const { name } of districtsOfRegion(region)) if (!districts.has(name)) districts.set(name, 0);
      }
    }
    return [...regions.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ru"))
      .map(([region, districts]) => ({
        region,
        total: [...districts.values()].reduce((sum, n) => sum + n, 0),
        districts: [...districts.entries()].sort(([a], [b]) => a.localeCompare(b, "ru")),
        // Сколько районов региона по справочнику и сколько из них без участков
        known: districtsOfRegion(region).length,
        empty: districtsOfRegion(region).filter(({ name }) => !plots.some((p) => regionOf(p) === region && districtOf(p) === name)).length,
      }));
  }, [plots, showAll]);

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
            {!showAll &&
              districtsOfRegion(r.region)
                .filter(({ name }) => !r.districts.some(([d]) => d === name))
                .map(({ name }) => (
                  <option key={name} value={`${r.region}|${name}`}>{name} · 0</option>
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
                className={`${item(place.region === r.region && place.district === d)} pl-5 ${n === 0 ? "opacity-60" : ""}`}
              >
                <span className="flex flex-col">
                  <span>{d}</span>
                  <ImportMarks marks={marks.get(`${r.region}|${d}`)} />
                </span>
                <span className="text-xs opacity-70">{n}</span>
              </button>
            ))}
            {r.empty > 0 && (
              <button onClick={() => setShowAll(!showAll)} className="pl-5 text-left text-xs text-sky-700 hover:underline dark:text-sky-400">
                {showAll ? `скрыть районы без участков (${r.empty})` : `показать все районы (ещё ${r.empty} без участков)`}
              </button>
            )}
          </div>
        ))}
      </nav>
    </>
  );
}

type SortMode = "checked" | "areaAsc" | "area" | "score" | "updated";

// Запрос в администрацию района: то, чего не видно в открытых источниках, — договоры до года
// (не регистрируются в ЕГРН), заявления по п. 4 ст. 12 и ст. 10.1 101-ФЗ, ст. 39.18 ЗК, планы торгов
function adminOf(district: string) {
  if (/^город /.test(district)) return `Администрация города ${district.replace(/^город /, "")}а`;
  return `Администрация ${district.replace(/[иоы]й район$/, "ого района")}`;
}

function plotAddress(p: Plot) {
  return p.notes.match(/Адрес по (?:НСПД|Росреестру): (.+)/)?.[1]?.trim() ?? "";
}

function requestLetter(addressee: string, a: Applicant, plots: Plot[], date: string) {
  const blank = "________________";
  const from = [a.name || blank, a.status].filter(Boolean).join(", ");
  const contacts = [a.phone && `тел.: ${a.phone}`, a.email && `e-mail: ${a.email}`].filter(Boolean).join(", ");
  const list = plots.map((p, i) => {
    const area = p.areaHa ? `, площадь ${p.areaHa.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га` : "";
    const address = plotAddress(p);
    return `${i + 1}. ${p.cadastralNumber}${area}${address ? `, ${address}` : ""}`;
  });
  return [
    addressee,
    `от ${from}`,
    `адрес: ${a.address || blank}`,
    ...(contacts ? [contacts] : []),
    "",
    "ЗАПРОС",
    "о предоставлении информации о земельных участках",
    "",
    "Рассматриваю возможность получения в аренду для сельскохозяйственного производства земельных участков из земель сельскохозяйственного назначения, находящихся в муниципальной собственности, в том числе без проведения торгов на основании ст. 10.1 Федерального закона от 24.07.2002 № 101-ФЗ «Об обороте земель сельскохозяйственного назначения»:",
    "",
    ...list,
    "",
    "Прошу сообщить по каждому из указанных участков:",
    "1) заключены ли договоры аренды, безвозмездного пользования или иные договоры, по которым участок передан в пользование, в том числе на срок менее одного года (не подлежащие государственной регистрации), и срок их действия;",
    "2) поступали ли заявления о предоставлении участка, в том числе по п. 4 ст. 12 и ст. 10.1 Федерального закона № 101-ФЗ, по ст. 39.18 Земельного кодекса РФ, и на какой стадии их рассмотрение;",
    "3) планируется ли проведение торгов (аукциона) или иное распоряжение участком;",
    "4) известно ли администрации о фактическом использовании участка третьими лицами.",
    "",
    `Ответ прошу направить ${a.email ? `на адрес электронной почты ${a.email}` : "по указанному адресу"} в срок, установленный ст. 12 Федерального закона от 02.05.2006 № 59-ФЗ «О порядке рассмотрения обращений граждан Российской Федерации».`,
    "",
    `${date.split("-").reverse().join(".")}                    ____________ / ${a.name || blank}`,
  ].join("\n");
}

// Word открывает HTML с расширением .doc: шапка справа, заголовок по центру, Times New Roman 14
function downloadDoc(text: string, fileName: string, headerLines: number) {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = text
    .split("\n")
    .map((line, i) => {
      const style =
        i < headerLines
          ? "text-align:right"
          : line === "ЗАПРОС" || line.startsWith("о предоставлении информации")
            ? "text-align:center;font-weight:bold"
            : "text-align:justify";
      return `<p style="margin:0;${style}">${escape(line) || "&nbsp;"}</p>`;
    })
    .join("");
  const html = `<html><head><meta charset="utf-8"></head><body style="font-family:Times New Roman;font-size:14pt">${body}</body></html>`;
  const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/msword" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// Участки района, прошедшие НСПД, Росреестр и торги и не исключённые
function requestCandidates(plots: Plot[], settings: Settings) {
  return plots.filter((p) => {
    if (assess(p, settings.weights, settings.vri).kind === "excluded") return false;
    const progress = checkProgress(p, settings.vri);
    return progress.nspd && progress.rights && progress.torgi;
  });
}

function AdminRequest({
  district,
  plots,
  settings,
  onClose,
  onSaved,
}: {
  district: string;
  plots: Plot[];
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const candidates = useMemo(() => {
    const rank = (p: Plot) => (p.status === "promising" ? 0 : p.adminRequestAt ? 2 : 1);
    return requestCandidates(plots, settings).sort((a, b) => rank(a) - rank(b) || (b.areaHa ?? 0) - (a.areaHa ?? 0));
  }, [plots, settings]);
  // Сначала отмечены перспективные; если их в районе нет — все прошедшие проверку, по которым запроса ещё не было
  const [selected, setSelected] = useState<Set<string>>(() => {
    const promising = candidates.filter((p) => p.status === "promising" && !p.adminRequestAt);
    return new Set((promising.length ? promising : candidates.filter((p) => !p.adminRequestAt)).map((p) => p.id));
  });
  const [addressee, setAddressee] = useState(() => {
    try {
      return localStorage.getItem(`adminRequest.addressee.${district}`) || adminOf(district);
    } catch {
      return adminOf(district);
    }
  });
  const [applicant, setApplicant] = useState<Applicant>(settings.applicant);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const day = today();
  const chosen = candidates.filter((p) => selected.has(p.id));
  const letter = requestLetter(addressee, applicant, chosen, day);
  const headerLines = applicant.phone || applicant.email ? 4 : 3;

  async function remember() {
    try {
      localStorage.setItem(`adminRequest.addressee.${district}`, addressee);
    } catch {}
    if (JSON.stringify(applicant) !== JSON.stringify(settings.applicant)) await api("/api/settings", "PATCH", { applicant });
  }

  async function run(action: () => Promise<void> | void, done: string) {
    try {
      setError("");
      await remember();
      await action();
      setMessage(done);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function markSent() {
    const note = `Запрос в администрацию отправлен ${day.split("-").reverse().join(".")} (договоры до года, заявления по п. 4 ст. 12 и ст. 10.1 101-ФЗ, ст. 39.18 ЗК, планы торгов). Ответ — в течение 30 дней.`;
    for (const p of chosen) {
      await api(`/api/plots/${p.id}`, "PATCH", { adminRequestAt: day, notes: [p.notes.trim(), note].filter(Boolean).join("\n") });
    }
    onSaved();
  }

  const field = (key: keyof Applicant, label: string, placeholder: string) => (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      <input
        value={applicant[key]}
        onChange={(e) => setApplicant({ ...applicant, [key]: e.target.value })}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );

  return (
    <Modal title={`Запрос в администрацию — ${district}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-zinc-500">
          Одно письмо на район: есть ли договоры до года (их нет в ЕГРН), заявления по п. 4 ст. 12 и ст. 10.1 101-ФЗ и ст.
          39.18 ЗК, планы торгов. Ответ — в течение 30 дней (59-ФЗ). В список входят участки, прошедшие НСПД, Росреестр и
          торги; сначала отмечены «Перспективные» — критерии перспективности разработаем в следующем блоке.
        </p>

        {candidates.length === 0 ? (
          <p className="text-amber-700 dark:text-amber-400">В районе пока нет участков, прошедших все три проверки.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>
                Участки: выбрано {chosen.length} из {candidates.length}
              </span>
              <span className="flex gap-3">
                <button type="button" className="underline" onClick={() => setSelected(new Set(candidates.map((p) => p.id)))}>
                  все
                </button>
                <button type="button" className="underline" onClick={() => setSelected(new Set())}>
                  ни одного
                </button>
              </span>
            </div>
            <ul className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
              {candidates.map((p) => (
                <li key={p.id}>
                  <label className="flex items-baseline gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        setSelected(next);
                      }}
                    />
                    <span className="font-mono text-xs">{p.cadastralNumber}</span>
                    <span className="text-xs text-zinc-500">
                      {p.areaHa != null && `${p.areaHa.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} га`}
                      {p.status === "promising" && " · перспективный"}
                      {p.adminRequestAt && ` · запрос уже был ${shortDay(p.adminRequestAt)}`}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Кому (сверьте название с сайтом района — многие районы стали муниципальными округами)
          <input value={addressee} onChange={(e) => setAddressee(e.target.value)} className={inputClass} />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {field("name", "ФИО заявителя", "Фамилия Имя Отчество")}
          {field("status", "Статус (необязательно)", "глава КФХ, ОГРНИП …")}
          {field("address", "Почтовый адрес", "индекс, область, город, улица, дом")}
          {field("phone", "Телефон", "+7 …")}
          {field("email", "E-mail для ответа", "name@example.ru")}
        </div>
        <p className="text-xs text-zinc-500">Данные заявителя запоминаются для следующих запросов.</p>

        <textarea readOnly value={letter} rows={12} className={`${inputClass} font-mono text-xs`} />

        {error && <p className="text-rose-700 dark:text-rose-400">{error}</p>}
        {message && <p className="text-emerald-700 dark:text-emerald-400">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!chosen.length}
            onClick={() => run(() => downloadDoc(letter, `Запрос в администрацию — ${district} — ${day}.doc`, headerLines), "Файл для Word скачан.")}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Скачать для Word
          </button>
          <button
            type="button"
            disabled={!chosen.length}
            onClick={() => run(() => navigator.clipboard.writeText(letter), "Текст скопирован — вставьте его в письмо или обращение на Госуслугах.")}
            className="rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Скопировать текст
          </button>
          <button
            type="button"
            disabled={!chosen.length}
            onClick={() => run(markSent, "")}
            className="rounded-lg bg-violet-700 px-4 py-2 text-white hover:bg-violet-600 disabled:opacity-40"
          >
            Запрос отправлен — отметить участки ({chosen.length})
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Куда отправить: e-mail администрации с её сайта или «Обращение в госорган» на Госуслугах. После отправки нажмите
          фиолетовую кнопку — у участков появится «✉ запрос» и срок ответа.
        </p>
      </div>
    </Modal>
  );
}

function PlotsView({ data, onEdit, onChanged }: { data: Data; onEdit: (plot: Plot | null) => void; onChanged: () => void }) {
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const [status, setStatus] = useState<PlotStatus | "all">("all");
  const [place, setPlaceState] = useState<Place>({ region: null, district: null });
  // Выбранный регион и район запоминаем в браузере: после перезагрузки страницы не надо искать район заново
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("plots.place") ?? "null") as Place | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- восстановление выбора после загрузки
      if (saved && (saved.region === null || typeof saved.region === "string")) setPlaceState(saved);
    } catch {}
  }, []);
  const setPlace = (next: Place) => {
    setPlaceState(next);
    try {
      localStorage.setItem("plots.place", JSON.stringify(next));
    } catch {}
  };
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
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <RegionTree plots={data.plots} imports={data.settings.imports} place={place} onChange={setPlace} />
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
        <p className="text-sm text-zinc-500">
          {place.district && !data.plots.some((p) => districtOf(p) === place.district)
            ? `В районе «${place.district}» пока нет участков — загрузите выгрузку НСПД по району кнопкой «Импорт из НСПД».`
            : "Ничего не найдено."}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map(({ region, districts }) => (
            <section key={region} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{region}</h2>
              {districts.map(([district, list]) => {
                const area = list.reduce((sum, p) => sum + (p.areaHa ?? 0), 0);
                const excluded = list.filter((p) => assessments.get(p.id)!.kind === "excluded").length;
                const all = data.plots.filter((p) => regionOf(p) === region && districtOf(p) === district);
                const ready = requestCandidates(all, data.settings).length;
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
                      {ready > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setRequestFor(`${region}|${district}`);
                          }}
                          className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-300"
                        >
                          ✉ Запрос в администрацию · {ready}
                        </button>
                      )}
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
      {requestFor && (
        <AdminRequest
          district={requestFor.split("|")[1]}
          plots={data.plots.filter((p) => `${regionOf(p)}|${districtOf(p)}` === requestFor)}
          settings={data.settings}
          onClose={() => setRequestFor(null)}
          onSaved={() => {
            setRequestFor(null);
            onChanged();
          }}
        />
      )}
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
        <PlotsView data={data} onEdit={(item) => setEditing({ kind: "plot", item })} onChanged={reload} />
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
        <ImportForm plots={data.plots} settings={data.settings} onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {data && editing?.kind === "source" && <SourceForm source={editing.item} plots={data.plots} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
}
