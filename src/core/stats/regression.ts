/**
 * Объяснимость результата R через одиночные корреляции и множественную
 * линейную регрессию `R ~ T + 10 + 10+ + скорость + скорость250 + СТП`.
 *
 * Реализация через `numpy.linalg.lstsq` + ручной F/t-тест — это позволяет
 * не тянуть `statsmodels` в Pyodide (он ~12 МБ и сильно растягивает
 * первую загрузку).
 */

import { getPyodide, type LoadOptions } from './runtime';

export interface SingleVarFit {
  /** Ключ переменной (как пришёл во входной record). */
  variable: string;
  /** Коэффициент Пирсона. */
  r: number;
  /** r² — доля дисперсии R, объясняемая этой переменной в одиночку. */
  r2: number;
  /** p-value (двусторонний тест на r = 0). */
  p: number;
  /** Значимо после поправки Холма по числу одиночных предикторов. */
  significant: boolean;
}

export interface RegressionCoef {
  variable: string;
  coef: number;
  stdErr: number;
  t: number;
  p: number;
  significant: boolean;
}

export interface MultipleRegression {
  /** Доля общей дисперсии R, объясняемой всеми предикторами совместно. */
  r2: number;
  /** Скорректированный R²; для маленьких n — это честный показатель. */
  adjR2: number;
  /** F-статистика общего теста значимости модели. */
  fStatistic: number;
  /** p-value F-теста. */
  fPValue: number;
  /** Число наблюдений в модели. */
  n: number;
  /** Число предикторов (без константы). */
  predictors: number;
  /** Степени свободы остатков (n − p − 1). При значениях ≤ 0 модель не строится. */
  dfResidual: number;
  /** Коэффициенты по каждому предиктору, без константы. */
  coefficients: RegressionCoef[];
  /** Свободный член (для отчёта). */
  intercept: number;
}

export interface ExplainabilityResult {
  /** Переменные-предикторы (без R), отсортированы по убыванию |r|. */
  singleVariable: SingleVarFit[];
  /** Совокупная модель R ~ all_others. */
  multiple: MultipleRegression;
  alpha: number;
}

/**
 * Считает объяснимость зависимой переменной (по умолчанию R) другими.
 *
 * @param dependent ключ зависимой переменной (R)
 * @param predictors record предиктор → значения, той же длины что и dependent
 */
export async function explainResult(
  dependent: { key: string; values: readonly number[] },
  predictors: Record<string, readonly number[]>,
  alpha = 0.05,
  options: LoadOptions = {},
): Promise<ExplainabilityResult> {
  const py = await getPyodide(options);
  const predictorKeys = Object.keys(predictors);
  const predictorCols = predictorKeys.map((k) => predictors[k]!);

  py.globals.set('y_in', py.toPy(dependent.values));
  py.globals.set('x_keys_in', py.toPy(predictorKeys));
  py.globals.set('x_cols_in', py.toPy(predictorCols));
  try {
    const result = py.runPython(`
import numpy as np
from scipy import stats

y = np.asarray(y_in, dtype=float)
predictor_keys = list(x_keys_in)
predictor_cols = [np.asarray(c, dtype=float) for c in x_cols_in]
alpha = ${alpha}
n = int(y.size)
p = len(predictor_keys)

# ─── Одиночные r² по каждому предиктору против y ────────────────────────────
singles = []
for key, col in zip(predictor_keys, predictor_cols):
    if n < 3 or float(col.var()) == 0.0 or float(y.var()) == 0.0:
        singles.append(dict(variable=key, r=float('nan'), r2=float('nan'),
                            p=float('nan'), significant=False))
        continue
    out = stats.pearsonr(col, y)
    r_val = float(out.statistic); p_val = float(out.pvalue)
    singles.append(dict(variable=key, r=r_val, r2=r_val * r_val,
                        p=p_val, significant=False))

# Поправка Холма по числу одиночных предикторов.
m = len(singles)
finite = [(i, s['p']) for i, s in enumerate(singles) if np.isfinite(s['p'])]
finite.sort(key=lambda x: x[1])
prev = 0.0
for pos, (idx, p_val) in enumerate(finite):
    adj = min(1.0, max(prev, (m - pos) * p_val))
    singles[idx]['significant'] = bool(adj < alpha)
    prev = adj

# Сортируем по убыванию модуля r — самые сильные одиночные связи сверху.
singles.sort(key=lambda s: -(abs(s['r']) if np.isfinite(s['r']) else -1))

# ─── Множественная регрессия R ~ all_others ────────────────────────────────
multi_nan = dict(
    r2=float('nan'), adjR2=float('nan'),
    fStatistic=float('nan'), fPValue=float('nan'),
    n=n, predictors=p,
    dfResidual=float(n - p - 1),
    coefficients=[],
    intercept=float('nan'),
)

if n - p - 1 <= 0 or n < 3 or p < 1:
    multi = multi_nan
else:
    X = np.column_stack([np.ones(n)] + predictor_cols)
    # На случай мультиколлинеарности — pinv устойчивее inv.
    try:
        XtX = X.T @ X
        XtX_inv = np.linalg.pinv(XtX)
        beta = XtX_inv @ X.T @ y
        y_pred = X @ beta
        resid = y - y_pred
        ss_res = float((resid ** 2).sum())
        ss_tot = float(((y - y.mean()) ** 2).sum())
        if ss_tot <= 0:
            multi = multi_nan
        else:
            r2 = 1.0 - ss_res / ss_tot
            df_res = n - p - 1
            adj_r2 = 1.0 - (1.0 - r2) * (n - 1) / df_res if df_res > 0 else float('nan')
            ms_res = ss_res / df_res if df_res > 0 else float('nan')
            cov = ms_res * XtX_inv
            se = np.sqrt(np.maximum(np.diag(cov), 0.0))
            with np.errstate(divide='ignore', invalid='ignore'):
                t_stats = np.where(se > 0, beta / se, np.nan)
            p_vals = np.array([
                float(2.0 * (1.0 - stats.t.cdf(abs(t), df=df_res))) if np.isfinite(t) else float('nan')
                for t in t_stats
            ])
            # F-тест общей значимости модели.
            if ss_res > 0 and p > 0:
                f_stat = (r2 / p) / ((1.0 - r2) / df_res) if df_res > 0 else float('nan')
                f_p = float(1.0 - stats.f.cdf(f_stat, p, df_res)) if np.isfinite(f_stat) else float('nan')
            else:
                f_stat = float('nan'); f_p = float('nan')

            coeffs = []
            for i, key in enumerate(predictor_keys):
                b = float(beta[i + 1])
                s = float(se[i + 1])
                t_val = float(t_stats[i + 1])
                pv = float(p_vals[i + 1])
                coeffs.append(dict(
                    variable=key,
                    coef=b, stdErr=s, t=t_val, p=pv,
                    significant=bool(np.isfinite(pv) and pv < alpha),
                ))

            multi = dict(
                r2=float(r2), adjR2=float(adj_r2),
                fStatistic=float(f_stat), fPValue=float(f_p),
                n=n, predictors=p,
                dfResidual=float(df_res),
                coefficients=coeffs,
                intercept=float(beta[0]),
            )
    except Exception:
        multi = multi_nan

dict(singleVariable=singles, multiple=multi, alpha=alpha)
`);
    return result.toJs({ dict_converter: Object.fromEntries }) as ExplainabilityResult;
  } finally {
    py.globals.delete('y_in');
    py.globals.delete('x_keys_in');
    py.globals.delete('x_cols_in');
  }
}
