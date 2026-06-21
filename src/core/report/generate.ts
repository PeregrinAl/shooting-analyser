/**
 * Детерминированный генератор русского экспертного заключения по результатам
 * статистического анализа серии. Никаких LLM — только подстановка чисел в
 * заранее заготовленные шаблоны по дереву решений.
 *
 * Каждая секция — чистая функция, принимающая структурированные результаты
 * и возвращающая текст. Это позволяет:
 *   - юнит-тестировать отдельные шаблоны без Pyodide;
 *   - переиспользовать в HTML/PDF-экспорте на шаге 6 без изменений;
 *   - править формулировки безопасно — компилятор покажет, где это сломалось.
 */

import type { CorrelationCell, CorrelationMatrix } from '../stats/correlations';
import { categorizeStrength, describeRelation } from '../stats/correlations';
import type { ExplainabilityResult } from '../stats/regression';
import type { ScattSessionMeta, ScattShot } from '../parser/scatt-pdf';

export interface ReportSection {
  title: string;
  paragraphs: string[];
}

export interface ConclusionInput {
  session: ScattSessionMeta;
  shots: readonly ScattShot[];
  correlations: CorrelationMatrix;
  explainability: ExplainabilityResult;
  alpha?: number;
}

/** Соответствие ключей переменных читаемым русским подписям. */
const VAR_LABELS: Record<string, string> = {
  R: 'достоинство пробоины',
  T: 'время прицеливания',
  hold10: 'удержание в зоне «10» относительно центра мишени',
  hold10plus: 'удержание в зоне «10» относительно СТП',
  speedMmS: 'скорость траектории прицеливания',
  speed250msMmS: 'скорость траектории за 250 мс до выстрела',
  distanceStpMm: 'расстояние между СТП и центром пробоины',
};

export function labelOf(key: string): string {
  return VAR_LABELS[key] ?? key;
}

/**
 * Главная функция: собирает все секции в заданном порядке.
 * Пустые секции опускаются — заключение остаётся плотным.
 */
export function generateConclusion(input: ConclusionInput): ReportSection[] {
  const sections: ReportSection[] = [];
  sections.push(sessionSummarySection(input));
  sections.push(correlationsSection(input));
  sections.push(explainabilitySection(input));
  const practical = practicalInterpretationsSection(input);
  if (practical.paragraphs.length > 0) sections.push(practical);
  sections.push(caveatsSection(input));
  return sections;
}

// ─── Секция 1: Сводка сессии ───────────────────────────────────────────────

function sessionSummarySection(input: ConclusionInput): ReportSection {
  const { session, shots } = input;
  const n = shots.length;
  const meanR = n > 0 ? shots.reduce((a, s) => a + s.R, 0) / n : NaN;
  const sumR = n > 0 ? shots.reduce((a, s) => a + s.R, 0) : NaN;

  const parts: string[] = [];

  const who =
    session.shooterName && session.dateRaw
      ? `Стрелок: ${session.shooterName}. Дата серии: ${session.dateRaw}.`
      : session.shooterName
        ? `Стрелок: ${session.shooterName}.`
        : session.dateRaw
          ? `Дата серии: ${session.dateRaw}.`
          : '';
  if (who) parts.push(who);

  parts.push(
    `Проанализирована серия из ${n} ${pluralShots(n)}. ` +
      (Number.isFinite(session.totalScoreInt)
        ? `Итоговый результат — ${session.totalScoreInt}` +
          (Number.isFinite(session.totalScoreDecimal)
            ? ` (с десятыми долями ${session.totalScoreDecimal!.toFixed(1)})`
            : '') +
          '. '
        : '') +
      `Среднее достоинство пробоины ${fmt(meanR, 2)}, сумма ${fmt(sumR, 1)}.`,
  );

  if (n < 20) {
    parts.push(
      `Объём выборки невелик: некоторые оценки (особенно скорректированный R² и коэффициенты регрессии) будут менее устойчивы, чем на серии из 30+ выстрелов.`,
    );
  }

  return { title: 'Сводка сессии', paragraphs: parts };
}

// ─── Секция 2: Связи между параметрами (корреляции) ────────────────────────

