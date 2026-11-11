# Ectropy

A desktop app for organizing files into folders. It previews suggested changes before moving or copying anything, and keeps a history log so you can undo moves anytime.

## Quick Start

```bash
npm install
npm start
```

## How It Works

1. Pick a folder to scan (and an optional destination folder).
2. Click **Scan & preview** to see where files will go.
3. Choose **Move** or **Copy** mode and select the files you want.
4. Click **Move files** (or **Copy files**).
5. If you need to revert any changes, open **Move history** to restore files to their previous location.

## Safety Checks

- Existing files are never overwritten.
- Development folders (e.g. `.git`, `node_modules`) are skipped automatically.

## Tests

```bash
npm test
```
