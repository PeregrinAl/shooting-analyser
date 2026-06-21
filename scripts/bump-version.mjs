#!/usr/bin/env node
/**
 * Синхронный bump версии по всем четырём файлам, где она зашита:
 *   - package.json
 *   - src-tauri/Cargo.toml      (только пакетная, не dep'ов)
 *   - src-tauri/tauri.conf.json
 *   - src/core/index.ts         (константа CORE_VERSION)
 *
 * Использование:
 *   npm run bump 0.4.0       — явная версия
 *   npm run bump patch       — 0.3.0 → 0.3.1
 *   npm run bump minor       — 0.3.0 → 0.4.0
 *   npm run bump major       — 0.3.0 → 1.0.0
 *
 * Только правит файлы в рабочем дереве, без git add/commit/tag — пользователь
 * сама смотрит diff и коммитит (см. CLAUDE.md, стиль коммитов).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?$/;

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf-8');
}
function write(path, content) {
  writeFileSync(resolve(ROOT, path), content);
}

function parseSemver(s) {
  const m = SEMVER_RE.exec(s);
  if (!m) throw new Error(`Невалидный semver: ${s}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function bumpKind(current, kind) {
  const v = parseSemver(current);
  if (kind === 'major') return `${v.major + 1}.0.0`;
  if (kind === 'minor') return `${v.major}.${v.minor + 1}.0`;
  if (kind === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`;
  throw new Error(`Неизвестный режим: ${kind}`);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Использование: npm run bump <patch|minor|major|X.Y.Z>');
  process.exit(1);
}

const pkg = JSON.parse(read('package.json'));
const current = pkg.version;
const next = ['patch', 'minor', 'major'].includes(arg)
  ? bumpKind(current, arg)
  : (parseSemver(arg), arg);

console.log(`${current} → ${next}`);

// 1. package.json — верхнеуровневое "version".
write(
  'package.json',
  read('package.json').replace(/("version":\s*)"[^"]+"/, `$1"${next}"`),
);

// 2. src-tauri/Cargo.toml — единственная строка `^version = "..."`
//    относится к [package]; зависимости пишутся как `tauri = { version = "..." }`,
//    под якорь `^` не подпадают.
write(
  'src-tauri/Cargo.toml',
  read('src-tauri/Cargo.toml').replace(
    /^(version\s*=\s*)"[^"]+"/m,
    `$1"${next}"`,
  ),
);

// 3. src-tauri/tauri.conf.json — верхнеуровневое "version".
write(
  'src-tauri/tauri.conf.json',
  read('src-tauri/tauri.conf.json').replace(
    /("version":\s*)"[^"]+"/,
    `$1"${next}"`,
  ),
);

// 4. src/core/index.ts — константа CORE_VERSION.
write(
  'src/core/index.ts',
  read('src/core/index.ts').replace(
    /(CORE_VERSION\s*=\s*)['"][^'"]+['"]/,
    `$1'${next}'`,
  ),
);

console.log('Обновлены:');
console.log('  package.json');
console.log('  src-tauri/Cargo.toml');
console.log('  src-tauri/tauri.conf.json');
console.log('  src/core/index.ts');
