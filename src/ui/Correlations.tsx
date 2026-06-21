import { useEffect, useMemo, useState } from 'react';
import {
  correlations,
  describeRelation,
  type CorrelationCell,
  type CorrelationMatrix,
  type ScattShot,
} from '@core/index';

/** Те же переменные и подписи, что в Stats.tsx — повторяем явно, чтобы
 *  модуль был самостоятельным и его легко было перенести в отдельный таб. */
const VARIABLES = [
  { key: 'R',              short: 'R',       label: 'Достоинство пробоины R' },
  { key: 'T',              short: 'T',       label: 'Время прицеливания T' },
  { key: 'hold10',         short: '10',      label: 'Удержание в 10 (отн. центра)' },
  { key: 'hold10plus',     short: '10+',     label: 'Удержание в 10 (отн. СТП)' },
  { key: 'speedMmS',       short: 'v',       label: 'Скорость траектории' },
  { key: 'speed250msMmS',  short: 'v₂₅₀',    label: 'Скорость за 250 мс' },
  { key: 'distanceStpMm',  short: 'СТП',     label: 'Расстояние СТП↔пробоина' },
] as const;

type VarKey = (typeof VARIABLES)[number]['key'];

function extractColumns(shots: readonly ScattShot[]): Record<VarKey, number[]> {
  const cols = {} as Record<VarKey, number[]>;
  for (const v of VARIABLES) {
    cols[v.key] =
      v.key === 'hold10' || v.key === 'hold10plus'
        ? shots.map((s) => s[v.key] * 100)
        : shots.map((s) => s[v.key] as number);
  }
  return cols;
}

export function Correlations({ shots }: { shots: readonly ScattShot[] }) {
  const [matrix, setMatrix] = useState<CorrelationMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => extractColumns(shots), [shots]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setMatrix(null);
    correlations(data)
      .then((m) => {
        if (!cancelled) setMatrix(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) return <p className="app__error">Ошибка корреляций: {error}</p>;
  if (!matrix) return <p className="app__status">Считаю корреляции по всей серии…</p>;

  return (
    <section className="corr">
      <h2 className="stats__title">Корреляции по всей серии</h2>
      <p className="corr__hint">
        Для каждой пары переменных автоматически выбран критерий: Пирсон, если оба
        распределения совместимы с нормальным, иначе Спирмен. p&nbsp;скорректирован
        поправкой Холма по&nbsp;{matrix.cells.length}&nbsp;парам.
      </p>
      <Heatmap matrix={matrix} />
      <SignificantPairs cells={matrix.cells} />
    </section>
  );
}

function Heatmap({ matrix }: { matrix: CorrelationMatrix }) {
  const k = matrix.variables.length;

  // Восстанавливаем полную матрицу из односторонних пар.
  const byKey = new Map<string, CorrelationCell>();
  for (const c of matrix.cells) {
    byKey.set(`${c.varA}|${c.varB}`, c);
    byKey.set(`${c.varB}|${c.varA}`, c);
  }
  function getCell(i: number, j: number): CorrelationCell | null {
    if (i === j) return null;
    return byKey.get(`${matrix.variables[i]}|${matrix.variables[j]}`) ?? null;
  }

  // SVG размеры: левая полоса под подписи, сетка cellSize.
  const LABEL_W = 56;
  const CELL = 60;
  const W = LABEL_W + CELL * k;
  const H = LABEL_W + CELL * k;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 560 }}>
      {/* Подписи столбцов сверху не делаем — узко; подписываем только строки слева
          + диагональные имена. */}
      {VARIABLES.map((v, i) => (
        <text
          key={`row-${i}`}
          x={LABEL_W - 6}
          y={LABEL_W + i * CELL + CELL / 2 + 4}
          fontSize="12"
          textAnchor="end"
          fill="var(--fg)"
        >
          {v.short}
        </text>
      ))}
      {VARIABLES.map((v, i) => (
        <text
          key={`col-${i}`}
          x={LABEL_W + i * CELL + CELL / 2}
          y={LABEL_W - 6}
          fontSize="12"
          textAnchor="middle"
          fill="var(--fg)"
        >
          {v.short}
        </text>
      ))}
      {Array.from({ length: k }, (_, i) =>
        Array.from({ length: k }, (_, j) => {
          const cell = getCell(i, j);
          const x = LABEL_W + j * CELL;
          const y = LABEL_W + i * CELL;
          if (i === j) {
            return (
              <g key={`${i}-${j}`}>
                <rect x={x} y={y} width={CELL} height={CELL} fill="var(--border)" fillOpacity={0.3} />
                <text
                  x={x + CELL / 2}
                  y={y + CELL / 2 + 4}
                  fontSize="12"
                  textAnchor="middle"
                  fill="var(--muted)"
                >
                  1
                </text>
              </g>
            );
          }
          if (!cell || !Number.isFinite(cell.r)) {
            return (
              <rect
                key={`${i}-${j}`}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                fill="var(--border)"
                fillOpacity={0.1}
              />
            );
          }
          const fill = colorForR(cell.r);
          const sig = cell.significant;
          return (
            <g key={`${i}-${j}`}>
              <title>
                {VARIABLES[i]!.label} ↔ {VARIABLES[j]!.label}
                {'\n'}
                {cell.method === 'pearson' ? 'Пирсон' : 'Спирмен'}: r = {cell.r.toFixed(2)},
                {' '}p = {cell.pAdjusted.toFixed(3)}
                {sig ? ' — значимо' : ''}
              </title>
              <rect x={x} y={y} width={CELL} height={CELL} fill={fill} />
              <text
                x={x + CELL / 2}
                y={y + CELL / 2 + 4}
                fontSize="13"
                textAnchor="middle"
                fontWeight={sig ? 700 : 400}
                fill={Math.abs(cell.r) > 0.5 ? 'white' : 'var(--fg)'}
              >
                {cell.r.toFixed(2)}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}

/** Интерполируем красный/зелёный пропорционально модулю r. */
function colorForR(r: number): string {
  if (!Number.isFinite(r) || r === 0) return 'rgba(127,127,127,0.1)';
  const a = Math.min(1, Math.abs(r));
  // Зелёный: rgb(28, 138, 62); красный: rgb(196, 113, 10); смешиваем с фоном (прозрачность ~ |r|).
  const rgb = r > 0 ? '28, 138, 62' : '196, 113, 10';
  return `rgba(${rgb}, ${0.15 + 0.7 * a})`;
}

function SignificantPairs({ cells }: { cells: readonly CorrelationCell[] }) {
  const sig = cells.filter((c) => c.significant);
  if (sig.length === 0) {
    return (
      <p className="stats__verdict stats__verdict--muted">
        Значимых корреляций между переменными не выявлено (после поправки Холма).
      </p>
    );
  }

  // Сортируем по убыванию модуля r — самые сильные связи сверху.
  const sorted = [...sig].sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const labelByKey: Record<string, string> = Object.fromEntries(
    VARIABLES.map((v) => [v.key, v.label]),
  );

  return (
    <ul className="corr__list">
      {sorted.map((c) => (
        <li key={`${c.varA}-${c.varB}`} className="corr__item">
          <strong>{labelByKey[c.varA]}</strong> и{' '}
          <strong>{labelByKey[c.varB]}</strong>: связь {describeRelation(c.r)}
          {' '}({c.method === 'pearson' ? 'Пирсон' : 'Спирмен'} r&nbsp;=&nbsp;
          {c.r.toFixed(2)}, p&nbsp;=&nbsp;{c.pAdjusted.toFixed(3)}).
        </li>
      ))}
    </ul>
  );
}
