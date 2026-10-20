# Axure Analyzer

分析 Axure RP 导出的 HTML 原型，生成**可核对的页面基线**，供 AI 编码助手按原型实现或做实现差距分析。

> Fork 自 [NeroAyase/axure-prototype-skill-pack](https://github.com/NeroAyase/axure-prototype-skill-pack)（MIT）。
> 本 fork 保留其 Axure HTML 结构解析能力，并增加了真实浏览器渲染、文本几何、面包屑识别和 sticky 需求说明提取。

## 相对上游的改动

- 仓库/技能更名为 `axure-analyzer`
- 新增 `scripts/render_pages.js`：真实浏览器渲染，提取文本节点、bbox、纵向分带、面包屑
- 新增 `scripts/build_baseline.js`：合并结构解析与渲染结果，生成 `baseline/<页面>.md/json`
- 新增 `scripts/analyze.js`：一条命令跑完 ingest → render → baseline
- sticky 注释改为 DOM 级提取，保留 `<p>` / `<ul><li>` 层级，不再受 200 字符截断影响
- 侧栏文本自动排除，避免污染面包屑；H5 页面不会误判面包屑
- 新增图片型原型检测与 OCR（默认本地 RapidOCR，可替换为 `glance`）
- 改写 `install.ps1` 为 OpenCode 项目级安装与依赖安装

## 它解决什么问题

静态解析 Axure 导出的 HTML 不够：

- 部分文字（例如面包屑中间项“一级菜单 /”）是 JS 运行时注入的，静态 HTML 里没有。
- “需求说明”是画布外的 sticky 注释，正则会漏掉 `<ul><li>` 子项，长行还会被截断。
- 面包屑、黑色标题条、筛选行、表头在 HTML 里只是绝对定位的 `div`，没有语义。

Axure Analyzer 用真实浏览器渲染，再提取：

- 可见文本节点 + bbox + 颜色 + 字号
- 按 y 坐标分带：面包屑 / 标题条 / 筛选区 / 表头 / 行
- Axure 文本容器的段落与嵌套列表结构
- sticky 注释（“需求说明”）全文
- `data.js` 中的组件、动态面板、交互

## 前提

- Axure RP 已**发布到本地 HTML**，目录包含：
  - `data/document.js`
  - `files/<页面名>/data.js`
  - `<页面名>.html`
- Node.js >= 18
- 系统安装 Chrome 或 Edge（不下载 Playwright 自带浏览器）
- 不需要 `.rp` 源文件

## 安装

```bash
npm install
```

只安装 `playwright-core`，体积小；渲染时使用系统 Chrome/Edge。

如果 Chrome 不在默认路径，设置：

```powershell
$env:AXURE_CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

## 使用

```bash
node scripts/analyze.js \
  --input "D:/path/to/axure-export" \
  --output "analysis/axure" \
  --pages "PageA,PageB"
```

不传 `--pages` 时分析全部根目录 HTML 页面。

> 示例中的 `PageA`、`PageB`、`PageName` 都是占位符；实际值是 `<页面名>.html` 去掉 `.html` 后的页面名。

### 图片型原型 + OCR

有的 Axure 原型把 UI 做成一张整图（例如某个页面导出为 2000×3805 的 PNG），DOM 里只有注释。此时加 `--ocr`：

```bash
node scripts/analyze.js \
  --input "D:/path/to/axure-export" \
  --output "analysis/axure" \
  --pages "PageName" \
  --ocr
```

默认使用本地 RapidOCR（离线），先安装：

```bash
python -m pip install rapidocr_onnxruntime
```

也可改用 `vision-tools` 的 `glance` 或其他 OCR：

```bash
--ocr --ocr-cmd "glance \"{image}\" --ocr"
--ocr --ocr-cmd "python long_screenshot_ocr.py \"{image}\" -o \"{output}\""
```

OCR 结果写入 `ocr/<页面>.md`，并合并进 `baseline/<页面>.md` 的 `## UI OCR` 小节。OCR 只补 UI 文字，不替代 `需求说明` 的业务规则。

### 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--input` | 必填 | Axure HTML 导出目录 |
| `--output` | `analysis` | 输出目录 |
| `--pages a,b` | 全部 | 页面名（不带 `.html`） |
| `--viewport` | `1920x1080` | 渲染视口 |
| `--chrome` | 自动检测 | Chrome/Edge 路径 |
| `--timeout` | `30000` | 页面加载超时（ms） |
| `--skip-ingest` | 否 | 跳过 `data.js` 结构解析 |
| `--skip-render` | 否 | 跳过浏览器渲染 |
| `--skip-baseline` | 否 | 只生成中间产物 |

## 输出

```text
analysis/axure/
├── extracted/                 # data.js：站点地图、组件、交互
├── rendered/<页面>.json       # 渲染后的文本节点、bbox、分带、面包屑、注释
├── screenshots/<页面>.png     # 画布截图
├── ocr/<页面>.md              # 图片型原型的 OCR 结果
├── baseline/<页面>.md         # 页面基线（推荐先读）
└── baseline/<页面>.json       # 机器可读基线
```

`baseline/<页面>.md` 包含：

1. 页面信息与画布尺寸
2. 面包屑（文本 + Axure ID + bbox + 置信度）
3. 页面纵向分带（每行文本）
4. 需求说明（sticky 注释全文，含 `<li>` 子项和层级）
5. 交互（来自 `data.js`）
6. 使用提示

## 作为 Agent Skill 使用

项目级安装（OpenCode 会读取 `.opencode/skills`）：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -ProjectRoot "D:\path\to\project" `
  -InstallDeps
```

安装后目录：

```text
<project>/.opencode/skills/axure-analyzer/
├── SKILL.md
├── package.json
├── scripts/
└── references/
```

安装后，AI 在遇到 Axure / 原型分析任务时会加载 `SKILL.md`，并按其中的流程执行。若当前会话没有立即出现该 skill，重新打开会话即可。

## 已知边界

- 只支持 Axure HTML 导出，不直接读 `.rp`
- 需要系统 Chrome/Edge
- 动态面板/中继器只能提取 `data.js` 中已有的结构；没有内联数据的表格字段仍需结合截图确认
- sticky 注释保留段落和列表层级；图片、表格型注释只保留文本
- 输入目录始终只读

## 许可证

MIT。原项目版权归 NeroAyase；本 fork 的修改部分归本项目贡献者。
本项目与 Axure Software Solutions 无关联。
