/**
 * Платформонезависимый контракт «оболочки» — то, что фронт спрашивает у среды
 * (веб-страница или Tauri-окно). Каждый шелл реализует этот интерфейс по-своему,
 * а UI работает только с ним и не знает, где он запущен.
 */

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Полный путь — только в десктопной версии; в вебе null. */
  path: string | null;
}

export interface Shell {
  readonly kind: 'web' | 'tauri';
  pickFile(): Promise<PickedFile | null>;
}
