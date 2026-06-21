import { useState } from 'react';
import type { PickedFile, Shell } from '@shells/types';
import {
  CORE_VERSION,
  parseScattPdf,
  type ScattExportResult,
} from '@core/index';
import { Stats } from './Stats';
import { Correlations } from './Correlations';
import { ExplainResult } from './ExplainResult';
import { Conclusion } from './Conclusion';

interface Props {
  shell: Shell;
}

type ParseState =
  | { status: 'idle' }
  | { status: 'parsing' }
  | { status: 'done'; result: ScattExportResult }
  | { status: 'error'; message: string }
  | { status: 'unsupported'; extension: string };

function detectExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function App({ shell }: Props) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parse, setParse] = useState<ParseState>({ status: 'idle' });

  async function onPick() {
    setError(null);
    setParse({ status: 'idle' });
    try {
      const picked = await shell.pickFile();
      if (!picked) return;
      setFile(picked);

      const ext = detectExtension(picked.name);
      if (ext !== 'pdf') {
        setParse({ status: 'unsupported', extension: ext || '(без расширения)' });
        return;
      }
      setParse({ status: 'parsing' });
      try {
        const result = await parseScattPdf(picked.bytes);
        setParse({ status: 'done', result });
      } catch (e) {
        setParse({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="app">
      <header className="app__header">
        <h1>shooting-analyser</h1>
        <p className="app__subtitle">
          Дисперсионный анализ серий стрелковой подготовки.
          Среда:&nbsp;<code>{shell.kind}</code>, ядро&nbsp;<code>{CORE_VERSION}</code>.
        </p>
      </header>

      <section className="app__picker">
        <button type="button" onClick={onPick} className="app__button">
          Выбрать файл
        </button>

        {error && <p className="app__error">Ошибка: {error}</p>}

        {parse.status === 'parsing' && (
          <p className="app__status">Разбираю <code>{file?.name}</code>…</p>
        )}

        {parse.status === 'unsupported' && (
          <p className="app__status">
            Файл <code>{file?.name}</code>: расширение <code>.{parse.extension}</code>
            {' '}пока не поддерживается. На шаге 2 работаем только с PDF-отчётами SCATT.
          </p>
        )}

        {parse.status === 'error' && (
          <p className="app__error">
            Не удалось разобрать <code>{file?.name}</code>: {parse.message}
          </p>
        )}

        {parse.status === 'done' && (
          <>
            <ParseResult result={parse.result} />
            {parse.result.shots.length > 0 && (
              <>
                <Conclusion
                  shots={parse.result.shots}
                  session={parse.result.session}
                />
                <Correlations shots={parse.result.shots} />
                <ExplainResult shots={parse.result.shots} />
                <Stats shots={parse.result.shots} />
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function ParseResult({ result }: { result: ScattExportResult }) {
  const { session, shots } = result;
  return (
    <div className="parse-result">
      <h2 className="parse-result__title">Прочитано {shots.length}&nbsp;выстрел(ов)</h2>

      <dl className="parse-result__meta">
        {session.shooterName && (
          <>
            <dt>Стрелок</dt>
            <dd>{session.shooterName}</dd>
          </>
        )}
        {session.dateRaw && (
          <>
            <dt>Дата</dt>
            <dd>{session.dateRaw}</dd>
          </>
        )}
        {session.totalScoreInt != null && session.totalScoreDecimal != null && (
          <>
            <dt>Итог серии</dt>
            <dd>
              {session.totalScoreInt} / {session.totalScoreDecimal.toFixed(1)}
            </dd>
          </>
        )}
      </dl>

      <table className="parse-result__table">
        <thead>
          <tr>
            <th>№</th>
            <th>R</th>
            <th>T,&nbsp;с</th>
            <th>10</th>
            <th>10+</th>
            <th>v,&nbsp;мм/с</th>
            <th>v₂₅₀,&nbsp;мм/с</th>
            <th>СТП,&nbsp;мм</th>
          </tr>
        </thead>
        <tbody>
          {shots.map((s) => (
            <tr key={s.number}>
              <td>{s.number}</td>
              <td>{s.R.toFixed(1)}</td>
              <td>{s.T.toFixed(1)}</td>
              <td>{Math.round(s.hold10 * 100)}%</td>
              <td>{Math.round(s.hold10plus * 100)}%</td>
              <td>{s.speedMmS.toFixed(1)}</td>
              <td>{s.speed250msMmS.toFixed(1)}</td>
              <td>{s.distanceStpMm.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
