# ChipForge

[中文说明](./README.zh-CN.md)

**ChipForge** is a desktop generator for custom Texas Hold'em poker chips designed for multi-color 3D printing.

It lets you customize chip text, size, colors, style, edge details, and font, then export ready-to-slice `3MF` and `STL` files.

## Why This Project

Most poker chip mockups look good on screen but are painful to turn into printable, slicer-friendly geometry.
ChipForge focuses on the practical side:

- Multi-part chip generation for multi-color printing
- `3MF` export tuned for Bambu Studio workflows
- Manifold-friendly geometry for text, rim rings, and classic edge markers
- Live 3D preview before export

## Features

- Two chip styles: `classic` and `minimal`
- Custom front name and back value text
- Adjustable diameter, thickness, text depth, rim width, groove count, and groove radius
- Classic edge cylinders embedded into the chip body
- Independent colors for body, front text, back text, grooves, and rim ring
- Custom font selection with a built-in Chinese font fallback
- Export options:
  - `chip.3mf` for multi-color workflows
  - per-part `STL` files
  - `combined.stl` for single-color printing
- Remembers the last export directory

## Tech Stack

- Electron
- React
- Vite
- Three.js / React Three Fiber
- `opentype.js` for text outlines
- `earcut` for polygon triangulation

## Getting Started

### Requirements

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Workflow

1. Edit chip text, style, colors, and geometry settings.
2. Preview the chip in the 3D viewport.
3. Choose an export mode.
4. Open the generated `3MF` in Bambu Studio, or use the exported `STL` files in another slicer.

## Export Notes

- `3MF` is the primary format for multi-color printing.
- The project separates chip parts into independent objects so slicers can assign colors more reliably.
- The classic edge details are modeled as embedded cylinders, not fake surface decoration.
- Export is available in the Electron desktop environment.

## Project Structure

```text
src/
  components/        UI panels and 3D preview
  utils/             preview geometry generation
electron/
  main.js            Electron main process
  preload.js         IPC bridge
  stl-generator.js   printable geometry + STL/3MF export
fonts/
  NotoSansSC-Regular.ttf
docs/
  bambu-studio-reference/
```

## Acknowledgements

This project was created entirely with the help of **Claude Code** and **Codex**.

Many thanks to both tools for helping generate, iterate on, and refine the code, geometry logic, export pipeline, and documentation for this project.

## License

This project is fully open source under the **MIT License**.

Copyright (c) 2026 Yong Tang

See [LICENSE](./LICENSE) for details.

## Suggested Repository Name

- `chipforge`

Alternative names if you want a different tone:

- `chipsmith`
- `pokermint`
- `stackforge`
