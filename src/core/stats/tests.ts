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

// ───────────────────────────────────────────────────────────────────────────
// Однородность дисперсий
// ───────────────────────────────────────────────────────────────────────────

export interface VarianceResult {
  /** Статистика критерия (W для Левена, T для Бартлетта). NaN если k < 2. */
  statistic: number;
  /** p-value. NaN при k < 2. */
  p: number;
  /** Число групп. */
  k: number;
}

/**
 * Критерий Левена на равенство дисперсий между группами.
 * Реализация — `scipy.stats.levene(*groups, center='median')` (модификация
 * Brown-Forsythe, устойчива к отклонениям от нормальности).
 */
export async function levene(
  groups: readonly (readonly number[])[],
  options: LoadOptions = {},
): Promise<VarianceResult> {
  return runGroupTest('levene', groups, options);
}

/**
 * Критерий Бартлетта. Чувствителен к ненормальности — применять только
 * когда нормальность подтверждена (см. дерево решений в decision-tree.ts).
 */
export async function bartlett(
  groups: readonly (readonly number[])[],
  options: LoadOptions = {},
): Promise<VarianceResult> {
  return runGroupTest('bartlett', groups, options);
}

/**
 * Заключение об однородности дисперсий: p > α — не отвергаем гипотезу о
 * равенстве, дисперсии «совместимы с однородными».
 */
export interface VarianceVerdict {
  homogeneous: boolean;
  homogeneousOrNull: boolean | null;
  alpha: number;
}

export function decideVariance(p: number, alpha = 0.05): VarianceVerdict {
  if (!Number.isFinite(p)) {
    return { homogeneous: false, homogeneousOrNull: null, alpha };
  }
  const homo = p > alpha;
  return { homogeneous: homo, homogeneousOrNull: homo, alpha };
}

// ───────────────────────────────────────────────────────────────────────────
// Сравнение средних
// ───────────────────────────────────────────────────────────────────────────

export interface GroupMeanResult {
  /** Название теста, для шаблонов заключения. */
  test: 'anova' | 'welch' | 'kruskal';
  /** Статистика теста. F для ANOVA/Welch, H для Краскела-Уоллиса. */
  statistic: number;
  /** Степени свободы числителя/знаменателя для F-теста (для Краскела — k-1/NaN). */
  dfBetween: number;
  dfWithin: number;
  p: number;
  /** Число групп. */
  k: number;
  /** Размер эффекта: η² для ANOVA/Welch, ε² для Краскела. */
  effectSize: number;
  effectSizeKind: 'eta-squared' | 'omega-squared' | 'epsilon-squared';
  /** Cohen's d — только при k=2; иначе NaN. Pooled-вариант. */
  cohensD: number;
}

/**
 * Однофакторный дисперсионный анализ Фишера. Применять, когда все группы
 * нормально распределены и их дисперсии однородны.
 */
export async function oneWayAnova(
  groups: readonly (readonly number[])[],
  options: LoadOptions = {},
): Promise<GroupMeanResult> {
  return runMeansTest('anova', groups, options);
}

/**
 * Дисперсионный анализ с поправкой Уэлча — для случая, когда нормальность есть,
 * но дисперсии неоднородны.
 */
export async function welchAnova(
  groups: readonly (readonly number[])[],
  options: LoadOptions = {},
): Promise<GroupMeanResult> {
  return runMeansTest('welch', groups, options);
}

/**
 * Краскел-Уоллис: непараметрический аналог. Применять, когда нормальность
 * не подтверждена хотя бы у одной группы.
 */
export async function kruskalWallis(
  groups: readonly (readonly number[])[],
  options: LoadOptions = {},
): Promise<GroupMeanResult> {
  return runMeansTest('kruskal', groups, options);
}

export interface MeansVerdict {
  /** `true` = есть статистически значимые различия между группами. */
  differs: boolean;
  differsOrNull: boolean | null;
  alpha: number;
}

export function decideMeans(p: number, alpha = 0.05): MeansVerdict {
  if (!Number.isFinite(p)) {
    return { differs: false, differsOrNull: null, alpha };
  }
  const differs = p < alpha;
  return { differs, differsOrNull: differs, alpha };
}

// ───────────────────────────────────────────────────────────────────────────
// Post-hoc парные сравнения (для k ≥ 3 при значимом основном тесте)
// ───────────────────────────────────────────────────────────────────────────

