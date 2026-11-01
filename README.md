# Vaultsweep

Desktop app that migrates passwords from iCloud Keychain, Chrome/Chromium browsers, and Firefox-family browsers into 1Password in one sitting. See [`vaultsweep.md`](vaultsweep.md) for the product spec.

Built with Tauri v2 (Rust backend) and React 19 + TypeScript (frontend).

## Running Vaultsweep

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS or newer)
- [pnpm](https://pnpm.io/installation)
- [Rust](https://www.rust-lang.org/tools/install) (stable, via `rustup`)
- Tauri system dependencies for your OS — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On macOS this is just the Xcode Command Line Tools (`xcode-select --install`).

Optional, for features not yet wired into the app:

- [Ollama](https://ollama.com/) running locally with the `gemma4:e4b` model (`ollama pull gemma4:e4b && ollama serve`)
- [1Password CLI](https://developer.1password.com/docs/cli/get-started/) (`op`), signed in

### Install and run

```bash
pnpm install
pnpm tauri dev      # launches the desktop app with hot reload
```

The first run compiles the Rust backend and takes a few minutes; later runs are fast.

### Build a release bundle

```bash
pnpm tauri build
```

The bundled app is written to `src-tauri/target/release/bundle/`.

### Tests

```bash
pnpm test                                          # frontend (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml    # backend (Rust)
```

### Debug window

Press **Cmd+Shift+D** in the running app to open a debug window showing the raw imported entries and merged accounts.

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
