import { useState } from 'react';
import type { PickedFile, Shell } from '@shells/types';
import { CORE_VERSION } from '@core/index';

interface Props {
  shell: Shell;
}

export function App({ shell }: Props) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPick() {
    setError(null);
    try {
      const picked = await shell.pickFile();
      if (picked) setFile(picked);
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

        {file && (
          <p className="app__status">
            Получено <strong>{file.bytes.byteLength.toLocaleString('ru-RU')}</strong>&nbsp;байт
            из файла <code>{file.name}</code>
            {file.path && (
              <>
                {' '}
                (<code title={file.path}>{file.path}</code>)
              </>
            )}
            .
          </p>
        )}

        {error && <p className="app__error">Ошибка: {error}</p>}
      </section>
    </main>
  );
}
