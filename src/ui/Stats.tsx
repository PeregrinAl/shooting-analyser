import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  describe,
  type Descriptives,
  type PyodideLoadStatus,
  type ScattShot,
} from '@core/index';

/**
 * Доступные для анализа числовые переменные выстрела.
 * Эти ключи дальше превращаются в массивы значений по серии.
 */
type VarKey =
  | 'R'
  | 'T'
  | 'hold10'
  | 'hold10plus'
  | 'speedMmS'
  | 'speed250msMmS'
  | 'distanceStpMm';

const VARIABLES: { key: VarKey; label: string; unit: string }[] = [
  { key: 'R',              label: 'Достоинство пробоины R',              unit: '' },
  { key: 'T',              label: 'Время прицеливания T',                unit: 'с' },
  { key: 'hold10',         label: 'Удержание в 10 (отн. центра)',        unit: '%' },
  { key: 'hold10plus',     label: 'Удержание в 10 (отн. СТП)',           unit: '%' },
  { key: 'speedMmS',       label: 'Скорость траектории',                 unit: 'мм/с' },
  { key: 'speed250msMmS',  label: 'Скорость траектории за 250 мс',       unit: 'мм/с' },
  { key: 'distanceStpMm',  label: 'Расстояние СТП↔пробоина',             unit: 'мм' },
];

/** Достать массив значений переменной из выстрелов, для удобства расчёта. */
function pickValues(shots: readonly ScattShot[], key: VarKey): number[] {
  if (key === 'hold10' || key === 'hold10plus') {
    // Доли SCATT отдаёт от 0 до 1; для UI и статистики используем %.
    return shots.map((s) => s[key] * 100);
  }
  return shots.map((s) => s[key]);
}

interface Props {
  shots: readonly ScattShot[];
}

export function Stats({ shots }: Props) {
  const [varKey, setVarKey] = useState<VarKey>('R');
  const [pyStatus, setPyStatus] = useState<PyodideLoadStatus>('idle');
  // Кэш описательной статистики по переменной — чтобы переключать табы
  // мгновенно после первого расчёта.
  const [cache, setCache] = useState<Map<VarKey, Descriptives>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const variable = VARIABLES.find((v) => v.key === varKey)!;
  const values = useMemo(() => pickValues(shots, varKey), [shots, varKey]);
  const desc = cache.get(varKey);

  // При смене серии (например, открыли другой PDF) сбрасываем кэш — иначе
  // UI покажет старые числа, потому что cache.has(varKey) останется true.
  useEffect(() => {
    setCache(new Map());
    setError(null);
  }, [shots]);

  // Каждый раз при смене переменной — если статистики для неё ещё нет,
  // запускаем расчёт через Pyodide.
  useEffect(() => {
    if (cache.has(varKey)) return;
    let cancelled = false;
    setError(null);
    describe(values, { onStatus: (s) => !cancelled && setPyStatus(s) })
      .then((d) => {
        if (cancelled) return;
        setCache((prev) => new Map(prev).set(varKey, d));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [varKey, values, cache]);

  return (
    <section className="stats">
      <h2 className="stats__title">Описательная статистика</h2>

      <div className="stats__var-picker">
        {VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setVarKey(v.key)}
            className={
              'stats__chip' + (v.key === varKey ? ' stats__chip--active' : '')
            }
          >
            {v.label}
          </button>
        ))}
      </div>

      {error && <p className="app__error">Ошибка расчёта: {error}</p>}

      {!desc && !error && (
        <p className="app__status">
          {pyStatus === 'loading-runtime'
            ? 'Инициализирую вычислительное ядро (Pyodide + scipy)…'
            : pyStatus === 'loading-packages'
              ? 'Загружаю numpy и scipy…'
              : 'Считаю…'}
        </p>
      )}

      {desc && (
        <>
          <DescTable desc={desc} unit={variable.unit} />
          <Histogram values={values} label={variable.label} unit={variable.unit} />
        </>
      )}
    </section>
  );
}

function DescTable({ desc, unit }: { desc: Descriptives; unit: string }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Число наблюдений', value: String(desc.n) },
    { label: 'Среднее', value: fmt(desc.mean, unit) },
    { label: 'Медиана', value: fmt(desc.median, unit) },
    { label: 'Ст. отклонение (σ, ddof=1)', value: fmt(desc.std, unit) },
    { label: 'Межквартильный размах (IQR)', value: fmt(desc.iqr, unit) },
    { label: 'Минимум', value: fmt(desc.min, unit) },
    { label: 'Максимум', value: fmt(desc.max, unit) },
    { label: 'Асимметрия (skew, несмещ.)', value: fmt(desc.skew, '') },
    { label: 'Эксцесс (Фишер, несмещ.)', value: fmt(desc.kurtosis, '') },
  ];
  return (
    <dl className="stats__desc">
      {rows.map((r) => (
        <div key={r.label} className="stats__desc-row">
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function fmt(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  const num = value
    .toFixed(digits)
    .replace('.', ',')
    .replace(/,?0+$/, '') || '0';
  return unit ? `${num}\u00A0${unit}` : num;
}

/** Простая гистограмма с автоматическим выбором числа корзин (Sturges). */
function Histogram({
  values,
  label,
  unit,
}: {
  values: readonly number[];
  label: string;
  unit: string;
}) {
  const bins = useMemo(() => buildBins(values), [values]);

  return (
    <div className="stats__chart">
      <div className="stats__chart-title">
        Гистограмма: {label}
        {unit ? `, ${unit}` : ''}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={bins} margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--muted)' }}
            stroke="var(--border)"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'var(--muted)' }}
            stroke="var(--border)"
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
            labelStyle={{ color: 'var(--fg)' }}
          />
          <Bar dataKey="count" fill="var(--accent)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface Bin {
  label: string;
  count: number;
  low: number;
  high: number;
}

function buildBins(values: readonly number[]): Bin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ label: min.toFixed(2), count: values.length, low: min, high: min }];
  }
  // Правило Стёрджеса: k = ceil(log2(n) + 1). Простое, хорошо для n до сотен.
  const k = Math.max(3, Math.ceil(Math.log2(values.length) + 1));
  const width = (max - min) / k;
  const bins: Bin[] = Array.from({ length: k }, (_, i) => {
    const low = min + i * width;
    const high = low + width;
    return {
      low,
      high,
      label: `${low.toFixed(1)}–${high.toFixed(1)}`,
      count: 0,
    };
  });
  for (const v of values) {
    // Последняя корзина включает правую границу.
    let idx = Math.floor((v - min) / width);
    if (idx >= k) idx = k - 1;
    bins[idx]!.count += 1;
  }
  return bins;
}
