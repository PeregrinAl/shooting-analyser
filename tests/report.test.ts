import { describe, it, expect } from 'vitest';
import { generateConclusion } from '../src/core/report/generate';
import type {
  CorrelationMatrix,
  ExplainabilityResult,
  ScattExportResult,
  ScattShot,
} from '../src/core/index';

function makeShot(num: number, R: number, T = 15, hold10 = 0.5): ScattShot {
  return {
    number: num,
    R,
    T,
    hold10,
    hold10plus: 0.95,
    speedMmS: 20,
    speed250msMmS: 20,
    distanceStpMm: 1,
    direction: null,
  };
}

function makeSession(): ScattExportResult['session'] {
  return {
    shooterName: 'тест',
    dateRaw: '01.01.2026 12:00',
    declaredShotCount: 10,
    totalScoreInt: 95,
    totalScoreDecimal: 100.1,
  };
}

function makeEmptyCorrelations(): CorrelationMatrix {
  return {
    variables: ['R', 'T', 'hold10', 'hold10plus', 'speedMmS', 'speed250msMmS', 'distanceStpMm'],
    cells: [],
    alpha: 0.05,
  };
}

function makeMinimalExplain(): ExplainabilityResult {
  return {
    alpha: 0.05,
    singleVariable: [],
    multiple: {
      r2: NaN,
      adjR2: NaN,
      fStatistic: NaN,
      fPValue: NaN,
      n: 10,
      predictors: 6,
      dfResidual: 3,
      coefficients: [],
      intercept: NaN,
    },
  };
}

describe('generateConclusion', () => {
  it('собирает базовый набор секций при пустых результатах', () => {
    const sections = generateConclusion({
      session: makeSession(),
      shots: Array.from({ length: 10 }, (_, i) => makeShot(i + 1, 9 + i / 10)),
      correlations: makeEmptyCorrelations(),
      explainability: makeMinimalExplain(),
    });
    const titles = sections.map((s) => s.title);
    expect(titles).toContain('Сводка сессии');
    expect(titles).toContain('Связи между параметрами');
    expect(titles).toContain('Объяснимость результата');
    expect(titles).toContain('Оговорки');
  });

  it('секция корреляций пишет «значимых не выявлено» когда пусто', () => {
    const sections = generateConclusion({
      session: makeSession(),
      shots: Array.from({ length: 10 }, (_, i) => makeShot(i + 1, 9.5)),
      correlations: makeEmptyCorrelations(),
      explainability: makeMinimalExplain(),
    });
    const corr = sections.find((s) => s.title === 'Связи между параметрами')!;
    expect(corr.paragraphs.join(' ')).toContain('Значимых корреляций');
  });

  it('описывает значимую корреляцию по содержанию', () => {
    const matrix: CorrelationMatrix = {
      variables: ['R', 'T'],
      cells: [
        {
          varA: 'R',
          varB: 'T',
          method: 'pearson',
          r: -0.42,
          pRaw: 0.001,
          pAdjusted: 0.02,
          n: 60,
          significant: true,
        },
      ],
      alpha: 0.05,
    };
    const sections = generateConclusion({
      session: makeSession(),
      shots: Array.from({ length: 60 }, (_, i) => makeShot(i + 1, 9.5)),
      correlations: matrix,
      explainability: makeMinimalExplain(),
    });
    const text = sections
      .find((s) => s.title === 'Связи между параметрами')!
      .paragraphs.join(' ');
    expect(text).toMatch(/Пирсон/);
    expect(text).toMatch(/r = -0\.42/);
    expect(text).toMatch(/p = 0\.020/);
  });

  it('при значимой множественной модели даёт цифру совокупной объяснимости', () => {
    const sections = generateConclusion({
      session: makeSession(),
      shots: Array.from({ length: 60 }, (_, i) => makeShot(i + 1, 9.5)),
      correlations: makeEmptyCorrelations(),
      explainability: {
        alpha: 0.05,
        singleVariable: [],
        multiple: {
          r2: 0.55,
          adjR2: 0.48,
          fStatistic: 9.7,
          fPValue: 0.001,
          n: 60,
          predictors: 6,
          dfResidual: 53,
          coefficients: [],
          intercept: 0,
        },
      },
    });
    const expl = sections
      .find((s) => s.title === 'Объяснимость результата')!
      .paragraphs.join(' ');
    expect(expl).toMatch(/55\.0\s?%/);
    expect(expl).toMatch(/48\.0\s?%/);
    expect(expl).toMatch(/F = 9\.70/);
    expect(expl).toMatch(/модель в целом значима/);
  });

  it('оговорка про малую серию появляется при n < 30', () => {
    const sections = generateConclusion({
      session: makeSession(),
      shots: Array.from({ length: 10 }, (_, i) => makeShot(i + 1, 9.5)),
      correlations: makeEmptyCorrelations(),
      explainability: makeMinimalExplain(),
    });
    const caveats = sections.find((s) => s.title === 'Оговорки')!;
    expect(caveats.paragraphs.join(' ')).toMatch(/пилотный объём/);
  });
});
