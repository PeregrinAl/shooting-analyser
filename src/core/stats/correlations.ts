/**
 * Корреляционный анализ всей серии без деления на группы.
 *
 * Для каждой пары переменных автоматически выбираем критерий:
 *   - оба распределения совместимы с нормальным (Шапиро-Уилк p > α) → Пирсон
 *   - иначе → Спирмен
 *
 * p-value скорректирован поправкой Холма-Бонферрони на множественные сравнения
 * (21 уникальная пара для 7 переменных).
 */

import { getPyodide, type LoadOptions } from './runtime';

export interface CorrelationCell {
  /** Ключ первой переменной (как пришёл во входной record). */
  varA: string;
  varB: string;
  /** Какой критерий применился к этой паре. */
  method: 'pearson' | 'spearman';
  /** Коэффициент корреляции, от −1 до 1. */
  r: number;
  /** Сырой p (до поправки на множественность). */
  pRaw: number;
  /** Скорректированный p (Холм-Бонферрони, по 21 паре). */
  pAdjusted: number;
  /** Число наблюдений в паре. */
  n: number;
  significant: boolean;
}

export interface CorrelationMatrix {
  /** Имена переменных в порядке строк/столбцов матрицы. */
  variables: string[];
  /** Уникальные пары (i < j), 21 элемент для 7 переменных. */
  cells: CorrelationCell[];
  alpha: number;
}

/**
 * Считает корреляции для всех уникальных пар переменных.
 * Все массивы во входе должны быть одной длины (по числу выстрелов).
 */
export async function correlations(
  data: Record<string, readonly number[]>,
  alpha = 0.05,
  options: LoadOptions = {},
): Promise<CorrelationMatrix> {
  const py = await getPyodide(options);
  const variables = Object.keys(data);
  const columns = variables.map((k) => data[k]!);

  py.globals.set('variables_in', py.toPy(variables));
  py.globals.set('columns_in', py.toPy(columns));
  try {
    const result = py.runPython(`
import numpy as np
from scipy import stats

variables = list(variables_in)
columns = [np.asarray(c, dtype=float) for c in columns_in]
alpha = ${alpha}
k = len(variables)
n_obs = columns[0].size if columns else 0

# Сначала для каждой переменной решаем, нормально ли распределение.
def is_normal(x):
    if x.size < 3:
        return False
    try:
        s = stats.shapiro(x)
        return bool(s.pvalue > alpha)
    except Exception:
        return False

normality = [is_normal(c) for c in columns]

# Для каждой пары считаем r и сырой p.
raw_pairs = []
for i in range(k):
    for j in range(i + 1, k):
        x, y = columns[i], columns[j]
        method = 'pearson' if normality[i] and normality[j] else 'spearman'
        if x.size < 3 or y.size < 3 or float(x.var()) == 0.0 or float(y.var()) == 0.0:
            r = float('nan'); p = float('nan')
        elif method == 'pearson':
            out = stats.pearsonr(x, y)
            r = float(out.statistic); p = float(out.pvalue)
        else:
            out = stats.spearmanr(x, y)
            r = float(out.correlation if hasattr(out, 'correlation') else out.statistic)
            p = float(out.pvalue)
        raw_pairs.append(dict(
            i=i, j=j,
            varA=variables[i], varB=variables[j],
            method=method, r=r, pRaw=p, n=int(x.size),
        ))

# Поправка Холма по числу всех пар.
m = len(raw_pairs)
finite_ps = [(idx, rp['pRaw']) for idx, rp in enumerate(raw_pairs) if np.isfinite(rp['pRaw'])]
finite_ps.sort(key=lambda x: x[1])
holm_adj = [float('nan')] * m
prev = 0.0
for pos, (orig_idx, p) in enumerate(finite_ps):
    adj = min(1.0, max(prev, (m - pos) * p))
    holm_adj[orig_idx] = adj
    prev = adj

cells = []
for rp, p_adj in zip(raw_pairs, holm_adj):
    cells.append(dict(
        varA=rp['varA'], varB=rp['varB'],
        method=rp['method'],
        r=rp['r'], pRaw=rp['pRaw'],
        pAdjusted=p_adj,
        n=rp['n'],
        significant=bool(np.isfinite(p_adj) and p_adj < alpha),
    ))

_ = n_obs  # сохраняем имя в области видимости, может пригодиться для отладки
dict(variables=variables, cells=cells, alpha=alpha)
`);
    return result.toJs({ dict_converter: Object.fromEntries }) as CorrelationMatrix;
  } finally {
    py.globals.delete('variables_in');
    py.globals.delete('columns_in');
  }
}

/**
 * Категоризация силы связи по модулю r — для словесного описания пары.
 * Шкала Чеддока (классическая, школа Котла-Розанова) — общепринятая.
 */
export type CorrelationStrength =
  | 'very-weak'
  | 'weak'
  | 'moderate'
  | 'strong'
  | 'very-strong';

export function categorizeStrength(r: number): CorrelationStrength {
  const a = Math.abs(r);
  if (a < 0.1) return 'very-weak';
  if (a < 0.3) return 'weak';
  if (a < 0.5) return 'moderate';
  if (a < 0.7) return 'strong';
  return 'very-strong';
}

const STRENGTH_LABELS: Record<CorrelationStrength, string> = {
  'very-weak': 'практически отсутствует',
  'weak': 'слабая',
  'moderate': 'умеренная',
  'strong': 'сильная',
  'very-strong': 'очень сильная',
};

/** Словесное описание связи: «умеренная положительная» / «сильная отрицательная». */
export function describeRelation(r: number): string {
  if (!Number.isFinite(r)) return 'не определена';
  const strength = STRENGTH_LABELS[categorizeStrength(r)];
  if (categorizeStrength(r) === 'very-weak') return strength;
  return r > 0 ? `${strength} положительная` : `${strength} отрицательная`;
}
