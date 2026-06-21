/**
 * Дерево решений по предпосылкам. На основании результатов Шапиро-Уилка
 * по каждой группе и Левена по всем группам выбирает критерий сравнения
 * средних/распределений и формулирует короткое объяснение для отчёта.
 *
 * Логика — каноническая для дисперсионного анализа в стрелковой/педагогической
 * литературе:
 *
 *   все группы нормальны + дисперсии однородны     → ANOVA (Fisher)
 *   все группы нормальны + дисперсии неоднородны   → ANOVA (Welch)
 *   хотя бы одна группа ненормальна                → Краскел-Уоллис
 */

export type GroupTestChoice = 'anova' | 'welch' | 'kruskal' | 'insufficient';

export interface DecisionInput {
  /** По одной булевой/null оценке нормальности на группу. */
  groupNormalityOrNull: readonly (boolean | null)[];
  /** Однородность дисперсий (по Левену). null — если не считалось. */
  varianceHomogeneousOrNull: boolean | null;
  /** Минимальный размер любой группы; если < 2 — сравнение бессмысленно. */
  minGroupSize: number;
}

export interface Decision {
  test: GroupTestChoice;
  /** Краткое русское объяснение, идёт прямо в шаблон заключения. */
  reason: string;
}

export function chooseGroupTest(input: DecisionInput): Decision {
  const { groupNormalityOrNull, varianceHomogeneousOrNull, minGroupSize } = input;
  const k = groupNormalityOrNull.length;

  if (k < 2 || minGroupSize < 2) {
    return {
      test: 'insufficient',
      reason: 'для сравнения нужно хотя бы две группы по два наблюдения',
    };
  }

  const hasUnknown = groupNormalityOrNull.some((v) => v === null);
  const allNormal = groupNormalityOrNull.every((v) => v === true);

  // Если по нормальности есть «не знаем» (выборка < 3), уходим в Краскела —
  // он не требует нормальности и работает на малых n.
  if (hasUnknown || !allNormal) {
    return {
      test: 'kruskal',
      reason: hasUnknown
        ? 'хотя бы в одной группе слишком мало наблюдений для оценки нормальности — применён непараметрический критерий Краскела-Уоллиса'
        : 'хотя бы в одной группе распределение значимо отличается от нормального — применён непараметрический критерий Краскела-Уоллиса',
    };
  }

  if (varianceHomogeneousOrNull === false) {
    return {
      test: 'welch',
      reason: 'нормальность подтверждена во всех группах, но дисперсии неоднородны — применён ANOVA с поправкой Уэлча',
    };
  }

  return {
    test: 'anova',
    reason: 'нормальность подтверждена во всех группах, дисперсии однородны — применён однофакторный ANOVA',
  };
}
