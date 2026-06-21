/**
 * Статистические критерии через scipy.stats. Каждое семейство — отдельная
 * функция, чтобы её было удобно добавлять/тестировать инкрементально и
 * подвязывать к шаблонам экспертного заключения.
 *
 * На шаге 4.1 — только Шапиро-Уилк (нормальность). Дальше по той же схеме
 * пойдут Левен/Бартлетт, ANOVA + Welch, Краскел-Уоллис, Манн-Уитни,
 * Уилкоксон, Фридман, Данн.
 */

import { getPyodide, type LoadOptions } from './runtime';

export interface ShapiroResult {
  /** Статистика W. NaN если выборка слишком мала. */
  W: number;
  /** p-value. NaN при недостаточном n. */
  p: number;
  /** Число наблюдений. */
  n: number;
}

/**
 * Критерий Шапиро-Уилка на нормальность распределения. Реализация — `scipy.
 * stats.shapiro`. Применим при 3 ≤ n ≤ 5000 (scipy предупреждает за рамками,
 * но возвращает результат). Возвращает NaN/NaN при n < 3.
 */
export async function shapiroWilk(
  data: readonly number[],
  options: LoadOptions = {},
): Promise<ShapiroResult> {
  const py = await getPyodide(options);
  py.globals.set('data_in', py.toPy(data));
  try {
    const result = py.runPython(`
import numpy as np
from scipy import stats

x = np.asarray(data_in, dtype=float)
n = int(x.size)
if n < 3:
    res = dict(W=float('nan'), p=float('nan'), n=n)
else:
    out = stats.shapiro(x)
    res = dict(W=float(out.statistic), p=float(out.pvalue), n=n)
res
`);
    return result.toJs({ dict_converter: Object.fromEntries }) as ShapiroResult;
  } finally {
    py.globals.delete('data_in');
  }
}

/**
 * Заключение по критерию: при p > α не отвергаем гипотезу о нормальности.
 * Уровень значимости по умолчанию 0,05 — настраивается из UI.
 */
export interface NormalityVerdict {
  /** `true` = распределение совместимо с нормальным (p > α). */
  consistentWithNormal: boolean;
  /** `null` если выборка слишком мала или p = NaN. */
  consistentWithNormalOrNull: boolean | null;
  alpha: number;
}

export function decideNormality(p: number, alpha = 0.05): NormalityVerdict {
  if (!Number.isFinite(p)) {
    return { consistentWithNormal: false, consistentWithNormalOrNull: null, alpha };
  }
  const consistent = p > alpha;
  return {
    consistentWithNormal: consistent,
    consistentWithNormalOrNull: consistent,
    alpha,
  };
}
