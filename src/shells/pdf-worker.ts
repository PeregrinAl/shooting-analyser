/**
 * Браузерная инициализация воркера pdf.js.
 *
 * Без этого `parseScattPdf` падает с
 *   `No "GlobalWorkerOptions.workerSrc" specified`.
 *
 * Импортируется как side-effect только из browser-entry (`src/main.tsx`).
 * В Node (тесты) этот модуль не подгружается — там legacy-сборка работает
 * без отдельного воркера.
 */

import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Vite превратит `?url` в финальный путь к воркеру в dist/.
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerSrc;
