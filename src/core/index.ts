/**
 * Платформонезависимое ядро: парсеры входных файлов, описательная статистика,
 * статкритерии (через Pyodide) и генератор экспертного заключения.
 */

export const CORE_VERSION = '0.3.1';

export {
  parseScattPdf,
  type ScattExportResult,
  type ScattShot,
  type ScattSessionMeta,
} from './parser/scatt-pdf';

export {
  describe,
  type Descriptives,
} from './stats/describe';

export {
  type PyodideLoadStatus,
  type LoadOptions as PyodideLoadOptions,
} from './stats/runtime';
