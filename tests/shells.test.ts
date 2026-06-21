import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pickShell } from '../src/shells/detect';

describe('pickShell', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as { window?: object }).window = {};
  });
  afterEach(() => {
    (globalThis as { window?: object }).window = originalWindow;
  });

  it('возвращает web-шелл, если нет инжекции Tauri', () => {
    expect(pickShell().kind).toBe('web');
  });

  it('возвращает tauri-шелл, если есть __TAURI_INTERNALS__', () => {
    (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(pickShell().kind).toBe('tauri');
  });
});
