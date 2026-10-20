---
name: axure-analyzer
description: 分析 Axure RP 导出的 HTML 原型，提取页面结构、面包屑、文本几何、sticky 需求说明和交互，生成模型可读、可检索的结构化页面基线。当任务涉及 Axure、published HTML prototype、data/document.js、files/*/data.js、原型需求说明、面包屑/UI 结构核对，或需要把当前实现与原型逐项对比时使用。
---

# Axure Analyzer

把 Axure RP 导出的 HTML 原型转成**模型可读、可检索的结构化页面基线**，而不是只看静态 HTML 文本。

## 何时使用

- 用户要求“按原型实现/重构某个页面”
- 需要核对面包屑、筛选区、表头、按钮、弹窗等 UI 结构
- 需要读取原型里的“需求说明”注释（sticky 便签）
- 需要把当前代码实现与原型做差距分析
- 任务提到 Axure、原型 HTML、`data/document.js`、`files/*/data.js`

## 输入

- Axure RP **本地发布的 HTML 导出目录**，必须包含：
  - `data/document.js`
  - `files/<页面名>/data.js`
  - `<页面名>.html`
- 不是 `.rp` 源文件；如果只有 `.rp`，改用 Axure 官方 MCP 或 zee-rp。

## 一键分析

在本 skill 目录下执行（安装位置以 skill 的 base directory 为准：项目级 `.opencode/skills`、全局 `~/.agents/skills`、`~/.config/opencode/skills` 或 `~/.claude/skills` 均可）：

```bash
node scripts/analyze.js \
  --input "D:/path/to/axure-export" \
  --output "analysis/axure" \
  --pages "PageA,PageB"
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--pages a,b` | 只分析指定页面；不传则分析全部根目录 HTML。`PageA`、`PageB` 是占位符，实际值是 `<页面名>.html` 去掉 `.html`。 |
| `--viewport 1920x1080` | 渲染视口，默认 1920×1080 |
| `--chrome <path>` | 指定 Chrome/Edge；也可用环境变量 `AXURE_CHROME_PATH` |
| `--skip-ingest` | 跳过 `data.js` 结构解析 |
| `--skip-render` | 跳过浏览器渲染 |
| `--skip-baseline` | 只生成中间产物 |

首次使用需要安装依赖：

```bash
npm install
```

依赖只有 `playwright-core`，使用系统已安装的 Chrome/Edge，不下载浏览器。

### 图片型原型 + OCR

如果页面 UI 是一张整图（基线里 `imageBased: true`），DOM 没有表头、字段、按钮文字。加上 `--ocr`：

```bash
node scripts/analyze.js \
  --input "D:/path/to/axure-export" \
  --output "analysis/axure" \
  --pages "PageName" \
  --ocr
```

默认使用本地 RapidOCR（离线），先安装 Python 依赖：

```bash
python -m pip install rapidocr_onnxruntime
```

也可以改用 `vision-tools` 的 `glance`：

```bash
node scripts/analyze.js ... --ocr --ocr-cmd "glance \"{image}\" --ocr"
```

或指定其他 OCR 命令（`{image}` 会替换为背景图绝对路径，`{output}` 会替换为 `ocr/<页面>.md`）：

```bash
node scripts/analyze.js ... --ocr --ocr-cmd "python long_screenshot_ocr.py \"{image}\" -o \"{output}\""
```

OCR 结果写入 `ocr/<页面>.md`，并自动合并进 `baseline/<页面>.md` 的 `## UI OCR` 小节。OCR 只用于补 UI 文字，不能替代 `需求说明` 里的业务规则。

## 输出

```text
analysis/axure/
├── extracted/                 # data.js 结构：站点地图、组件、交互
├── rendered/<页面>.json       # 渲染后的文本节点、bbox、分带、面包屑、注释
├── screenshots/<页面>.png     # 画布截图
├── ocr/<页面>.md              # 启用 --ocr 时生成
├── baseline/<页面>.md         # 给人和 LLM 看的页面基线
└── baseline/<页面>.json       # 机器可读基线
```

## 读取顺序（重要）

1. **先读 `baseline/<页面>.md`**：面包屑、页面区域、需求说明、交互都在这里。
2. **再看 `screenshots/<页面>.png`**：确认视觉层级，尤其是面包屑与黑色标题条。
3. **需要精确定位时读 `rendered/<页面>.json`**：每个文本节点都有 `bbox`、`parentId`、颜色、字号。
4. **需要交互细节时读 `extracted/pages/<页面>.json`**。

## 硬规则

1. **面包屑以 `baseline` 的 `面包屑` 为准**，不要从静态 HTML 文本猜。Axure 的部分文字由 JS 运行时注入，静态 HTML 会漏。
2. **sticky 注释是业务规则，不是界面文本**。`annotations` 中 `offCanvas: true` 的块（通常在画布右侧）不得写进 UI 结构。
3. **每条 UI 结论必须有证据**：Axure ID、bbox、或截图路径。无法确认的标“需业务确认”。
4. **不要因为入口不同改写层级**：侧栏入口和列表行入口必须使用同一套原型层级。
5. **不要用注释文字反推界面布局**；注释只用于校验字段、权限、状态流转、文案等业务规则。
6. **不要编造原型中没有的字段或按钮**；表格/列表字段如果 `data.js` 没有内联数据，必须在基线中标“需结合截图/业务材料确认”。
7. **如果基线标记 `imageBased: true`**，说明 UI 主体是一张整图（Axure 里常见）。不要根据少量 DOM 文本推断界面；用 `screenshots/<页面>.png` + OCR/视觉工具分析 UI，注释仍作为业务规则依据。

> 遇到面包屑、标题条、侧栏、注释块混淆时，先读 `references/pitfalls.md`。

## 实现差距分析

拿到基线后，按当前项目的实际目录对照实现，通常按以下顺序：

1. 路由/入口
2. 控制器/请求处理
3. 视图/模板
4. 样式
5. 权限/菜单

具体文件路径以当前项目为准，不要照搬示例路径。输出四类差距：

| 类型 | 含义 |
| --- | --- |
| `missing` | 原型有、实现没有 |
| `extra` | 实现有、原型没有 |
| `mismatch` | 两边都有但不一致（文案/顺序/层级/状态） |
| `uncertain` | 原型不清晰或需要业务确认 |

每条差距写：**原型证据（ID/bbox/注释编号）→ 当前实现位置（文件:行）→ 建议动作**。

## 已知边界

- 只支持 Axure HTML 导出，不直接读 `.rp`
- 需要系统安装 Chrome 或 Edge
- 动态面板/中继器只能提取 `data.js` 中已有的结构；没有内联数据的表格字段仍需结合截图确认
- sticky 注释的富文本会保留段落和列表层级；图片、表格型注释只保留文本
- 生成结果不修改原型目录，输入目录始终只读
