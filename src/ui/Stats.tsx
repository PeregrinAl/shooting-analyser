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
  shapiroWilk,
  decideNormality,
  levene,
  decideVariance,
  oneWayAnova,
  welchAnova,
  kruskalWallis,
  decideMeans,
  tukeyHsd,
  dunnHolm,
  chooseGroupTest,
  getGroups,
  GROUPING_LABELS,
  type Descriptives,
  type GroupingScheme,
  type GroupMeanResult,
  type PairwiseResult,
  type VarianceResult,
  type Decision,
  type PyodideLoadStatus,
  type ScattShot,
  type ShapiroResult,
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
  return shots.map(shotValueGetter(key));
}

/** Единый getter, который проценты разворачивает в шкалу 0..100. */
function shotValueGetter(key: VarKey): (s: ScattShot) => number {
  if (key === 'hold10' || key === 'hold10plus') {
    return (s) => s[key] * 100;
  }
  return (s) => s[key] as number;
}

interface Props {
  shots: readonly ScattShot[];
}

export function Stats({ shots }: Props) {
  const [varKey, setVarKey] = useState<VarKey>('R');
  const [scheme, setScheme] = useState<GroupingScheme>('all');
  const [splitByVar, setSplitByVar] = useState<VarKey>('R');
  const [pyStatus, setPyStatus] = useState<PyodideLoadStatus>('idle');
  // Кэш сводок по переменной — чтобы переключать табы мгновенно после
  // первого расчёта. Считаем сразу всё, что нужно для одной переменной:
  // описательную статистику и критерий нормальности.
  const [cache, setCache] = useState<Map<VarKey, CacheEntry>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const variable = VARIABLES.find((v) => v.key === varKey)!;
  const values = useMemo(() => pickValues(shots, varKey), [shots, varKey]);
  const entry = cache.get(varKey);
  const desc = entry?.desc;
  const shapiro = entry?.shapiro;

  // При смене серии (например, открыли другой PDF) сбрасываем кэш — иначе
  // UI покажет старые числа, потому что cache.has(varKey) останется true.
  useEffect(() => {
    setCache(new Map());
    setError(null);
  }, [shots]);

  // Каждый раз при смене переменной — если сводки для неё ещё нет,
  // считаем сразу всё через Pyodide одной транзакцией.
  useEffect(() => {
    if (cache.has(varKey)) return;
    let cancelled = false;
    setError(null);
    Promise.all([
      describe(values, { onStatus: (s) => !cancelled && setPyStatus(s) }),
      shapiroWilk(values),
    ])
      .then(([d, sh]) => {
        if (cancelled) return;
        setCache((prev) => new Map(prev).set(varKey, { desc: d, shapiro: sh }));
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
          {shapiro && <NormalityRow shapiro={shapiro} />}

          <GroupingPicker
            scheme={scheme}
            onChange={setScheme}
            splitByVar={splitByVar}
            onSplitByChange={setSplitByVar}
          />
          {scheme !== 'all' && (
            <GroupingTable
              shots={shots}
              varKey={varKey}
              scheme={scheme}
              splitByVar={splitByVar}
              unit={variable.unit}
            />
          )}

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

function GroupingPicker({
  scheme,
  onChange,
  splitByVar,
  onSplitByChange,
}: {
  scheme: GroupingScheme;
  onChange: (s: GroupingScheme) => void;
  splitByVar: VarKey;
  onSplitByChange: (v: VarKey) => void;
}) {
  const schemes: GroupingScheme[] = ['all', 'halves', 'thirds', 'median-split'];
  return (
    <>
      <div className="stats__group-picker">
        <span className="stats__group-label">Группировка:</span>
        {schemes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={
              'stats__chip' + (s === scheme ? ' stats__chip--active' : '')
            }
          >
            {GROUPING_LABELS[s]}
          </button>
        ))}
      </div>
      {scheme === 'median-split' && (
        <div className="stats__group-picker">
          <span className="stats__group-label">Делить по медиане:</span>
          {VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => onSplitByChange(v.key)}
              className={
                'stats__chip' +
                (v.key === splitByVar ? ' stats__chip--active' : '')
              }
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

interface GroupRow {
  label: string;
  n: number;
  mean: number;
  std: number;
  shapiroP: number;
  consistentWithNormal: boolean | null;
}

interface GroupAnalysis {
  rows: GroupRow[];
  levene: VarianceResult;
  decision: Decision;
  comparison: GroupMeanResult | null;
  /** Post-hoc парные сравнения. null если k<3 или основной тест незначим. */
  pairwise: PairwiseResult | null;
}

function GroupingTable({
  shots,
  varKey,
  scheme,
  splitByVar,
  unit,
}: {
  shots: readonly ScattShot[];
  varKey: VarKey;
  scheme: GroupingScheme;
  splitByVar: VarKey;
  unit: string;
}) {
  const [analysis, setAnalysis] = useState<GroupAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Вырожденный случай: анализируем ту же переменную, по которой делим.
  // p будет около нуля, эффект — огромный, толку никакого. Показываем
  // подсказку вместо аналитики.
  const isDegenerate = scheme === 'median-split' && varKey === splitByVar;

  // Считаем для каждой подгруппы descriptives + Shapiro параллельно, потом
  // на основе нормальности+однородности выбираем критерий сравнения и
  // запускаем его. Pyodide на этом этапе уже загружен.
  useEffect(() => {
    if (isDegenerate) {
      setAnalysis(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setAnalysis(null);
    const getter = shotValueGetter(varKey);
    const splitVar = VARIABLES.find((v) => v.key === splitByVar);
    const splitBy =
      scheme === 'median-split' && splitVar
        ? {
            getter: shotValueGetter(splitByVar),
            label: splitVar.label,
            unit: splitVar.unit,
          }
        : undefined;
    const groups = getGroups(shots, scheme, getter, splitBy);

    (async () => {
      try {
        const perGroup = await Promise.all(
          groups.map(async (g) => {
            const [d, sh] = await Promise.all([
              describe(g.values),
              shapiroWilk(g.values),
            ]);
            return { group: g, desc: d, sh };
          }),
        );

        const rows: GroupRow[] = perGroup.map(({ group, desc, sh }) => {
          const verdict = decideNormality(sh.p);
          return {
            label: group.label,
            n: desc.n,
            mean: desc.mean,
            std: desc.std,
            shapiroP: sh.p,
            consistentWithNormal:
              sh.n < 3 || !Number.isFinite(sh.p)
                ? null
                : verdict.consistentWithNormal,
          };
        });

        const valuesByGroup = groups.map((g) => g.values);
        const lev = await levene(valuesByGroup);
        const varVerdict = decideVariance(lev.p);

        const decision = chooseGroupTest({
          groupNormalityOrNull: rows.map((r) => r.consistentWithNormal),
          varianceHomogeneousOrNull: varVerdict.homogeneousOrNull,
          minGroupSize: Math.min(...rows.map((r) => r.n)),
        });

        let comparison: GroupMeanResult | null = null;
        if (decision.test === 'anova') comparison = await oneWayAnova(valuesByGroup);
        else if (decision.test === 'welch') comparison = await welchAnova(valuesByGroup);
        else if (decision.test === 'kruskal') comparison = await kruskalWallis(valuesByGroup);

        // Post-hoc парные — нужны только при k≥3 и значимом основном тесте.
        // Для k=2 единственная пара уже покрыта основным тестом + Cohen's d.
        let pairwise: PairwiseResult | null = null;
        if (
          comparison &&
          comparison.k >= 3 &&
          Number.isFinite(comparison.p) &&
          comparison.p < 0.05
        ) {
          const groupLabels = groups.map((g) => g.label);
          if (comparison.test === 'kruskal') {
            pairwise = await dunnHolm(valuesByGroup, groupLabels);
          } else {
            pairwise = await tukeyHsd(valuesByGroup, groupLabels);
          }
        }

        if (cancelled) return;
        setAnalysis({ rows, levene: lev, decision, comparison, pairwise });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shots, varKey, scheme, splitByVar, isDegenerate]);

  if (isDegenerate) {
    return (
      <p className="stats__verdict stats__verdict--muted">
        Группировка и анализируемая переменная совпадают — выберите для деления
        другую переменную. (Иначе мы сравниваем R с R и получим p ≈ 0 без
        содержательного смысла.)
      </p>
    );
  }
  if (error) return <p className="app__error">Ошибка по группам: {error}</p>;
  if (!analysis) return <p className="app__status">Считаю по группам…</p>;
  const { rows, levene: lev, decision, comparison, pairwise } = analysis;

  return (
    <>
      <table className="parse-result__table stats__group-table">
        <thead>
          <tr>
            <th>Группа</th>
            <th>n</th>
            <th>Среднее{unit ? `, ${unit}` : ''}</th>
            <th>σ{unit ? `, ${unit}` : ''}</th>
            <th>Шапиро p</th>
            <th>Нормально?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.n}</td>
              <td>{r.mean.toFixed(2)}</td>
              <td>{Number.isFinite(r.std) ? r.std.toFixed(2) : '—'}</td>
              <td>{Number.isFinite(r.shapiroP) ? r.shapiroP.toFixed(3) : '—'}</td>
              <td>
                {r.consistentWithNormal === null
                  ? '—'
                  : r.consistentWithNormal
                    ? 'да'
                    : 'нет'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ComparisonPanel
        levene={lev}
        decision={decision}
        comparison={comparison}
      />

      {pairwise && <PairwiseTable pairwise={pairwise} unit={unit} />}
    </>
  );
}

const TEST_LABELS: Record<'anova' | 'welch' | 'kruskal', string> = {
  'anova': 'ANOVA (Fisher)',
  'welch': 'ANOVA (Welch)',
  'kruskal': 'Краскел-Уоллис',
};

const EFFECT_LABELS: Record<GroupMeanResult['effectSizeKind'], string> = {
  'eta-squared': 'η²',
  'omega-squared': 'ω²',
  'epsilon-squared': 'ε²',
};

function ComparisonPanel({
  levene: lev,
  decision,
  comparison,
}: {
  levene: VarianceResult;
  decision: Decision;
  comparison: GroupMeanResult | null;
}) {
  if (decision.test === 'insufficient' || !comparison) {
    return (
      <p className="stats__verdict stats__verdict--muted">
        Сравнение групп: {decision.reason}.
      </p>
    );
  }

  const varVerdict = decideVariance(lev.p);
  const meansVerdict = decideMeans(comparison.p);
  const cls = meansVerdict.differs
    ? 'stats__verdict stats__verdict--warn'
    : 'stats__verdict stats__verdict--ok';
  const verdictText = meansVerdict.differs
    ? 'между группами есть статистически значимые различия'
    : 'значимых различий между группами не выявлено';

  return (
    <div className="stats__comparison">
      <h3 className="stats__comparison-title">Сравнение групп</h3>

      <p className="stats__verdict stats__verdict--muted">
        <strong>Левен</strong>: W&nbsp;=&nbsp;{lev.statistic.toFixed(3)},
        p&nbsp;=&nbsp;{lev.p.toFixed(3)} (α&nbsp;=&nbsp;{varVerdict.alpha}) — дисперсии
        {' '}
        {varVerdict.homogeneousOrNull === null
          ? 'не оценены'
          : varVerdict.homogeneous
            ? 'совместимы с однородными'
            : 'значимо различаются'}
        .
      </p>

      <p className="stats__verdict stats__verdict--muted">
        <strong>Выбранный критерий</strong>: {TEST_LABELS[comparison.test]} — {decision.reason}.
      </p>

      <p className={cls}>
        <strong>{TEST_LABELS[comparison.test]}</strong>:{' '}
        {comparison.test === 'kruskal' ? 'H' : 'F'}&nbsp;=&nbsp;
        {comparison.statistic.toFixed(3)}
        {Number.isFinite(comparison.dfBetween) && Number.isFinite(comparison.dfWithin)
          ? ` (df ${comparison.dfBetween.toFixed(0)}/${comparison.dfWithin.toFixed(1)})`
          : Number.isFinite(comparison.dfBetween)
            ? ` (df = ${comparison.dfBetween.toFixed(0)})`
            : ''}
        , p&nbsp;=&nbsp;{comparison.p.toFixed(3)} (α&nbsp;=&nbsp;{meansVerdict.alpha});
        {' '}
        размер эффекта {EFFECT_LABELS[comparison.effectSizeKind]}
        &nbsp;=&nbsp;{comparison.effectSize.toFixed(3)}
        {Number.isFinite(comparison.cohensD) && (
          <>, Cohen&apos;s&nbsp;d&nbsp;=&nbsp;{comparison.cohensD.toFixed(2)}</>
        )} — {verdictText}.
      </p>
    </div>
  );
}

function PairwiseTable({
  pairwise,
  unit,
}: {
  pairwise: PairwiseResult;
  unit: string;
}) {
  const label =
    pairwise.test === 'tukey' ? 'Tukey HSD' : 'Данн с поправкой Холма';
  return (
    <div className="stats__comparison">
      <h3 className="stats__comparison-title">Попарные сравнения ({label})</h3>
      <table className="parse-result__table stats__group-table">
        <thead>
          <tr>
            <th>Пара</th>
            <th>
              Разница{pairwise.test === 'dunn-holm' ? ' ср. рангов' : ''}
              {unit && pairwise.test !== 'dunn-holm' ? `, ${unit}` : ''}
            </th>
            <th>p (скорр.)</th>
            <th>Cohen&apos;s d</th>
            <th>Значимо?</th>
          </tr>
        </thead>
        <tbody>
          {pairwise.pairs.map((p, i) => (
            <tr key={i}>
              <td>{p.labelA} ↔ {p.labelB}</td>
              <td>{Number.isFinite(p.meanDiff) ? p.meanDiff.toFixed(2) : '—'}</td>
              <td>{Number.isFinite(p.pAdjusted) ? p.pAdjusted.toFixed(3) : '—'}</td>
              <td>{Number.isFinite(p.cohensD) ? p.cohensD.toFixed(2) : '—'}</td>
              <td className={p.significant ? 'stats__sig' : undefined}>
                {p.significant ? 'да' : 'нет'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CacheEntry {
  desc: Descriptives;
  shapiro: ShapiroResult;
}

/** Строка-вывод критерия нормальности под таблицей descriptives. */
function NormalityRow({ shapiro }: { shapiro: ShapiroResult }) {
  const v = decideNormality(shapiro.p);
  if (shapiro.n < 3 || !Number.isFinite(shapiro.p)) {
    return (
      <p className="stats__verdict stats__verdict--muted">
        Шапиро-Уилк: n&nbsp;=&nbsp;{shapiro.n}, выборка слишком мала.
      </p>
    );
  }
  const cls = v.consistentWithNormal
    ? 'stats__verdict stats__verdict--ok'
    : 'stats__verdict stats__verdict--warn';
  const verdictText = v.consistentWithNormal
    ? 'распределение совместимо с нормальным'
    : 'распределение значимо отличается от нормального';
  return (
    <p className={cls}>
      <strong>Шапиро-Уилк</strong>: W&nbsp;=&nbsp;{shapiro.W.toFixed(3)},
      p&nbsp;=&nbsp;{shapiro.p.toFixed(3)} (α&nbsp;=&nbsp;{v.alpha}) — {verdictText}.
    </p>
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
