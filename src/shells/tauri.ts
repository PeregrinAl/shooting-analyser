import type { PickedFile, Shell } from './types';

/**
 * Tauri-реализация: открытие через нативный диалог и чтение через plugin-fs.
 * Модули @tauri-apps/plugin-* тянутся динамически, чтобы веб-бандл не тащил
 * лишний код.
 */
export const tauriShell: Shell = {
  kind: 'tauri',
  async pickFile(): Promise<PickedFile | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');

    const selected = await open({
      multiple: false,
      filters: [
        { name: 'SCATT Expert', extensions: ['scatt-expert'] },
        { name: 'Экспорт SCATT (HTML/текст)', extensions: ['html', 'htm', 'txt', 'csv'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (typeof selected !== 'string') return null;

    const bytes = await readFile(selected);
    const name = selected.split(/[\\/]/).pop() ?? selected;
    return { name, bytes, path: selected };
  },
};