function correlationsSection(input: ConclusionInput): ReportSection {
  const sig = input.correlations.cells
    .filter((c) => c.significant)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  if (sig.length === 0) {
    return {
      title: 'Связи между параметрами',
      paragraphs: [
        `Значимых корреляций между переменными прицеливания (после поправки Холма на ${input.correlations.cells.length} пар) не выявлено. На данной серии параметры варьируются независимо друг от друга.`,
      ],
    };
  }

  const top = sig.slice(0, 5);
  const lines = top.map((c) => describeCorrelationCell(c));
  const tail =
    sig.length > 5
      ? `Ещё ${sig.length - 5} ${pluralPairs(sig.length - 5)} со значимой связью — см. heatmap.`
      : '';

  const intro =
    sig.length === 1
      ? `Выявлена одна значимая связь между параметрами прицеливания.`
      : `Выявлены ${sig.length} значимые${sig.length > 4 ? '' : 'х'} связи между параметрами прицеливания (после поправки Холма):`;

  const parts = [intro, ...lines];
  if (tail) parts.push(tail);
  return { title: 'Связи между параметрами', paragraphs: parts };
}

function describeCorrelationCell(c: CorrelationCell): string {
  const a = labelOf(c.varA);
  const b = labelOf(c.varB);
  const rel = describeRelation(c.r);
  const method = c.method === 'pearson' ? 'Пирсон' : 'Спирмен';
  return `${cap(a)} ↔ ${b}: связь ${rel} (${method} r = ${fmt(c.r, 2)}, p = ${fmt(c.pAdjusted, 3)}, r² = ${fmt(c.r * c.r, 2)}).`;
}

// ─── Секция 3: Объяснимость результата R ───────────────────────────────────

function explainabilitySection(input: ConclusionInput): ReportSection {
  const { multiple, singleVariable } = input.explainability;
  const parts: string[] = [];

  // Совокупная модель.
  if (!Number.isFinite(multiple.r2)) {
    parts.push(
      `Множественная регрессия не построена: выборка слишком мала (df остатков ${fmt(multiple.dfResidual, 0)}).`,
    );
  } else {
    const adjPct = (multiple.adjR2 * 100).toFixed(1);
    const totalPct = (multiple.r2 * 100).toFixed(1);
    const significant =
      Number.isFinite(multiple.fPValue) && multiple.fPValue < (input.alpha ?? 0.05);
    parts.push(
      `Все ${multiple.predictors} параметра прицеливания совместно объясняют ${totalPct} % разброса результата (скорректированный R² = ${adjPct} %). F-тест общей значимости: F = ${fmt(multiple.fStatistic, 2)}, p = ${fmt(multiple.fPValue, 3)} — модель в целом ${significant ? 'значима' : 'не значима'} на уровне ${input.alpha ?? 0.05}.`,
    );
    parts.push(
      `Это значит, что около ${(100 - parseFloat(adjPct)).toFixed(0)} % дисперсии результата приходится на факторы, которых нет в файле SCATT (работа со спуском, дыхание, состояние стрелка) и на нелинейные эффекты, которые линейная модель не улавливает.`,
    );
  }

  // Самые значимые одиночные параметры.
  const topSingle = singleVariable
    .filter((s) => s.significant)
    .slice(0, 3);
  if (topSingle.length > 0) {
    const list = topSingle
      .map(
        (s) =>
          `${labelOf(s.variable)} (r² = ${fmt(s.r2, 3)}, ≈${(s.r2 * 100).toFixed(1)} %)`,
      )
      .join('; ');
    parts.push(`Самые сильные одиночные связи с результатом: ${list}.`);
  }

  // Значимые коэффициенты в регрессии.
  const sigCoeffs = multiple.coefficients.filter((c) => c.significant);
  if (sigCoeffs.length > 0) {
    const list = sigCoeffs
      .map((c) => `${labelOf(c.variable)} (β = ${fmt(c.coef, 3)}, p = ${fmt(c.p, 3)})`)
      .join('; ');
    parts.push(
      `В совместной модели значимый собственный вклад поверх остальных параметров вносят: ${list}.`,
    );
  }

  return { title: 'Объяснимость результата', paragraphs: parts };
}

