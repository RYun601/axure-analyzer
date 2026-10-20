# Axure Analyzer

Axure Analyzer 将 Axure RP 导出的 HTML 原型转换为可核对的页面基线，覆盖页面结构、面包屑、文本几何、sticky 需求说明、图片型原型 OCR 和交互信息。它面向需要按原型实现或进行实现差距分析的 AI 编码助手。

本项目 fork 自 [NeroAyase/axure-prototype-skill-pack](https://github.com/NeroAyase/axure-prototype-skill-pack)（MIT），保留其 Axure HTML 结构解析能力，并补充真实浏览器渲染、几何分组和注释提取。

## 环境要求

需要 Node.js 18 或更高版本，以及系统已安装的 Chrome 或 Edge。Node 依赖只有 `playwright-core`，不会下载额外浏览器。

图片型原型的 OCR 为可选能力，需要 Python 及 `rapidocr_onnxruntime`；不启用 OCR 时无需安装。

## 安装

### 一键安装（发给 AI 助手）

把下面这段发给支持终端操作的 AI 助手：

> 请把 `https://github.com/RYun601/axure-analyzer.git` 克隆到临时目录，进入仓库后按当前操作系统全局安装到 `~/.agents/skills`：
>
> - Windows：`powershell -ExecutionPolicy Bypass -File .\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps`
> - macOS：`bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps`
>
> 安装后运行 `node "$HOME/.agents/skills/axure-analyzer/scripts/render_pages.js" --input "<原型目录>" --output "<临时目录>" --pages "<页面名>" --no-screenshot` 验证；如果用户没有提供原型目录，只确认 `SKILL.md` 和依赖安装成功。使用 Claude Code 时，再创建 `~/.claude/skills/axure-analyzer` 指向 `~/.agents/skills/axure-analyzer` 的链接（Windows 用 junction，macOS 用 symlink）。完成后删除临时目录。

### 全局安装

推荐安装到跨 agent 的 `~/.agents/skills`。

Windows：

```powershell
git clone https://github.com/RYun601/axure-analyzer.git
cd axure-analyzer

powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -SkillsRoot "$HOME\.agents\skills" `
  -InstallDeps
```

macOS：

```bash
git clone https://github.com/RYun601/axure-analyzer.git
cd axure-analyzer

bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps
```

安装后，OpenCode、Codex、Cursor、Gemini CLI 会从 `~/.agents/skills` 发现该 skill。Claude Code 默认读取 `~/.claude/skills`，接入方式见 [docs/INSTALL.md](docs/INSTALL.md)。

> 安装脚本会清理 `node_modules` 中依赖自带的 `SKILL.md`（如 `playwright-core` 的 `lib/tools/skills`），避免被 OpenCode 识别成额外技能。同一个 skill 只需安装一份；多端共用时建议用 junction/symlink 指向主副本，不要复制出多份。

### 项目安装

如果希望 skill 只对当前项目生效：

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -ProjectRoot "D:\path\to\project" `
  -InstallDeps
```

macOS：

```bash
bash ./install.sh --project-root "/path/to/project" --install-deps
```

安装目录为 `<project>/.opencode/skills/axure-analyzer`。`-InstallDeps` / `--install-deps` 会在目标目录执行 `npm install`。

其他 agent 的 skills 目录差异见 [docs/INSTALL.md](docs/INSTALL.md)。

## 使用

在 skill 目录下执行：

```bash
node scripts/analyze.js \
  --input "D:/path/to/axure-export" \
  --output "analysis/axure" \
  --pages "PageA,PageB"
```

`--pages` 接受 HTML 文件名去掉 `.html` 后的页面名；省略时分析全部根目录页面。

图片型原型启用 OCR：

```bash
python -m pip install rapidocr_onnxruntime

node scripts/analyze.js \
  --input "D:/path/to/axure-export" \
  --output "analysis/axure" \
  --pages "PageName" \
  --ocr
```

OCR 默认使用本地 RapidOCR，也可通过 `--ocr-cmd` 替换为其他命令。分析结果写入 `--output`：

```text
analysis/axure/
├── extracted/                 # data.js 结构：站点地图、组件、交互
├── rendered/<页面>.json       # 渲染后的文本节点、bbox、分带、面包屑、注释
├── screenshots/<页面>.png     # 页面截图
├── ocr/<页面>.md              # 图片型原型的 OCR 结果
├── baseline/<页面>.md         # 页面基线，推荐首先阅读
└── baseline/<页面>.json       # 机器可读基线
```

`baseline/<页面>.md` 是主要入口，面包屑、页面区域、需求说明和交互都汇总在这里。需要精确定位元素时再读 `rendered/<页面>.json`，需要确认视觉层级时查看截图。

## 工作方式

分析分为三层。首先解析 `data.js`，获取站点地图、组件树、动态面板和交互；随后用真实浏览器渲染页面，提取文本节点、bbox、颜色、字号，并按纵向位置还原面包屑、标题条、筛选区和表头；最后从 DOM 中提取 sticky 注释，保留段落和嵌套列表结构。

对于 UI 主体是整张图片的 Axure 页面，DOM 中几乎没有可提取的界面文本。此时分析结果会标记 `imageBased: true`，并通过 `--ocr` 调用本地 RapidOCR 补充表头、字段和按钮文字。OCR 结果只用于补全 UI 文本，业务规则仍以 sticky 注释为准。

## 边界

只支持 Axure RP 的 HTML 导出，不直接读取 `.rp` 文件。动态面板和中继器只能提取当前渲染状态；没有内联数据的表格字段需要结合截图或业务材料确认。OCR 结果为近似识别，关键数字和低置信度文本应人工核对。输入目录始终只读。

## 许可证

MIT。原项目版权归 NeroAyase，本 fork 的修改部分归本项目贡献者。本项目与 Axure Software Solutions 无关联。
