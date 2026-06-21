# Установка окружения / Environment setup

Здесь — пошагово, как поставить всё нужное для разработки и сборки проекта на
трёх ОС. Конечному пользователю готовых установщиков (`.dmg`, `.msi`,
`.AppImage`, `.deb`) ничего из этого не нужно: установщики самодостаточны.
Этот файл — для разработчиков и контрибьюторов.

Базовые требования у всех платформ одинаковые:

- **Node.js** 20 LTS или новее (нужен `npm`).
- **Rust** stable toolchain (для десктопной сборки через Tauri 2).
- **Системный WebView**: Tauri рисует UI в нативном WebView, который у каждой
  ОС свой (WebKit на macOS, WebView2 на Windows, WebKitGTK на Linux).

После установки тулчейна — общий шаг для всех ОС:

```sh
npm install
npm run dev          # веб-версия — http://localhost:1420
npm run tauri:dev    # десктопная версия
npm test             # юнит-тесты
```

---

## macOS

Минимум: macOS 10.15+. Архитектура — Intel или Apple Silicon, обе поддерживаются.

```sh
# 1. Xcode Command Line Tools (компилятор и системные либы).
xcode-select --install   # если уже стоит — команда сообщит об этом

# 2. Node.js — через Homebrew (https://brew.sh).
brew install node

# 3. Rust — через официальный rustup.
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"
```

WebKit (системный WebView) на macOS уже есть, отдельно ставить ничего не нужно.

---

## Linux (Ubuntu / Debian)

Под Tauri нужен `webkit2gtk-4.1` и сопутствующие либы.

```sh
# 1. Базовые либы и WebKitGTK.
sudo apt update
sudo apt install -y \
  build-essential curl wget file pkg-config \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libssl-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev

# 2. Node.js 20 LTS — через NodeSource.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Rust — через rustup.
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"
```

### Fedora / RHEL

```sh
sudo dnf install -y \
  webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel "@development-tools"
sudo dnf install -y nodejs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"
```

### Arch

```sh
sudo pacman -Syu --needed \
  webkit2gtk-4.1 base-devel openssl appmenu-gtk-module \
  libappindicator-gtk3 librsvg nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"
```

---

## Windows

Минимум: Windows 10 1809+ или Windows 11. На Win 11 WebView2 уже встроен.

PowerShell (от имени администратора, чтобы `winget` мог ставить системные
пакеты):

```powershell
# 1. Microsoft C++ Build Tools (компилятор для Rust).
winget install --id Microsoft.VisualStudio.2022.BuildTools `
  --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools `
              --includeRecommended"

# 2. Node.js LTS.
winget install --id OpenJS.NodeJS.LTS

# 3. Rust.
winget install --id Rustlang.Rustup
rustup default stable

# 4. WebView2 Runtime — на Win 10 поставить вручную, на Win 11 уже есть.
winget install --id Microsoft.EdgeWebView2Runtime
```

После установки откройте новое окно PowerShell, чтобы подхватился обновлённый
PATH.

---

## Verification

```sh
node --version    # v20.x или новее
npm --version
rustc --version   # stable
cargo --version
```

Если все четыре команды отвечают версиями — можно ставить зависимости проекта
(`npm install`) и запускать `npm run tauri:dev`.

---

## Troubleshooting

- **`tauri:dev` падает на macOS с ошибкой `xcrun`**: запустите
  `xcode-select --install` ещё раз; иногда установка CLT слетает после
  обновления macOS.
- **На Linux окно открывается, но содержимое пустое**: проверьте, что
  установлен `libwebkit2gtk-4.1-dev` именно версии 4.1 (старая 4.0 не подходит
  для Tauri 2).
- **На Windows `cargo build` пишет про отсутствие линкера**: не установлены
  MSVC Build Tools, поставьте их шагом 1 и перезапустите PowerShell.
- **`npm install` падает на этапе сборки нативного модуля**: убедитесь, что
  Node.js 20+ — у LTS-сборок нативные зависимости подбираются автоматически.
