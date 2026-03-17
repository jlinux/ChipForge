# ChipForge

[English README](./README.md)

**ChipForge** 是一个面向多色 3D 打印的德州扑克筹码桌面生成器。

你可以自定义筹码文字、尺寸、颜色、风格、边缘细节和字体，并导出可直接切片的 `3MF` / `STL` 文件。

## 项目定位

很多筹码设计工具更偏向视觉效果，但不一定适合真正打印。
ChipForge 的重点是“能设计，也能真正打出来”：

- 面向多色打印的多部件筹码生成
- 针对 Bambu Studio 工作流优化的 `3MF` 导出
- 更适合切片器处理的流形几何
- 导出前可实时 3D 预览

## 功能特性

- 两种筹码风格：`classic` 和 `minimal`
- 支持自定义正面姓名和背面面值文字
- 可调参数：直径、厚度、文字深度、边框环宽度、边缘数量、边缘半径
- 经典样式支持嵌入主体的圆柱边缘结构
- 主体、正面文字、背面文字、边缘、边框环可独立配色
- 支持自定义字体，并内置中文字体兜底
- 支持导出：
  - 面向多色打印的 `chip.3mf`
  - 分部件 `STL`
  - 面向单色打印的 `combined.stl`
- 自动记住上次导出目录

## 技术栈

- Electron
- React
- Vite
- Three.js / React Three Fiber
- `opentype.js`
- `earcut`

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装依赖

```bash
npm install
```

### 开发模式启动

```bash
npm run dev
```

### 构建

```bash
npm run build
```

## 使用流程

1. 设置筹码文字、风格、颜色和几何参数。
2. 在 3D 视图中预览效果。
3. 选择导出模式。
4. 将生成的 `3MF` 导入 Bambu Studio，或在其他切片软件中使用导出的 `STL`。

## 导出说明

- `3MF` 是多色打印的主格式。
- 项目会把筹码拆分成独立部件，方便切片器更稳定地识别颜色和部件关系。
- 经典边缘细节不是贴图或假装饰，而是真实建模的嵌入式圆柱结构。
- 导出功能仅在 Electron 桌面环境中可用。

## 项目结构

```text
src/
  components/        界面和 3D 预览
  utils/             预览几何生成
electron/
  main.js            Electron 主进程
  preload.js         IPC 桥接
  stl-generator.js   可打印几何和 STL/3MF 导出
fonts/
  NotoSansSC-Regular.ttf
docs/
  bambu-studio-reference/
```

## 致谢

这个项目完全是在 **Claude Code** 和 **Codex** 的帮助下生成和迭代完成的。

感谢这两个工具在代码生成、几何建模逻辑、导出流程和文档整理方面提供的支持。

## 开源协议

本项目采用 **MIT License**，完全开源。

版权所有 (c) 2026 Yong Tang

详细内容见 [LICENSE](./LICENSE)。

## 仓库名建议

- `chipforge`

如果你想要不同风格，也可以考虑：

- `chipsmith`
- `pokermint`
- `stackforge`

