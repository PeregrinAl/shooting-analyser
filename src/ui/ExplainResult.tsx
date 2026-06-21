import { useEffect, useMemo, useState } from 'react';
import {
  explainResult,
  type ExplainabilityResult,
  type ScattShot,
} from '@core/index';

/**
 * Объяснимость результата R: одиночные r² по каждому параметру + общая
 * множественная регрессия `R ~ T + 10 + 10+ + скорость + скорость250 + СТП`.
 */

const PREDICTORS = [
  { key: 'T',              label: 'Время прицеливания T' },
  { key: 'hold10',         label: 'Удержание в 10 (отн. центра)' },
  { key: 'hold10plus',     label: 'Удержание в 10 (отн. СТП)' },
  { key: 'speedMmS',       label: 'Скорость траектории' },
  { key: 'speed250msMmS',  label: 'Скорость за 250 мс' },
  { key: 'distanceStpMm',  label: 'Расстояние СТП↔пробоина' },
] as const;

type PredictorKey = (typeof PREDICTORS)[number]['key'];

function extractColumns(shots: readonly ScattShot[]): Record<PredictorKey, number[]> {
  const cols = {} as Record<PredictorKey, number[]>;
  for (const v of PREDICTORS) {
    cols[v.key] =
      v.key === 'hold10' || v.key === 'hold10plus'
        ? shots.map((s) => s[v.key] * 100)
        : shots.map((s) => s[v.key] as number);
  }
  return cols;
}

export function ExplainResult({ shots }: { shots: readonly ScattShot[] }) {
  const [result, setResult] = useState<ExplainabilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => {
    const predictors = extractColumns(shots);
    const yValues = shots.map((s) => s.R);
    return { yValues, predictors };
  }, [shots]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setResult(null);
    explainResult({ key: 'R', values: data.yValues }, data.predictors)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) return <p className="app__error">Ошибка регрессии: {error}</p>;
  if (!result) return <p className="app__status">Считаю объяснимость результата…</p>;

  return (
    <section className="explain">
      <h2 className="stats__title">Объяснимость результата R</h2>
      <p className="corr__hint">
        Какая доля изменчивости достоинства пробоины объясняется параметрами
        прицеливания: каждый параметр поодиночке и все вместе.
      </p>

      <SingleVariableTable result={result} />
      <MultipleRegressionBlock result={result} />
    </section>
  );
}

function SingleVariableTable({ result }: { result: ExplainabilityResult }) {
  const labelByKey: Record<string, string> = Object.fromEntries(
    PREDICTORS.map((p) => [p.key, p.label]),
  );
  return (
    <div className="explain__block">
      <h3 className="stats__comparison-title">Одиночные параметры → R</h3>
      <p className="explain__hint">
        r² — доля дисперсии R, которую переменная объясняет **в одиночку** (линейно).
        Без учёта взаимных корреляций между параметрами.
      </p>
      <table className="parse-result__table">
        <thead>
          <tr>
            <th>Параметр</th>
            <th>r</th>
            <th>r²</th>
            <th>r² · 100 %</th>
            <th>p</th>
            <th>Значимо?</th>
          </tr>
        </thead>
        <tbody>
          {result.singleVariable.map((s) => (
            <tr key={s.variable}>
              <td>{labelByKey[s.variable] ?? s.variable}</td>
              <td>{Number.isFinite(s.r) ? s.r.toFixed(2) : '—'}</td>
              <td>{Number.isFinite(s.r2) ? s.r2.toFixed(3) : '—'}</td>
              <td>{Number.isFinite(s.r2) ? `${(s.r2 * 100).toFixed(1)} %` : '—'}</td>
              <td>{Number.isFinite(s.p) ? s.p.toFixed(3) : '—'}</td>
              <td className={s.significant ? 'stats__sig' : undefined}>
                {s.significant ? 'да' : 'нет'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MultipleRegressionBlock({ result }: { result: ExplainabilityResult }) {
  const { multiple: m } = result;
  const labelByKey: Record<string, string> = Object.fromEntries(
    PREDICTORS.map((p) => [p.key, p.label]),
  );

  const tooFew = m.dfResidual <= 0 || !Number.isFinite(m.r2);
  const sparse = m.dfResidual > 0 && m.dfResidual < 5;

  return (
    <div className="explain__block">
      <h3 className="stats__comparison-title">Все параметры вместе → R</h3>
      <p className="explain__hint">
        Множественная линейная регрессия R на все шесть параметров.
        R² — совокупная объяснимость; скорректированный R² — она же с поправкой
        на число предикторов (честный показатель при небольшой выборке).
      </p>

      {tooFew ? (
        <p className="stats__verdict stats__verdict--muted">
          Выборка слишком мала для модели с {m.predictors}&nbsp;предикторами
          (df остатков {m.dfResidual.toFixed(0)} ≤ 0). Сделайте серию не меньше 8 выстрелов.
        </p>
      ) : (
        <>
          <dl className="explain__summary">
            <div>
              <dt>R² (общий)</dt>
              <dd>
                <strong>{m.r2.toFixed(3)}</strong>
                {' '}
                <span className="explain__muted">({(m.r2 * 100).toFixed(1)}&nbsp;%)</span>
              </dd>
            </div>
            <div>
              <dt>R² скорректированный</dt>
              <dd>
                <strong>{m.adjR2.toFixed(3)}</strong>
                {' '}
                <span className="explain__muted">
                  ({Number.isFinite(m.adjR2) ? `${(m.adjR2 * 100).toFixed(1)} %` : '—'})
                </span>
              </dd>
            </div>
            <div>
              <dt>F-тест общей значимости</dt>
              <dd>
                F&nbsp;=&nbsp;{m.fStatistic.toFixed(2)} (df {m.predictors}/
                {m.dfResidual.toFixed(0)}), p&nbsp;=&nbsp;{m.fPValue.toFixed(3)}
              </dd>
            </div>
            <div>
              <dt>Наблюдений</dt>
              <dd>{m.n}</dd>
            </div>
          </dl>

          {sparse && (
            <p className="stats__verdict stats__verdict--muted">
              df остатков всего {m.dfResidual.toFixed(0)} — оценки коэффициентов
              нестабильны. Чем серия длиннее, тем надёжнее.
            </p>
          )}

          <table className="parse-result__table explain__coeffs">
            <thead>
              <tr>
                <th>Параметр</th>
                <th>Коэффициент</th>
                <th>SE</th>
                <th>t</th>
                <th>p</th>
                <th>Значимо?</th>
              </tr>
            </thead>
            <tbody>
              {m.coefficients.map((c) => (
                <tr key={c.variable}>
                  <td>{labelByKey[c.variable] ?? c.variable}</td>
                  <td>{Number.isFinite(c.coef) ? c.coef.toFixed(3) : '—'}</td>
                  <td>{Number.isFinite(c.stdErr) ? c.stdErr.toFixed(3) : '—'}</td>
                  <td>{Number.isFinite(c.t) ? c.t.toFixed(2) : '—'}</td>
                  <td>{Number.isFinite(c.p) ? c.p.toFixed(3) : '—'}</td>
                  <td className={c.significant ? 'stats__sig' : undefined}>
                    {c.significant ? 'да' : 'нет'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
