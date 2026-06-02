# Axure 原型解析 Skill Pack

把 Axure RP **本地发布为 HTML** 的原型，交给 AI 助手解析、提取结构，并生成偏业务口径的需求文档初稿。

> **前提**：你的 Axure RP 文件必须先在 Axure 里「发布到本地」，生成包含 `data/document.js`、`files/*/data.js`、页面 HTML 的导出目录。本工具**不能直接读取 `.rp` / `.rplib` 源文件**。

---

## 一键安装（发给 AI 助手）

把下面这条命令直接发给 Claude Code / CodeFree 等 AI 助手，它会自动完成安装：

```
请帮我安装 Axure 原型解析 skill pack：1) 克隆 https://github.com/<your-org>/axure-prototype-skill-pack 到临时目录；2) 把 skills/axure-rp-html-ingest/SKILL.md 和 skills/axure-requirements-doc-writer/SKILL.md 复制到 ~/.claude/skills/ 下对应目录；3) 把 scripts/axure/ 下的三个 .js 文件复制到当前项目的 scripts/axure/ 目录；4) 删除临时克隆目录；5) 运行 node scripts/axure/ingest_axure_html.js 验证脚本能正常执行。安装完成后告诉我。
```

> **手动安装**：也可以直接运行 `powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProjectRoot "D:\YourProject"`

---

## 它能做什么

1. **解析** Axure RP HTML 导出包 → 结构化 JSON + Markdown（站点地图、页面组件、交互、动态面板、中继器、文本提示）
2. **生成** 模块级上下文包，供 LLM 压缩上下文使用
3. **产出** 面向业务的需求文档初稿（PRD、功能说明、测试用例等）

默认使用 `static-prototype` 模式——把 Axure 原型当作**静态业务界面材料**，而不是正式交互规范。这符合大多数真实 Axure 原型的使用方式。

---

## 前提与约束

| 约束 | 说明 |
|------|------|
| **必须本地发布为 HTML** | Axure RP 里「发布 → 本地」，生成 `index.html` + `data/document.js` + `files/*/data.js`。不支持 `.rp` 源文件 |
| **输入目录只读** | 绝不修改原始 Axure 导出包 |
| **纯本地处理** | 所有解析在本地完成，无网络请求 |
| **Node.js >= 16** | 零外部依赖，只用 Node.js 内置模块 |
| **中文路径支持** | 文件操作兼容中文目录名和文件名 |
| **不保证 100% 语义还原** | 真实 Axure 原型大多不规范，工具只做尽力提取，不确定内容标记为"需业务确认" |
| **表格/中继器字段** | 如果 Axure 没有内联数据，脚本只能提示"存在列表/表格区域"，字段需人工补充 |
| **输出 Markdown** | 最终文档为 Markdown 格式，不生成 Word/PDF |

---

## 使用方式

### 方式一：直接告诉 AI 助手

把 Axure HTML 导出包放到项目目录下，然后对 AI 助手说：

```
请分析 inputs/html_export 下的 Axure RP HTML 原型，默认按 static-prototype 模式生成需求文档。
先解析原型，再输出 outputs/<项目名>_需求文档.md。
不要把 Axure 底层 action 名称当成正式需求；把它们作为弱交互线索。
```

### 方式二：手动运行脚本

```powershell
# 第一步：解析 Axure 导出包
node scripts/axure/ingest_axure_html.js --input "path/to/html_export"

# 第二步：生成需求文档
node scripts/axure/make_requirements_doc.js `
  --input "path/to/html_export" `
  --context "extracted/axure_context.json" `
  --mode static-prototype

# 可选：生成模块上下文包
node scripts/axure/make_axure_context_pack.js `
  --context "extracted/axure_context.json" `
  --pages "页面1,页面2" `
  --task "任务描述" `
  --output "extracted/packs/module_context_pack.md"
```

---

## 两种模式

| 模式 | 说明 |
|------|------|
| `static-prototype`（默认） | 把 Axure 当静态业务界面材料。抑制技术噪音（空 label、State1、底层 action 名称），产出业务导向的需求初稿 |
| `strict` | 把 Axure 当正式交互规范。完整提取所有交互规则、组件详情、确认项 |

**建议**：除非你明确知道设计人员规范使用了 Axure 交互功能，否则用默认的 `static-prototype` 就对了。

---

## 输出结构

```
extracted/
├── axure_context.json          # 全量结构化解析产物
├── axure_sitemap.md            # 站点地图
├── pages/
│   ├── <页面名>.json           # 页面级详细 JSON
│   └── <页面名>.md             # 页面级 Markdown 摘要
└── packs/
    └── <模块名>_context_pack.md # 模块级上下文包

outputs/
└── <项目名>_<文档类型>.md      # 最终需求文档
```

---

## 包含的 Skills

### axure-rp-html-ingest

解析 Axure RP HTML 导出包，产出 `axure_context.json`、站点地图、页面摘要。

**触发词**：Axure、RP、published HTML prototype、html_export、data/document.js、原型结构提取

### axure-requirements-doc-writer

基于解析产物生成需求文档（PRD、功能说明、测试用例等）。依赖 `axure-rp-html-ingest` 的输出。

**触发词**：PRD、需求文档、模块需求、功能说明、页面规格、测试用例、交接文档

---

## 项目结构

```
axure-prototype-skill-pack/
├── config/
│   └── global-prototype-analysis.jsonc   # 可选的分类路由配置
├── manuals/
│   ├── HUMAN_MANUAL.md                   # 人类使用手册
│   └── MODEL_MANUAL.md                   # AI 模型行为指南
├── scripts/axure/
│   ├── ingest_axure_html.js              # 核心 Axure HTML 解析器
│   ├── make_axure_context_pack.js        # 上下文包生成器
│   └── make_requirements_doc.js          # 需求文档生成器
├── skills/
│   ├── axure-rp-html-ingest/SKILL.md     # Claude Code skill 定义
│   └── axure-requirements-doc-writer/SKILL.md
├── install.ps1                           # 安装脚本
├── verify.ps1                            # 验证脚本
├── manifest.json                         # 包元数据
└── README.md
```

---

## 兼容性

适用于 Claude Code、CodeFree 及任何支持 Claude Code skill 格式（`~/.claude/skills/` 下放 `SKILL.md`）的 AI 助手。

## 许可证

MIT
