import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseScattPdf } from '../src/core/parser/scatt-pdf';

const FIXTURES_DIR = resolve(__dirname, '../storage');
const FIXTURE_10 = resolve(FIXTURES_DIR, 'scatt-test-10-units.pdf');
const FIXTURE_60 = resolve(FIXTURES_DIR, 'scatt-test-60-units.pdf');

// Тестовые PDF — собственность заказчика, в репозиторий не коммитятся
// (см. .gitignore: `storage/`). Если их нет — тесты пропускаются с пометкой,
// CI ничего не сломает. Для локального запуска нужны эти файлы.
const HAVE_FIXTURES = existsSync(FIXTURE_10) && existsSync(FIXTURE_60);
const maybe = HAVE_FIXTURES ? describe : describe.skip;

maybe('parseScattPdf — 10-shot fixture', () => {
  it('извлекает 10 выстрелов с ожидаемой структурой', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_10));
    const { session, shots } = await parseScattPdf(bytes);

    expect(shots).toHaveLength(10);

    // Эталонные значения из PDF: первая строка серии.
    expect(shots[0]).toMatchObject({
      number: 1,
      R: 9.5,
      T: 15.4,
      hold10: 0.23,
      hold10plus: 1.0,
      speedMmS: 18.6,
      speed250msMmS: 18.6,
      distanceStpMm: 0.8,
      direction: null,
    });

    // Последний.
    expect(shots[9]).toMatchObject({
      number: 10,
      R: 10.1,
      T: 3.1,
      hold10: 0.95,
      hold10plus: 0.95,
      speedMmS: 19.3,
      speed250msMmS: 20.1,
      distanceStpMm: 1.4,
    });

    // Метаданные сессии.
    expect(session.shooterName).toBe('саша');
    expect(session.dateRaw).toBe('04.04.2026 17:32');
    expect(session.declaredShotCount).toBe(10);
    expect(session.totalScoreInt).toBe(95);
    expect(session.totalScoreDecimal).toBe(100.1);
  });

  it('сумма R с десятыми долями совпадает с totalScoreDecimal в PDF', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_10));
    const { session, shots } = await parseScattPdf(bytes);
    const sumR = shots.reduce((acc, s) => acc + s.R, 0);
    expect(sumR).toBeCloseTo(session.totalScoreDecimal!, 1);
  });
});

maybe('parseScattPdf — 60-shot fixture', () => {
  it('склеивает таблицу из нескольких страниц и игнорирует подсуммы', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_60));
    const { shots } = await parseScattPdf(bytes);

    expect(shots).toHaveLength(60);

    // Номера выстрелов плотные, без пропусков.
    expect(shots.map((s) => s.number)).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 1),
    );

    // У всех R в осмысленном диапазоне.
    for (const s of shots) {
      expect(s.R).toBeGreaterThanOrEqual(0);
      expect(s.R).toBeLessThanOrEqual(11);
    }
  });
});

if (!HAVE_FIXTURES) {
  describe.skip('parseScattPdf — нет фиктур', () => {
    it('тестовые PDF отсутствуют, полные тесты пропущены', () => {});
  });
}
