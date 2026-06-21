/**
 * Платформонезависимое ядро: парсеры входных файлов, описательная статистика,
 * статкритерии (через Pyodide) и генератор экспертного заключения.
 */

export const CORE_VERSION = '0.2.0';

export {
  parseScattPdf,
  type ScattExportResult,
  type ScattShot,
  type ScattSessionMeta,
} from './parser/scatt-pdf';
