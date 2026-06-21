import type { Shell } from './types';
import { webShell } from './web';
import { tauriShell } from './tauri';

/**
 * Распознаём окружение по наличию Tauri-инжекции. Делаем это один раз при
 * старте и больше не проверяем.
 */
export function pickShell(): Shell {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return isTauri ? tauriShell : webShell;
}
