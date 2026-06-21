/**
 * Парсер табличного экспорта SCATT Expert (PDF).
 *
 * Делает одно: по байтам PDF возвращает массив выстрелов с числовыми
 * переменными, плюс краткие метаданные сессии с первой страницы.
 *
 * Что извлекается из строки выстрела (см. шапку таблицы в PDF):
 *   №, R, T, удержание в габарите 10 (отн. центра), 10+ (отн. СТП),
 *   средняя скорость траектории, скорость за 250 мс, расстояние СТП↔пробоина.
 *
 * Что НЕ извлекается: колонка «направление» — в PDF это глиф-стрелка,
 * текстом не отдаётся. Поле остаётся `null`; направление пойдёт через трек 2.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem as PdfTextItem } from 'pdfjs-dist/types/src/display/api';

export interface ScattShot {
  /** Порядковый номер в серии, 1-based. */
  number: number;
  /** Достоинство пробоины с десятыми долями, напр. 10.6. */
  R: number;
  /** Время прицеливания, секунды. */
  T: number;
  /** Доля времени в габарите 10 относительно центра мишени, 0..1. */
  hold10: number;
  /** Доля времени в габарите 10 относительно СТП, 0..1. */
  hold10plus: number;
  /** Средняя скорость траектории прицеливания, мм/с. */
  speedMmS: number;
  /** Средняя скорость траектории за 250 мс до выстрела, мм/с. */
  speed250msMmS: number;
  /** Расстояние между СТП и центром пробоины, мм. */
  distanceStpMm: number;
  /** Направление отклонения СТП. В PDF — глиф, через PDF не извлекается. */
  direction: null;
}

export interface ScattSessionMeta {
  /** Сырая строка с первой страницы, обычно «04.04.2026 17:32». */
  dateRaw: string | null;
  shooterName: string | null;
  /** Итоговый «целый» результат серии (без десятых), напр. 95. */
  totalScoreInt: number | null;
  /** Итоговый результат с десятыми долями, напр. 100.1. */
  totalScoreDecimal: number | null;
  /** Заявленное число выстрелов с первой страницы. */
  declaredShotCount: number | null;
}

export interface ScattExportResult {
  session: ScattSessionMeta;
  shots: ScattShot[];
}

/**
 * X-координаты колонок таблицы выстрелов. Подобраны эмпирически по
 * `storage/scatt-test-{10,60}-units.pdf`; допуск ±5 pt.
 */
const COL_X = {
  number: 230,
  R: 300, // SCATT центрирует по правому краю — 9.5 и 10.6 имеют чуть разные x
  T: 335,
  hold10: 372,
  hold10plus: 405,
  speed: 439,
  speed250ms: 475,
  distance: 518,
} as const;

const COL_TOLERANCE = 8;

interface TextItem {
  x: number;
  y: number;
  str: string;
}

type Row = TextItem[];

/** Группирует элементы по строке (одинаковая y с округлением). */
function groupByRow(items: TextItem[]): Row[] {
  const rowsMap = new Map<number, Row>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const key = Math.round(it.y * 10) / 10;
    let bucket = rowsMap.get(key);
    if (!bucket) {
      bucket = [];
      rowsMap.set(key, bucket);
    }
    bucket.push(it);
  }
  const rows = [...rowsMap.values()];
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

/** Достаёт значение у нужной x-колонки; возвращает null, если нет. */
function pickCell(row: Row, targetX: number): string | null {
  let best: TextItem | null = null;
  let bestDx = Infinity;
  for (const it of row) {
    const dx = Math.abs(it.x - targetX);
    if (dx < bestDx && dx <= COL_TOLERANCE) {
      best = it;
      bestDx = dx;
    }
  }
  return best?.str ?? null;
}

/** «23%» → 0.23, «100%» → 1.0; null → NaN. */
function parsePercent(s: string | null): number {
  if (!s) return NaN;
  const m = s.match(/^(\d+(?:\.\d+)?)%$/);
  return m ? Number(m[1]) / 100 : NaN;
}

/** Любая локаль: запятая или точка как разделитель. */
function parseNumber(s: string | null): number {
  if (!s) return NaN;
  return Number(s.replace(',', '.'));
}

/** Парсит строку таблицы выстрела; возвращает null, если структура не шотовая. */
function tryParseShotRow(row: Row): ScattShot | null {
  const numStr = pickCell(row, COL_X.number);
  if (!numStr) return null;

  // № должен быть положительным целым.
  const number = Number(numStr);
  if (!Number.isInteger(number) || number <= 0) return null;

  const R = parseNumber(pickCell(row, COL_X.R));
  const T = parseNumber(pickCell(row, COL_X.T));
  const hold10 = parsePercent(pickCell(row, COL_X.hold10));
  const hold10plus = parsePercent(pickCell(row, COL_X.hold10plus));
  const speedMmS = parseNumber(pickCell(row, COL_X.speed));
  const speed250msMmS = parseNumber(pickCell(row, COL_X.speed250ms));
  const distanceStpMm = parseNumber(pickCell(row, COL_X.distance));

  // R должно быть «достоинством пробоины» (от 0 до 10.9), а не общим результатом
  // серии (e.g. 95). Это отсекает строки подсумм, где № = общий результат, а
  // в колонке R стоит результат с десятыми.
  if (!(R >= 0 && R <= 11)) return null;

  // Все остальные тоже должны быть числами.
  if ([T, hold10, hold10plus, speedMmS, speed250msMmS, distanceStpMm].some(Number.isNaN)) {
    return null;
  }

  return {
    number,
    R,
    T,
    hold10,
    hold10plus,
    speedMmS,
    speed250msMmS,
    distanceStpMm,
    direction: null,
  };
}