export interface PairwiseComparison {
  /** Подпись первой группы из переданного массива. */
  labelA: string;
  labelB: string;
  /** Разница средних (или средних рангов для Данна). */
  meanDiff: number;
  /** Скорректированное p-value (Tukey: tukey-adjusted; Dunn: Holm-Bonferroni). */
  pAdjusted: number;
  /** Cohen's d для этой пары (pooled). */
  cohensD: number;
  significant: boolean;
}

export interface PairwiseResult {
  test: 'tukey' | 'dunn-holm';
  pairs: PairwiseComparison[];
  alpha: number;
}

/**
 * Post-hoc парные сравнения Тьюки после ANOVA / Welch. Реализация —
 * `scipy.stats.tukey_hsd`. Возвращает все k*(k-1)/2 пар с уже скорректированными
 * p (поправка Тьюки — точное распределение студентизированного размаха).
 */
export async function tukeyHsd(
  groups: readonly (readonly number[])[],
  labels: readonly string[],
  alpha = 0.05,
  options: LoadOptions = {},
): Promise<PairwiseResult> {
  return runPairwise('tukey', groups, labels, alpha, options);
}

/**
 * Post-hoc парные сравнения Данна с поправкой Холма-Бонферрони после
 * Краскела-Уоллиса. Реализация — ручная по формулам Данна (1964):
 *   z_{ij} = (R_i − R_j) / sqrt(N(N+1)/12 * (1/n_i + 1/n_j))
 * с поправкой на связки.
 */
export async function dunnHolm(
  groups: readonly (readonly number[])[],
  labels: readonly string[],
  alpha = 0.05,
  options: LoadOptions = {},
): Promise<PairwiseResult> {
  return runPairwise('dunn-holm', groups, labels, alpha, options);
}

