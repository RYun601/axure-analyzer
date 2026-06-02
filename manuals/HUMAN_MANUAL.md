# Axure Prototype Skill Pack

这个包用于把 Axure RP 发布成本地 HTML 的原型，交给 AI 助手识别、解析，并生成偏业务口径的需求文档初稿。

默认工作模式是 `static-prototype`。也就是说，它不把 Axure 里的 interactionMap 当作严格交互规范，而是把原型看作静态业务界面材料：页面结构、菜单层级、可见文案、输入框 placeholder、按钮文案、表格/列表区域、动态面板痕迹，都会被用来辅助生成需求初稿。

## 包内容

- `skills/axure-rp-html-ingest/SKILL.md`
  - 识别和解析 Axure RP HTML 导出包。
  - 产出 `extracted/axure_context.json`、站点地图和页面摘要。

- `skills/axure-requirements-doc-writer/SKILL.md`
  - 基于解析产物生成需求文档。
  - 默认使用 `static-prototype`，减少 `State1`、空 label、底层 action 名称等技术噪音。

- `scripts/axure/ingest_axure_html.js`
  - 解析 Axure HTML 导出包。

- `scripts/axure/make_axure_context_pack.js`
  - 生成页面/模块级上下文包。

- `scripts/axure/make_requirements_doc.js`
  - 生成 Markdown 需求文档。

- `install.ps1`
  - 安装 skills 到 `~/.claude/skills`，并把脚本复制到项目根目录的 `scripts/axure`。

- `verify.ps1`
  - 检查 Node、skill 可见性、项目脚本是否就位。

## 安装

在解压后的包目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProjectRoot "D:\YourProject"
```

如果只想安装全局 skills，不复制项目脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -SkipProjectScripts
```

安装后验证：

```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1 -ProjectRoot "D:\YourProject"
```

如果手头有 Axure HTML 导出包，也可以带样例路径做 dry-run：

```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1 `
  -ProjectRoot "D:\YourProject" `
  -SampleInput "D:\YourProject\inputs\html_export\某个原型"
```

## 推荐工作流

把 Axure RP 发布出来的本地 HTML 包放到项目目录，例如：

```text
D:\YourProject\inputs\html_export\项目名\
  index.html
  data\document.js
  files\<页面名>\data.js
```

然后让 AI 助手执行：

```text
请分析 inputs/html_export 下的 Axure RP HTML 原型，默认按 static-prototype 模式生成需求文档。
先解析原型，再输出 outputs/<项目名>_需求文档.md。
不要把 Axure 底层 action 名称当成正式需求；把它们作为弱交互线索。
```

也可以手工运行：

```powershell
node scripts/axure/ingest_axure_html.js --input "inputs/html_export\项目名"

node scripts/axure/make_requirements_doc.js `
  --input "inputs/html_export\项目名" `
  --context "extracted\axure_context.json" `
  --mode static-prototype
```

## 输出位置

- `extracted/axure_context.json`
  - 全量结构化解析产物。

- `extracted/axure_sitemap.md`
  - 站点地图。

- `extracted/pages/*.md`
  - 页面级摘要。

- `extracted/packs/*_context_pack.md`
  - 模块/任务级上下文包，给模型压缩上下文用。

- `outputs/*_需求文档.md`
  - 最终需求文档初稿。

## 注意事项

- 输入的 Axure HTML 导出包只读，不要在导出包内写文件。
- `static-prototype` 是默认模式，除非你明确要严格分析 Axure 交互。
- 对于真实工作中不规范的原型，不要期待工具还原 100% 交互语义。
- 表格字段、中继器数据如果 Axure 没有内联，脚本只能提示存在列表/表格区域。
- 大项目建议按模块生成 context pack，避免 AI 助手压缩上下文时丢掉关键页面。