/** Извлекает метаданные сессии со страницы 1, насколько это удаётся. */
function extractSessionMeta(items: TextItem[]): ScattSessionMeta {
  const strs = items.map((i) => i.str);

  // Имя стрелка SCATT ставит в левую колонку шапки (x ~ 58 pt от края), под ним
  // — дата и название мишени. Берём самый верхний элемент, прижатый к левому
  // полю, который не выглядит как дата или цифровая разметка мишени.
  const LEFT_X_MAX = 80;
  const leftColumn = items
    .filter((it) => it.x < LEFT_X_MAX && it.str.trim())
    .sort((a, b) => b.y - a.y);
  const shooterName =
    leftColumn.find((it) => {
      const s = it.str.trim();
      if (/^\d/.test(s)) return false;
      if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) return false;
      return true;
    })?.str.trim() ?? null;

  const dateRaw =
    strs.find((s) => /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(s.trim())) ?? null;

  // «Выстрелов 10» — заявленное число выстрелов.
  const shotCountIdx = strs.findIndex((s) => s.trim() === 'Выстрелов');
  const declaredShotCount =
    shotCountIdx >= 0
      ? (() => {
          const v = items[shotCountIdx]!.y;
          const onSameRow = items
            .filter((it) => Math.abs(it.y - v) < 1)
            .map((it) => it.str.trim())
            .filter((s) => /^\d+$/.test(s));
          return onSameRow.length ? Number(onSameRow[onSameRow.length - 1]) : null;
        })()
      : null;

  // «Результат → целый/с десятыми долями» — два числа.
  const totalScoreInt = pickNumberAfterLabel(items, 'целый', { intOnly: true });
  const totalScoreDecimal = pickNumberAfterLabel(items, 'с десятыми долями');

  return {
    dateRaw,
    shooterName,
    totalScoreInt,
    totalScoreDecimal,
    declaredShotCount,
  };
}

/**
 * Ищет лейбл (например «целый») и возвращает первое число, лежащее на той же
 * y-линии правее. Для меток, повторяющихся несколько раз («целый» бывает дважды
 * — для серии и для среднего), берём ПЕРВУЮ встречу сверху страницы.
 */
function pickNumberAfterLabel(
  items: TextItem[],
  label: string,
  opts: { intOnly?: boolean } = {},
): number | null {
  const candidates = items
    .filter((it) => it.str.trim() === label)
    .sort((a, b) => b.y - a.y);
  for (const lab of candidates) {
    const onRow = items
      .filter((it) => Math.abs(it.y - lab.y) < 1 && it.x > lab.x)
      .map((it) => it.str.trim())
      .filter(Boolean);
    for (const cell of onRow) {
      if (opts.intOnly) {
        if (/^\d+$/.test(cell)) return Number(cell);
      } else {
        const m = cell.match(/^\d+(?:[.,]\d+)?$/);
        if (m) return Number(cell.replace(',', '.'));
      }
    }
  }
  return null;
}

/**
 * Главная функция парсера. Принимает байты PDF (как из шелла) и возвращает
 * структурированный результат.
 */
export async function parseScattPdf(bytes: Uint8Array): Promise<ScattExportResult> {
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;

  let sessionMeta: ScattSessionMeta = {
    dateRaw: null,
    shooterName: null,
    totalScoreInt: null,
    totalScoreDecimal: null,
    declaredShotCount: null,
  };
  const shots: ScattShot[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: TextItem[] = tc.items
      .filter((it): it is PdfTextItem => 'str' in it)
      .map((it) => ({ str: it.str, x: it.transform[4]!, y: it.transform[5]! }));

    if (p === 1) {
      sessionMeta = extractSessionMeta(items);
    }

    const rows = groupByRow(items);
    for (const row of rows) {
      const shot = tryParseShotRow(row);
      if (shot) shots.push(shot);
    }
  }

  // Уникализируем выстрелы по номеру: на одной странице может быть только один
  // выстрел с номером N. Берём первое появление (страницы идут по порядку).
  const seen = new Set<number>();
  const unique = shots.filter((s) => {
    if (seen.has(s.number)) return false;
    seen.add(s.number);
    return true;
  });
  unique.sort((a, b) => a.number - b.number);

  return { session: sessionMeta, shots: unique };
}
