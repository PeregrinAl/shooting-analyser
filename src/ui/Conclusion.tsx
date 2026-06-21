import { useEffect, useMemo, useState } from 'react';
import {
  correlations,
  explainResult,
  generateConclusion,
  type CorrelationMatrix,
  type ExplainabilityResult,
  type ReportSection,
  type ScattExportResult,
  type ScattShot,
} from '@core/index';

const PREDICTORS = [
  'T',
  'hold10',
  'hold10plus',
  'speedMmS',
  'speed250msMmS',
  'distanceStpMm',
] as const;

const ALL_VARS = ['R', ...PREDICTORS] as const;

type VarKey = (typeof ALL_VARS)[number];
type PredictorKey = (typeof PREDICTORS)[number];

function extractColumns(shots: readonly ScattShot[]): Record<VarKey, number[]> {
  const cols = {} as Record<VarKey, number[]>;
  for (const k of ALL_VARS) {
    cols[k] =
      k === 'hold10' || k === 'hold10plus'
        ? shots.map((s) => s[k] * 100)
        : shots.map((s) => s[k as keyof ScattShot] as number);
  }
  return cols;
}

export function Conclusion({
  shots,
  session,
}: {
  shots: readonly ScattShot[];
  session: ScattExportResult['session'];
}) {
  const [sections, setSections] = useState<ReportSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => extractColumns(shots), [shots]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSections(null);

    const predictors: Record<PredictorKey, number[]> = {} as Record<PredictorKey, number[]>;
    for (const k of PREDICTORS) predictors[k] = data[k];

    Promise.all([
      correlations(data),
      explainResult({ key: 'R', values: data.R }, predictors),
    ])
      .then(([corr, expl]: [CorrelationMatrix, ExplainabilityResult]) => {
        if (cancelled) return;
        setSections(
          generateConclusion({
            session,
            shots,
            correlations: corr,
            explainability: expl,
          }),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [data, shots, session]);

  if (error) return <p className="app__error">Ошибка заключения: {error}</p>;
  if (!sections)
    return <p className="app__status">Готовлю заключение по серии…</p>;

  return (
    <section className="conclusion">
      <h2 className="conclusion__title">Экспертное заключение</h2>
      {sections.map((s) => (
        <div key={s.title} className="conclusion__section">
          <h3 className="conclusion__heading">{s.title}</h3>
          {s.paragraphs.map((p, i) => (
            <p key={i} className="conclusion__p">
              {p}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}
