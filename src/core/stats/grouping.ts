/**
 * Способы разбить серию выстрелов на группы для дисперсионного анализа.
 * Каждая схема превращает массив выстрелов в массив групп с подписанными
 * выборками значений выбранной переменной.
 */

import type { ScattShot } from '../parser/scatt-pdf';

export type GroupingScheme = 'all' | 'halves' | 'thirds' | 'median-split';

export interface ShotVarGetter {
  (shot: ScattShot): number;
}

export interface Group {
  label: string;
  values: number[];
}

/**
 * Описание переменной, по которой делим серию (для схемы `median-split`).
 * Граничное значение медианы вычисляется внутри `getGroups` и подставляется
 * в подписи групп.
 */
export interface MedianSplitSpec {
  getter: ShotVarGetter;
  /** Человекочитаемое имя переменной деления, для подписи групп, например «R». */
  label: string;
  /** Единица измерения для подписи, без неё подпись короче. */
  unit?: string;
}

export const GROUPING_LABELS: Record<GroupingScheme, string> = {
  'all': 'Вся серия',
  'halves': 'По половинам',
  'thirds': 'По третям',
  'median-split': 'По медиане',
};

/**
 * Возвращает группы для заданной схемы. Пустые подгруппы пропускаются —
 * для критериев они не нужны.
 *
 * Для `median-split` требуется `splitBy`. Если в серии все значения по
 * splitBy одинаковые (медиана не делит) — возвращается одна группа.
 */
export function getGroups(
  shots: readonly ScattShot[],
  scheme: GroupingScheme,
  getValue: ShotVarGetter,
  splitBy?: MedianSplitSpec,
): Group[] {
  const n = shots.length;
  if (n === 0) return [];

  if (scheme === 'all') {
    return [{ label: 'Вся серия', values: shots.map(getValue) }];
  }

  if (scheme === 'halves') {
    const half = Math.floor(n / 2);
    return makeGroups(shots, getValue, [
      { label: 'Первая половина', from: 0, to: half },
      { label: 'Вторая половина', from: half, to: n },
    ]);
  }

  if (scheme === 'thirds') {
    const t1 = Math.floor(n / 3);
    const t2 = Math.floor((2 * n) / 3);
    return makeGroups(shots, getValue, [
      { label: 'Первая треть', from: 0, to: t1 },
      { label: 'Средняя треть', from: t1, to: t2 },
      { label: 'Последняя треть', from: t2, to: n },
    ]);
  }

  if (scheme === 'median-split') {
    if (!splitBy) return [];
    return medianSplit(shots, getValue, splitBy);
  }

  return [];
}

function medianSplit(
  shots: readonly ScattShot[],
  getValue: ShotVarGetter,
  spec: MedianSplitSpec,
): Group[] {
  const splitVals = shots.map(spec.getter);
  const sorted = [...splitVals].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[Math.floor(mid)]!;

  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < shots.length; i++) {
    if (splitVals[i]! > median) upper.push(getValue(shots[i]!));
    else lower.push(getValue(shots[i]!));
  }

  const unit = spec.unit ? ` ${spec.unit}` : '';
  const medianStr = formatNumber(median);
  return [
    { label: `${spec.label} > ${medianStr}${unit}`, values: upper },
    { label: `${spec.label} ≤ ${medianStr}${unit}`, values: lower },
  ].filter((g) => g.values.length > 0);
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return v.toFixed(digits).replace(/,?0+$/, '').replace(/\.$/, '') || '0';
}

interface RangeSpec {
  label: string;
  from: number;
  to: number;
}

function makeGroups(
  shots: readonly ScattShot[],
  getValue: ShotVarGetter,
  ranges: readonly RangeSpec[],
): Group[] {
  return ranges
    .map(({ label, from, to }) => ({
      label,
      values: shots.slice(from, to).map(getValue),
    }))
    .filter((g) => g.values.length > 0);
}