// ─── Секция 4: Практические интерпретации ──────────────────────────────────

function practicalInterpretationsSection(input: ConclusionInput): ReportSection {
  const parts: string[] = [];

  // Эталонная связь стабильности: высокая скорость ⇄ низкое удержание в 10.
  const speedHoldPair = findPair(
    input.correlations.cells,
    'speedMmS',
    'hold10plus',
  );
  if (speedHoldPair && speedHoldPair.significant && speedHoldPair.r < 0) {
    parts.push(
      `Сильная отрицательная связь скорости траектории и удержания в зоне «10» относительно СТП согласуется с эталонной картиной стабильности прицеливания: чем быстрее перемещается марка, тем меньше времени она проводит в десятке. На графиках это выглядит как «беспокойная» траектория с короткими заходами в зону против «спокойной» траектории с задержками.`,
    );
  }

  // Связь времени прицеливания и результата: если значимая отрицательная — гипотеза «передержка».
  const timeResultPair = findPair(input.correlations.cells, 'T', 'R');
  if (timeResultPair && timeResultPair.significant) {
    if (timeResultPair.r < 0) {
      parts.push(
        `Выявлена отрицательная связь времени прицеливания и результата: более долгие подходы в этой серии заканчиваются худшими выстрелами. На уровне статистики это согласуется с гипотезой «передержки» — затягивание выстрела ухудшает попадание.`,
      );
    } else {
      parts.push(
        `Выявлена положительная связь времени прицеливания и результата: более долгие подходы в этой серии заканчиваются лучшими выстрелами. Это может говорить о том, что в данной серии стрелок выигрывает от более тщательной подготовки выстрела.`,
      );
    }
  }

  // Связь дистанции пробоины от СТП и результата — если значимая, это «системность кучности».
  const distRPair = findPair(input.correlations.cells, 'distanceStpMm', 'R');
  if (distRPair && distRPair.significant && distRPair.r < 0) {
    parts.push(
      `Чем дальше пробоина от средней точки попадания, тем ниже её достоинство — это арифметическое следствие самой природы СТП и обычно ожидаемо. Стоит обратить внимание на сами координаты СТП относительно центра мишени: их можно сместить настройкой прицела, и это сдвинет достоинство всей серии.`,
    );
  }

  return { title: 'Практические интерпретации', paragraphs: parts };
}

// ─── Секция 5: Оговорки ────────────────────────────────────────────────────

function caveatsSection(input: ConclusionInput): ReportSection {
  const parts: string[] = [];
  const n = input.shots.length;

  if (n < 30) {
    parts.push(
      `Серия из ${n} ${pluralShots(n)} — это пилотный объём. Для устойчивых выводов о структурных закономерностях желательно 30 и более выстрелов в сопоставимых условиях.`,
    );
  }

  parts.push(
    `Инструмент анализирует только то, что записывает SCATT (траектория марки до выстрела и его последствия). Работа со спуском, дыхание, психологическое состояние, ветер и качество боеприпасов в данные не попадают и в анализе не отражены.`,
  );

  parts.push(
    `Все приведённые статистики и связи описывают конкретную серию, а не «стрелка в целом». Перенос выводов на другие серии и условия — отдельная задача и требует повторных замеров.`,
  );

  return { title: 'Оговорки', paragraphs: parts };
}

// ─── Утилиты ───────────────────────────────────────────────────────────────

function findPair(
  cells: readonly CorrelationCell[],
  a: string,
  b: string,
): CorrelationCell | null {
  return (
    cells.find(
      (c) =>
        (c.varA === a && c.varB === b) || (c.varA === b && c.varB === a),
    ) ?? null
  );
}

function fmt(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function pluralShots(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'выстрела';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'выстрелов';
  return 'выстрелов';
}

function pluralPairs(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'пара';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'пары';
  return 'пар';
}

// Категория силы используется для решения, упоминать ли пары — оставляем
// импорт для будущих интерпретаций (избегаем «unused» warn).
void categorizeStrength;
