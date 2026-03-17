# ChipForge

**ChipForge** is a desktop generator for custom Texas Hold'em poker chips designed for multi-color 3D printing.

**ChipForge** 是一个面向多色 3D 打印的德州扑克筹码桌面生成器。

It lets you customize chip text, size, colors, style, edge details, and font, then export ready-to-slice `3MF` and `STL` files.

你可以自定义筹码文字、尺寸、颜色、风格、边缘细节和字体，并导出可直接切片的 `3MF` / `STL` 文件。

## Why This Project

Most poker chip mockups look good on screen but are painful to turn into printable, slicer-friendly geometry.
ChipForge focuses on the practical side:

- Multi-part chip generation for multi-color printing
- `3MF` export tuned for Bambu Studio workflows
- Manifold-friendly geometry for text, rim rings, and classic edge markers
- Live 3D preview before export

很多筹码设计工具更偏向视觉效果，但不一定适合真正打印。
ChipForge 的重点是“能设计，也能真正打出来”：

- 面向多色打印的多部件筹码生成
- 针对 Bambu Studio 工作流优化的 `3MF` 导出
- 更适合切片器处理的流形几何
- 导出前可实时 3D 预览

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

## Chinese Introduction

ChipForge 是一个针对德州扑克筹码定制和 3D 打印导出的桌面工具。项目的目标不是只做一个“好看的建模演示”，而是尽量生成能被切片软件正确识别、正确分色、并可实际打印的模型文件。

当前项目支持：

- 经典 / 简约两种筹码风格
- 正面姓名、背面面值文字
- 主体、文字、边缘细节、边框环多部件配色
- 经典边缘圆柱嵌入式结构
- `3MF + STL` 导出
- 与 Bambu Studio 多色工作流兼容的导出策略

如果你想自己定制一批可打印的筹码，或者想研究多部件 3MF 导出与切片器兼容性，这个项目就是为这个场景写的。

## English Introduction

ChipForge is a desktop tool for designing and exporting custom poker chips for 3D printing.
It is built with practical manufacturing constraints in mind rather than just visual mockups.

The project aims to generate chip models that are:

- customizable
- previewable in real time
- slicer-friendly
- suitable for multi-color print workflows

If you want to produce printable personalized chips, or study how multi-part `3MF` export works in real slicer pipelines, this project is built for that use case.

## Open Source Release Notes

Before publishing the repository, you may still want to add:

- a `LICENSE` file
- screenshots or a demo GIF
- release binaries for macOS / Windows
- a short roadmap or issue labels

## Suggested Repository Name

- `chipforge`

Alternative names if you want a different tone:

- `chipsmith`
- `pokermint`
- `stackforge`

