/**
 * Синглтон-загрузчик Pyodide. Тяжёлый runtime (~10 МБ) + numpy/scipy грузятся
 * по требованию один раз за сессию; повторные вызовы возвращают тот же промис.
 *
 * В v1 ассеты берём с jsdelivr — это код-зависимость уровня самого приложения,
 * данные стрелка через CDN не идут. В v2 для Tauri-сборки забандлим всё локально.
 *
 * Почему через CDN, а не через `import('pyodide')` из npm: бандлер не умеет
 * корректно резолвить пути к WASM/stdlib внутри pyodide.mjs, плюс пакет
 * импортирует node-only модули (node:vm, node:path) для своей CLI-обёртки.
 * Грузим скрипт `pyodide.mjs` прямо с CDN — там вся пирамида ассетов
 * согласована по версии. npm-пакет используем только ради TS-типов.
 */

import type { PyodideInterface } from 'pyodide';

/**
 * ВНИМАНИЕ: при обновлении npm-пакета `pyodide` строку синхронизировать вручную,
 * иначе ассеты на CDN не совпадут с типами и будут странные runtime-ошибки.
 */
const PYODIDE_VERSION = '0.27.7';
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodidePromise: Promise<PyodideInterface> | null = null;

/** Состояния, в которые умеет встать загрузчик; для индикатора в UI. */
export type PyodideLoadStatus =
  | 'idle'
  | 'loading-runtime'
  | 'loading-packages'
  | 'ready'
  | 'error';

export interface LoadOptions {
  /** Колбэк прогресса для UI. Безопасно вызывается несколько раз. */
  onStatus?: (status: PyodideLoadStatus) => void;
}

/**
 * Возвращает готовый к работе Pyodide. Грузит runtime и пакеты `numpy`,
 * `scipy` при первом обращении; последующие вызовы возвращают тот же экземпляр.
 */
export function getPyodide(options: LoadOptions = {}): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = init(options).catch((e) => {
      // Сбрасываем кэш, чтобы пользователь мог повторить попытку.
      pyodidePromise = null;
      options.onStatus?.('error');
      throw e;
    });
  }
  return pyodidePromise;
}

interface PyodideModule {
  loadPyodide: (options?: { indexURL?: string }) => Promise<PyodideInterface>;
}

async function init({ onStatus }: LoadOptions): Promise<PyodideInterface> {
  onStatus?.('loading-runtime');
  // `@vite-ignore` — иначе Vite попытается зарезолвить URL во время сборки.
  // Динамический import HTTPS-URL работает в браузере как ES-модуль.
  const mod = (await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)) as PyodideModule;
  const pyodide = await mod.loadPyodide({ indexURL: PYODIDE_CDN });

  onStatus?.('loading-packages');
  await pyodide.loadPackage(['numpy', 'scipy']);

  onStatus?.('ready');
  return pyodide;
}