async function runPairwise(
  kind: 'tukey' | 'dunn-holm',
  groups: readonly (readonly number[])[],
  labels: readonly string[],
  alpha: number,
  options: LoadOptions,
): Promise<PairwiseResult> {
  const py = await getPyodide(options);
  py.globals.set('groups_in', py.toPy(groups));
  py.globals.set('labels_in', py.toPy(labels));
  try {
    const result = py.runPython(`
import numpy as np
from scipy import stats

gs = [np.asarray(g, dtype=float) for g in groups_in]
labels = list(labels_in)
k = len(gs)
alpha = ${alpha}

pairs = []

def cohens_d_pair(a, b):
    na, nb = a.size, b.size
    if na < 2 or nb < 2:
        return float('nan')
    va, vb = float(a.var(ddof=1)), float(b.var(ddof=1))
    pooled = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2)
    if pooled <= 0:
        return float('nan')
    return float((a.mean() - b.mean()) / (pooled ** 0.5))

if k < 2 or any(g.size < 2 for g in gs):
    pass
elif "${kind}" == 'tukey':
    res = stats.tukey_hsd(*gs)
    for i in range(k):
        for j in range(i + 1, k):
            pairs.append(dict(
                labelA=labels[i], labelB=labels[j],
                meanDiff=float(gs[i].mean() - gs[j].mean()),
                pAdjusted=float(res.pvalue[i, j]),
                cohensD=cohens_d_pair(gs[i], gs[j]),
                significant=bool(res.pvalue[i, j] < alpha),
            ))
else:  # dunn-holm
    # Объединённое ранжирование с учётом связок (метод 'average').
    all_x = np.concatenate(gs)
    ranks = stats.rankdata(all_x, method='average')
    # Поправка на связки: 1 − Σ(t³ − t)/(N³ − N).
    N = all_x.size
    _, counts = np.unique(all_x, return_counts=True)
    tie_term = float((counts ** 3 - counts).sum())
    tie_correction = 1.0 if N <= 1 else max(0.0, 1.0 - tie_term / (N ** 3 - N))
    # Средние ранги в группах.
    mean_ranks = []
    idx = 0
    for g in gs:
        mean_ranks.append(float(ranks[idx:idx + g.size].mean()))
        idx += g.size
    # z-статистики и сырые p.
    raw = []
    for i in range(k):
        for j in range(i + 1, k):
            ni, nj = gs[i].size, gs[j].size
            se = (((N * (N + 1) / 12.0) * tie_correction) * (1.0 / ni + 1.0 / nj)) ** 0.5
            z = abs(mean_ranks[i] - mean_ranks[j]) / se if se > 0 else float('nan')
            p = float(2.0 * (1.0 - stats.norm.cdf(z))) if np.isfinite(z) else float('nan')
            raw.append(dict(i=i, j=j, p=p))
    # Поправка Холма-Бонферрони: сортируем p по возрастанию, умножаем на (m-k+1)
    # где m = число сравнений, k = индекс в отсортированном списке.
    m = len(raw)
    indexed = sorted(enumerate(raw), key=lambda x: (x[1]['p'] if np.isfinite(x[1]['p']) else 1.0))
    holm_p = [float('nan')] * m
    prev = 0.0
    for pos, (orig_idx, rec) in enumerate(indexed):
        adj = (m - pos) * rec['p'] if np.isfinite(rec['p']) else float('nan')
        adj = min(1.0, max(prev, adj)) if np.isfinite(adj) else float('nan')
        holm_p[orig_idx] = adj
        if np.isfinite(adj):
            prev = adj
    for orig_idx, rec in enumerate(raw):
        i, j = rec['i'], rec['j']
        pairs.append(dict(
            labelA=labels[i], labelB=labels[j],
            meanDiff=float(mean_ranks[i] - mean_ranks[j]),
            pAdjusted=holm_p[orig_idx],
            cohensD=cohens_d_pair(gs[i], gs[j]),
            significant=bool(np.isfinite(holm_p[orig_idx]) and holm_p[orig_idx] < alpha),
        ))

dict(test="${kind}", pairs=pairs, alpha=alpha)
`);
    return result.toJs({ dict_converter: Object.fromEntries }) as PairwiseResult;
  } finally {
    py.globals.delete('groups_in');
    py.globals.delete('labels_in');
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Внутренние раннеры — общий каркас, чтобы добавлять критерии копированием
// одного куска Python вместо целой функции.
// ───────────────────────────────────────────────────────────────────────────

async function runGroupTest(
  kind: 'levene' | 'bartlett',
  groups: readonly (readonly number[])[],
  options: LoadOptions,
): Promise<VarianceResult> {
  const py = await getPyodide(options);
  py.globals.set('groups_in', py.toPy(groups));
  try {
    const result = py.runPython(`
import numpy as np
from scipy import stats

gs = [np.asarray(g, dtype=float) for g in groups_in]
k = len(gs)
if k < 2 or any(g.size < 2 for g in gs):
    res = dict(statistic=float('nan'), p=float('nan'), k=k)
else:
    if "${kind}" == 'levene':
        out = stats.levene(*gs, center='median')
    else:
        out = stats.bartlett(*gs)
    res = dict(statistic=float(out.statistic), p=float(out.pvalue), k=k)
res
`);
    return result.toJs({ dict_converter: Object.fromEntries }) as VarianceResult;
  } finally {
    py.globals.delete('groups_in');
  }
}

async function runMeansTest(
  kind: 'anova' | 'welch' | 'kruskal',
  groups: readonly (readonly number[])[],
  options: LoadOptions,
): Promise<GroupMeanResult> {
  const py = await getPyodide(options);
  py.globals.set('groups_in', py.toPy(groups));
  try {
    const result = py.runPython(`
import numpy as np
from scipy import stats

gs = [np.asarray(g, dtype=float) for g in groups_in]
k = len(gs)
ns = [g.size for g in gs]
N = int(sum(ns))

# Cohen's d с pooled-вариантом стандартного отклонения. Имеет смысл только
# при k=2; в шапке оставляем NaN, чтобы не путать читателей.
cohens_d = float('nan')
if k == 2 and ns[0] > 1 and ns[1] > 1:
    n1, n2 = ns[0], ns[1]
    m1, m2 = float(gs[0].mean()), float(gs[1].mean())
    v1, v2 = float(gs[0].var(ddof=1)), float(gs[1].var(ddof=1))
    pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2)
    if pooled > 0:
        cohens_d = (m1 - m2) / (pooled ** 0.5)

nan_result = dict(
    test="${kind}", statistic=float('nan'),
    dfBetween=float('nan'), dfWithin=float('nan'),
    p=float('nan'), k=k,
    effectSize=float('nan'),
    effectSizeKind='eta-squared' if "${kind}" != 'kruskal' else 'epsilon-squared',
    cohensD=cohens_d,
)

if k < 2 or any(n < 2 for n in ns):
    res = nan_result
elif "${kind}" == 'anova':
    out = stats.f_oneway(*gs)
    F = float(out.statistic); pval = float(out.pvalue)
    # Сумма квадратов: между, внутри, общая. η² = SS_b / SS_t; ω² с поправкой
    # на смещение, рекомендуется при небольших выборках.
    all_x = np.concatenate(gs)
    grand_mean = float(all_x.mean())
    ss_between = float(sum(n * (g.mean() - grand_mean) ** 2 for n, g in zip(ns, gs)))
    ss_within = float(sum(((g - g.mean()) ** 2).sum() for g in gs))
    ss_total = ss_between + ss_within
    df_b = k - 1
    df_w = N - k
    ms_within = ss_within / df_w if df_w > 0 else float('nan')
    eta2 = ss_between / ss_total if ss_total > 0 else float('nan')
    omega2 = (ss_between - df_b * ms_within) / (ss_total + ms_within) if ss_total + ms_within > 0 else float('nan')
    res = dict(
        test='anova', statistic=F,
        dfBetween=float(df_b), dfWithin=float(df_w),
        p=pval, k=k,
        effectSize=eta2,
        effectSizeKind='eta-squared',
        cohensD=cohens_d,
    )
    _ = omega2  # ω² пока не используется в UI, оставлен в формулах для отчёта
elif "${kind}" == 'welch':
    # Welch's ANOVA по формуле (см. Welch 1951). scipy.stats не имеет готовой
    # функции до 1.10, поэтому считаем явно — это переносимый код.
    means = np.array([g.mean() for g in gs])
    vars_ = np.array([g.var(ddof=1) for g in gs])
    weights = np.array([n / v if v > 0 else 0.0 for n, v in zip(ns, vars_)])
    w_sum = weights.sum()
    if w_sum <= 0:
        res = nan_result
    else:
        weighted_mean = float((weights * means).sum() / w_sum)
        df_b = k - 1
        # df знаменателя по Welch-Satterthwaite
        tmp = sum(((1 - w / w_sum) ** 2) / (n - 1) for w, n in zip(weights, ns))
        df_w = (k * k - 1) / (3 * tmp) if tmp > 0 else float('nan')
        numerator = float((weights * (means - weighted_mean) ** 2).sum() / df_b)
        denominator = 1 + (2 * (k - 2) / (k * k - 1)) * tmp
        F = numerator / denominator if denominator > 0 else float('nan')
        pval = float(stats.f.sf(F, df_b, df_w)) if np.isfinite(F) and np.isfinite(df_w) else float('nan')
        # Размер эффекта η² — формально не определён для Welch, но обычно
        # рассчитывают по обычной формуле как индикатор силы различий.
        all_x = np.concatenate(gs)
        grand_mean = float(all_x.mean())
        ss_between = float(sum(n * (g.mean() - grand_mean) ** 2 for n, g in zip(ns, gs)))
        ss_total = ss_between + float(sum(((g - g.mean()) ** 2).sum() for g in gs))
        eta2 = ss_between / ss_total if ss_total > 0 else float('nan')
        res = dict(
            test='welch', statistic=float(F),
            dfBetween=float(df_b), dfWithin=float(df_w),
            p=pval, k=k,
            effectSize=eta2,
            effectSizeKind='eta-squared',
            cohensD=cohens_d,
        )
else:  # kruskal
    out = stats.kruskal(*gs)
    H = float(out.statistic); pval = float(out.pvalue)
    # ε² = (H - k + 1) / (N - k); более устойчивая мера, чем η²_H = H / (N - 1).
    eps2 = (H - k + 1) / (N - k) if N > k else float('nan')
    res = dict(
        test='kruskal', statistic=H,
        dfBetween=float(k - 1), dfWithin=float('nan'),
        p=pval, k=k,
        effectSize=eps2,
        effectSizeKind='epsilon-squared',
        cohensD=cohens_d,
    )
res
`);
    return result.toJs({ dict_converter: Object.fromEntries }) as GroupMeanResult;
  } finally {
    py.globals.delete('groups_in');
  }
}
