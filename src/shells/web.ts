import type { PickedFile, Shell } from './types';

/**
 * Веб-реализация: через скрытый <input type="file">. Файл читается в браузере,
 * никуда не отправляется.
 */
export const webShell: Shell = {
  kind: 'web',
  async pickFile(): Promise<PickedFile | null> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.scatt-expert,.pdf,.html,.htm,.txt,.csv';

    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
    if (!file) return null;

    const buffer = await file.arrayBuffer();
    return { name: file.name, bytes: new Uint8Array(buffer), path: null };
  },
};
