# shooting-analyser

> Локальный инструмент дисперсионного анализа серий стрелковой подготовки.
> Local desktop & web tool for variance analysis of shooting training sessions.

---

## Информация о проекте

Открытый бесплатный инструмент для статистического разбора результатов тренировочной
серии. Принимает экспорт из программы SCATT Expert (HTML/текст) или, на следующем
этапе, читает файл `.scatt-expert` напрямую. Считает описательную статистику,
проверяет предпосылки дисперсионного анализа (Шапиро-Уилк, Левен, Бартлетт),
применяет параметрические и непараметрические критерии (ANOVA с поправкой Уэлча,
Краскел-Уоллис, Манн-Уитни и др.), считает размеры эффекта, формирует письменное
экспертное заключение по детерминированному дереву решений.

Работает локально: данные стрелка не покидают компьютер. В составе инструмента нет
языковых моделей и машинного обучения.

### Состояние

Проект в стадии каркаса (шаг 1 из плана работ ТЗ). Сейчас умеет: открыть окно,
выбрать файл, показать его размер. Парсер, статистика, отчёт — следующие шаги.

### Сборка

Требуется Node.js 20+ и для десктопной версии — Rust toolchain (stable).
Пошаговая установка под macOS, Linux и Windows — в [SETUP.md](./SETUP.md).

```sh
npm install
npm run dev           # веб-версия, http://localhost:1420
npm run tauri:dev     # десктопная версия (Tauri 2)
npm test              # юнит-тесты ядра
npm run build         # статическая веб-сборка в dist/
npm run tauri:build   # установщики под текущую ОС
```

Перед первой десктопной сборкой положите иконки в `src-tauri/icons/`
(`npm run tauri icon path/to/source.png` сгенерирует все нужные размеры).

### Лицензия

MIT — см. [LICENSE](./LICENSE).

---

## About

Free, open-source tool for statistical analysis of shooting-training session
results. Reads exported tables from SCATT Expert (HTML/text), and (next phase)
parses the `.scatt-expert` SQLite file directly. Computes descriptive statistics,
checks ANOVA assumptions (Shapiro-Wilk, Levene, Bartlett), runs parametric and
non-parametric tests (Welch ANOVA, Kruskal-Wallis, Mann-Whitney, etc.), reports
effect sizes, and produces a written expert summary via a deterministic decision
tree.

Runs entirely locally — no data leaves the machine, no LLMs, no machine learning.
Computations go through Pyodide (`scipy`, `numpy`, `statsmodels`) to stay
identical with the canonical reference implementations.

### Status

Scaffold stage (step 1 of the work plan). Currently it can open the window,
pick a file, and display its size. Parser, statistics and report are next.

### Build

Requires Node.js 20+ and (for the desktop build) the stable Rust toolchain.
Per-OS install steps for macOS, Linux and Windows live in [SETUP.md](./SETUP.md).

```sh
npm install
npm run dev           # web build, http://localhost:1420
npm run tauri:dev     # desktop (Tauri 2)
npm test              # core unit tests
npm run build         # static web bundle into dist/
npm run tauri:build   # installer for the current OS
```

Drop icons into `src-tauri/icons/` before the first desktop release
(`npm run tauri icon path/to/source.png` generates all required sizes).

### License

MIT — see [LICENSE](./LICENSE).
