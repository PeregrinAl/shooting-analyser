import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ZAxis,
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
          <BoxPlot desc={desc} unit={variable.unit} />
          <ScatterByShot
            shots={shots}
            varKey={varKey}
            label={variable.label}
            unit={variable.unit}
          />
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

/**
 * Boxplot, простой SVG. Усы — от min до max (без outlier-маркеров Тьюки);
 * для размеров выборок порядка 10–60 это читается так же хорошо, а кода меньше.
 */
function BoxPlot({ desc, unit }: { desc: Descriptives; unit: string }) {
  // Ширина рисуется responsive, высота фиксирована — boxplot низкий.
  const W = 600;
  const H = 80;
  const PAD = 20;
  const innerW = W - 2 * PAD;

  const { min, max, q1, q3, median } = desc;
  if (!Number.isFinite(min) || min === max) {
    return (
      <div className="stats__chart">
        <div className="stats__chart-title">Boxplot: нечего показывать (n &lt; 2 или константа)</div>
      </div>
    );
  }
  const toX = (v: number) => PAD + ((v - min) / (max - min)) * innerW;
  const midY = H / 2;
  const boxTop = midY - 18;
  const boxBot = midY + 18;
  const whiskerTop = midY - 10;
  const whiskerBot = midY + 10;

  return (
    <div className="stats__chart">
      <div className="stats__chart-title">Boxplot</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {/* Ось */}
        <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} stroke="var(--border)" />
        {/* Усы */}
        <line x1={toX(min)} y1={midY} x2={toX(q1)} y2={midY} stroke="var(--fg)" />
        <line x1={toX(q3)} y1={midY} x2={toX(max)} y2={midY} stroke="var(--fg)" />
        <line x1={toX(min)} y1={whiskerTop} x2={toX(min)} y2={whiskerBot} stroke="var(--fg)" />
        <line x1={toX(max)} y1={whiskerTop} x2={toX(max)} y2={whiskerBot} stroke="var(--fg)" />
        {/* Коробка Q1..Q3 */}
        <rect
          x={toX(q1)}
          y={boxTop}
          width={toX(q3) - toX(q1)}
          height={boxBot - boxTop}
          fill="var(--accent)"
          fillOpacity={0.25}
          stroke="var(--accent)"
        />
        {/* Медиана */}
        <line x1={toX(median)} y1={boxTop} x2={toX(median)} y2={boxBot} stroke="var(--accent)" strokeWidth={2} />
        {/* Подписи min/max */}
        <text x={toX(min)} y={H - 4} fontSize="11" textAnchor="middle" fill="var(--muted)">
          {min.toFixed(1)}
        </text>
        <text x={toX(max)} y={H - 4} fontSize="11" textAnchor="middle" fill="var(--muted)">
          {max.toFixed(1)}
        </text>
        {/* Подпись медианы */}
        <text x={toX(median)} y={boxTop - 4} fontSize="11" textAnchor="middle" fill="var(--accent)">
          {median.toFixed(1)}{unit ? ` ${unit}` : ''}
        </text>
      </svg>
    </div>
  );
}

/**
 * Точечный график: ось X — порядковый номер выстрела, ось Y — значение
 * переменной. Помогает заметить дрейф/утомление по ходу серии.
 */
function ScatterByShot({
  shots,
  varKey,
  label,
  unit,
}: {
  shots: readonly ScattShot[];
  varKey: VarKey;
  label: string;
  unit: string;
}) {
  const data = useMemo(() => {
    const getter = (s: ScattShot): number =>
      varKey === 'hold10' || varKey === 'hold10plus'
        ? (s[varKey] as number) * 100
        : (s[varKey] as number);
    return shots.map((s) => ({ x: s.number, y: getter(s) }));
  }, [shots, varKey]);

  return (
    <div className="stats__chart">
      <div className="stats__chart-title">
        По ходу серии: {label}
        {unit ? `, ${unit}` : ''}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            dataKey="x"
            name="№"
            domain={[1, 'dataMax']}
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'var(--muted)' }}
            stroke="var(--border)"
          />
          <YAxis
            type="number"
            dataKey="y"
            name={label}
            tick={{ fontSize: 12, fill: 'var(--muted)' }}
            stroke="var(--border)"
          />
          <ZAxis range={[48, 48]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
            labelStyle={{ color: 'var(--fg)' }}
            formatter={(v: number) => v.toFixed(2)}
          />
          <Scatter data={data} fill="var(--accent)" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
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
