/**
 * Описательная статистика через scipy/numpy в Pyodide. Один источник истины
 * для всех числовых сводок: и для UI, и для шаблонов экспертного заключения.
 *
 * Конвенции (важно для воспроизводимости):
 *   - std считается с поправкой Бесселя (ddof=1) — это «sample standard
 *     deviation», как `numpy.std(x, ddof=1)`.
 *   - IQR — `scipy.stats.iqr(x, interpolation='linear')`.
 *   - skew/kurt — `scipy.stats.skew(x, bias=False)` и `scipy.stats.kurtosis
 *     (x, fisher=True, bias=False)` (несмещённая, эксцесс относительно
 *     нормального распределения).
 */

import { getPyodide, type LoadOptions } from './runtime';

export interface Descriptives {
  /** Число наблюдений. */
  n: number;
  mean: number;
  median: number;
  /** Стандартное отклонение, ddof=1. NaN при n < 2. */
  std: number;
  /** Межквартильный размах, линейная интерполяция. */
  iqr: number;
  min: number;
  max: number;
  /** Скос (несмещённый). NaN при n < 3. */
  skew: number;
  /** Эксцесс Фишера (несмещённый). NaN при n < 4. */
  kurtosis: number;
}

/**
 * Считает описательную статистику для одной числовой выборки.
 * При n=0 возвращает все поля как NaN, кроме n=0.
 */
export async function describe(
  data: readonly number[],
  options: LoadOptions = {},
): Promise<Descriptives> {
  const py = await getPyodide(options);

  // Передаём данные через globals — это безопаснее, чем подставлять числа в
  // строку (никакой кодогенерации, никаких проблем с локалью/NaN).
  py.globals.set('data_in', py.toPy(data));
  try {
    const result = py.runPython(`
import numpy as np
from scipy import stats

x = np.asarray(data_in, dtype=float)
n = int(x.size)
if n == 0:
    res = dict(n=0, mean=float('nan'), median=float('nan'), std=float('nan'),
               iqr=float('nan'), min=float('nan'), max=float('nan'),
               skew=float('nan'), kurtosis=float('nan'))
else:
    res = dict(
        n=n,
        mean=float(np.mean(x)),
        median=float(np.median(x)),
        std=float(np.std(x, ddof=1)) if n > 1 else float('nan'),
        iqr=float(stats.iqr(x, interpolation='linear')),
        min=float(np.min(x)),
        max=float(np.max(x)),
        skew=float(stats.skew(x, bias=False)) if n > 2 else float('nan'),
        kurtosis=float(stats.kurtosis(x, fisher=True, bias=False)) if n > 3 else float('nan'),
    )
res
`);
    return result.toJs({ dict_converter: Object.fromEntries }) as Descriptives;
  } finally {
    py.globals.delete('data_in');
  }
}
