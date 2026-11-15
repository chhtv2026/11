"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assess,
  checkValues,
  criteria,
  defaultWeights,
  emptyPlot,
  emptySource,
  owners,
  plotDirections,
  plotStatuses,
  sourceTypes,
  stopFactors,
  type Assessment,
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

type Data = { sources: Source[]; plots: Plot[]; settings: Settings };

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
    return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">исключён</span>;
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
  weights,
  onChecks,
  onScores,
}: {
  form: PlotInput;
  weights: Weights;
  onChecks: (checks: PlotInput["checks"]) => void;
  onScores: (scores: PlotInput["scores"]) => void;
}) {
  const assessment = assess(form, weights);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-3 sm:col-span-2 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Оценка участка</span>
        <AssessmentBadge assessment={assessment} />
      </div>

      <div>
        <p className="mb-1 text-xs text-zinc-500">Шаг 1. Стоп-факторы — любое «нет» исключает участок</p>
        <ul className="flex flex-col gap-1">
          {(Object.keys(stopFactors) as StopFactor[]).map((key) => (
            <li key={key} className="flex items-center justify-between gap-2 text-sm">
              <span>{stopFactors[key]}</span>
              <select
                value={form.checks[key]}
                onChange={(e) => onChecks({ ...form.checks, [key]: e.target.value as CheckValue })}
                className={`shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 ${checkColors[form.checks[key]]}`}
                aria-label={stopFactors[key]}
              >
                {(Object.keys(checkValues) as CheckValue[]).map((v) => (
                  <option key={v} value={v}>{checkValues[v]}</option>
                ))}
              </select>
            </li>
          ))}
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

function PlotForm({
  plot,
  sources,
  weights,
  onClose,
  onSaved,
}: {
  plot: Plot | null;
  sources: Source[];
  weights: Weights;
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
    if (!plot || !confirm("Удалить участок из реестра?")) return;
    await api(`/api/plots/${plot.id}`, "DELETE");
    onSaved();
  }

  return (
    <Modal title={plot ? "Участок" : "Новый участок"} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Кадастровый номер">
          <input value={form.cadastralNumber} onChange={(e) => set("cadastralNumber", e.target.value)} placeholder="60:00:0000000:000" className={inputClass} />
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
          weights={weights}
          onChecks={(checks) => set("checks", checks)}
          onScores={(scores) => set("scores", scores)}
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
            <button type="button" onClick={remove} className="ml-auto text-sm text-rose-600 hover:underline">
              Удалить участок
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function SourceForm({ source, onClose, onSaved }: { source: Source | null; onClose: () => void; onSaved: () => void }) {
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

  async function remove() {
    if (!source || !confirm("Удалить источник? Участки останутся, но без ссылки на него.")) return;
    await api(`/api/sources/${source.id}`, "DELETE");
    onSaved();
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
            <button type="button" onClick={remove} className="ml-auto text-sm text-rose-600 hover:underline">
              Удалить источник
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function PlotsView({ data, onEdit }: { data: Data; onEdit: (plot: Plot | null) => void }) {
  const [status, setStatus] = useState<PlotStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "score" | "area">("updated");
  const sourceNames = useMemo(() => new Map(data.sources.map((s) => [s.id, s.name])), [data.sources]);

  const counts = useMemo(() => {
    const result: Partial<Record<PlotStatus, number>> = {};
    for (const p of data.plots) result[p.status] = (result[p.status] ?? 0) + 1;
    return result;
  }, [data.plots]);

  const assessments = useMemo(
    () => new Map(data.plots.map((p) => [p.id, assess(p, data.settings.weights)])),
    [data.plots, data.settings.weights],
  );
  // Для сортировки: оценённые по баллу, затем недооценённые, исключённые в конце
  const rank = (a: Assessment) => (a.kind === "scored" ? a.score : a.kind === "incomplete" ? -1 : -2);

  const q = query.trim().toLowerCase();
  const plots = data.plots.filter(
    (p) =>
      (status === "all" || p.status === status) &&
      (!q || [p.cadastralNumber, p.title, p.district, p.notes].some((v) => v.toLowerCase().includes(q))),
  );
  if (sort === "score") plots.sort((a, b) => rank(assessments.get(b.id)!) - rank(assessments.get(a.id)!));
  if (sort === "area") plots.sort((a, b) => (b.areaHa ?? 0) - (a.areaHa ?? 0));

  return (
    <>
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
            <option value="updated">Недавно изменённые</option>
            <option value="score">По баллу</option>
            <option value="area">По площади</option>
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
        <ul className="flex flex-col gap-2">
          {plots.map((p) => {
            const unverified = p.findings.filter((f) => !f.verified).length;
            return (
              <li key={p.id}>
                <button
                  onClick={() => onEdit(p)}
                  className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.cadastralNumber || p.title}</span>
                    {p.cadastralNumber && p.title && <span className="text-sm text-zinc-500">{p.title}</span>}
                    <span className="ml-auto flex items-center gap-2">
                      <AssessmentBadge assessment={assessments.get(p.id)!} />
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[p.status]}`}>{plotStatuses[p.status]}</span>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>{[p.region, p.district].filter(Boolean).join(", ")}</span>
                    {p.areaHa !== null && <span>{p.areaHa.toLocaleString("ru-RU")} га</span>}
                    <span>{owners[p.owner]}</span>
                    {p.sourceId && sourceNames.has(p.sourceId) && <span>источник: {sourceNames.get(p.sourceId)}</span>}
                    {p.findings.length > 0 && (
                      <span className={unverified ? "text-amber-600" : "text-emerald-600"}>
                        выводов: {p.findings.length}
                        {unverified ? `, не проверено: ${unverified}` : ", все проверены"}
                      </span>
                    )}
                    <span className="ml-auto">изм. {dateFormat.format(new Date(p.updatedAt))}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
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

type Editing = { kind: "plot"; item: Plot | null } | { kind: "source"; item: Source | null } | { kind: "weights" } | null;

export default function Registry() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"plots" | "sources">("plots");
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

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Земля в аренду</h1>
          <p className="text-sm text-zinc-500">Реестр земельных возможностей · пилот: Псковская область</p>
        </div>
        {tab === "plots" && data && (
          <button
            onClick={() => setEditing({ kind: "weights" })}
            className="ml-auto rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:border-zinc-500 dark:border-zinc-700"
          >
            Веса оценки
          </button>
        )}
        <button
          onClick={() => setEditing(tab === "plots" ? { kind: "plot", item: null } : { kind: "source", item: null })}
          className={`${tab === "plots" && data ? "" : "ml-auto"} rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900`}
        >
          {tab === "plots" ? "+ Участок" : "+ Источник"}
        </button>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ["plots", `Участки${data ? ` (${data.plots.length})` : ""}`],
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
      ) : (
        <SourcesView data={data} onEdit={(item) => setEditing({ kind: "source", item })} />
      )}

      {data && editing?.kind === "plot" && (
        <PlotForm
          plot={editing.item}
          sources={data.sources}
          weights={data.settings.weights}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {data && editing?.kind === "weights" && (
        <WeightsForm weights={data.settings.weights} onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {editing?.kind === "source" && <SourceForm source={editing.item} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
}
