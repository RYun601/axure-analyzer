---
name: axure-requirements-doc-writer
description: MUST USE for turning a published HTML prototype or Axure/RP export into a PRD, requirements draft, module requirements, functional specs, page specifications, test cases, or handoff document. Depends on axure-rp-html-ingest for parsed context. Default mode is static-prototype, treating the prototype as static business interface material rather than formal interaction specs.
---

# axure-requirements-doc-writer

Convert Axure RP HTML prototypes into structured requirements documents. This Skill does NOT read raw `data.js` files directly — it relies on the parsed artifacts produced by `axure-rp-html-ingest` (i.e., `axure_context.json` and context packs).

**核心原则**：实际工作中的 Axure RP 原型大多是"静态原型"或"看起来是那么回事"的页面稿。设计人员并不会规范使用 Axure 的 interactionMap、动态面板命名、表格字段、按钮 label。因此默认使用 `static-prototype` 模式，把 Axure 当作静态业务界面材料，而不是正式交互规范。

---

## When to Use

- User provides an Axure RP local HTML export directory and asks for requirements documentation, PRD, functional specs, or test cases
- User provides a published/static HTML prototype directory and wants requirements or page/module descriptions
- User wants to convert Axure prototypes into structured requirements for development teams
- User wants page-level functional specifications with form fields, table columns, interactions, and navigation flows
- User wants to identify gaps that need manual confirmation (without technical noise)

## Input

- **Required**: Path to Axure RP HTML export root directory (contains `data/document.js`)
- **Required**: Path to `extracted/axure_context.json` (produced by `axure-rp-html-ingest`)
- **Optional**: Module name(s) to limit scope (e.g., `质检中心,服务监控`)
- **Optional**: Document type: `需求文档` (default) / `PRD` / `功能说明` / `测试用例`
- **Optional**: Mode: `static-prototype` (default) / `strict`

## Output

All output goes to the `outputs/` directory:

```
outputs/
└── <项目名>_<文档类型>.md          # Generated requirements document

extracted/packs/
├── <模块名>_context_pack.md        # Per-module context packs (auto-generated if missing)
└── ...
```

---

## Modes

### static-prototype (默认)

把 Axure 当作静态业务界面材料，而不是正式交互规范。适用于大多数实际 Axure 原型。

**原则**：
1. 优先从 sitemap 页面结构、页面标题、HTML visible text、data-label、placeholderText、表单控件类型、按钮/操作类文案、菜单和模块层级生成需求文档
2. 动态面板状态名仅作为页签/弹窗/区域切换线索
3. interactionMap 只作为弱证据，翻译成业务语言：
   - `setPanelState` → "可能存在页签/状态切换"
   - `fadeWidget` → "可能存在弹窗/显隐"
   - `linkWindow` → "可能存在页面跳转"
   - `addSortToRepeater` → "可能存在排序功能"
4. 不列出空 label、State1、空 target、空动态面板等技术噪音
5. 表格字段无法提取时，统一写"原型存在表格/列表区域，字段需结合页面视觉稿或业务材料补充"
6. 模块定位按 sitemap 模块名和页面名保守生成，不从随机 visibleText 推断
7. 每个模块"需业务确认"最多 3-5 条，全篇不超过 25 条
8. 输出文档像"需求初稿"，不是"Axure 解析报告"

### strict

将 Axure 原型视为正式交互规范，完整提取所有交互规则、组件详情、确认项。适用于设计人员规范使用 Axure 交互功能的项目。

---

## Core Workflow

```
1. Check if extracted/axure_context.json exists.
   - If NOT: Run ingest_axure_html.js first.
2. Read extracted/axure_context.json and extracted/axure_sitemap.md.
3. Identify modules from sitemap (Folder nodes at depth 1).
4. For each module:
   a. Generate context pack via make_axure_context_pack.js (if not already present).
   b. Extract page details from axure_context.json pages array.
5. Build requirements document from context packs + page details.
   - static-prototype mode: business-oriented document structure
   - strict mode: technical analysis document structure
6. Write output to outputs/<项目名>_<文档类型>.md.
```

---

## Script: make_requirements_doc.js

### CLI Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--input` | Yes | - | Axure HTML export root directory |
| `--context` | Yes | - | Path to `axure_context.json` |
| `--output` | No | `outputs/<项目名>_需求文档.md` | Output file path |
| `--modules` | No | All modules | Comma-separated module names to include |
| `--doc-type` | No | `需求文档` | Document type label |
| `--mode` | No | `static-prototype` | Document generation mode: `static-prototype` or `strict` |
| `--no-pack` | No | false | Skip context pack generation (use existing) |
| `--max-chars-per-module` | No | 15000 | Max chars per module context pack |

### Processing Pipeline

```
1. Parse CLI arguments (including --mode)
2. Load axure_context.json
3. Identify modules from sitemap:
   - Folder at depth 1 → top-level module
   - Wireframe at depth 0 → standalone page (treated as a module)
4. For each module:
   a. Collect pages belonging to this module
   b. If context pack doesn't exist (and --no-pack not set):
      - Call make_axure_context_pack.js to generate it
   c. Extract structured data from pages:
      - static-prototype mode:
        * Page purpose, display content, query/filter area
        * Form/input items, list/table area, main actions
        * Dialogs/tabs/state switches, navigation
        * Business confirmation items (max 3-5 per module)
      - strict mode:
        * Form fields, filter conditions, table columns
        * Buttons & actions, dynamic panels, navigation
        * Interaction rules (deduplicated)
        * Manual confirmation items (all)
5. Assemble requirements document:
   - static-prototype mode:
     * Project overview
     * Information architecture
     * Business module specifications (per-module: positioning, scope, core objects, features, page details, confirmations)
     * Common page patterns
     * Supplement material suggestions
   - strict mode:
     * Project overview
     * Information architecture
     * Module specifications (per-module: goals, pages, functions, fields, interactions)
     * Global interaction patterns
     * Low-confidence / needs-confirmation items
6. Write output Markdown
```

---

## Output Format: static-prototype Mode (Default)

```markdown
# <项目名>需求文档

## 1. 项目概述
- **项目名称**: ...
- **页面总数**: ...
- **模块数量**: ...
- **生成时间**: ...
- **数据来源**: Axure RP HTML 导出包

## 2. 信息架构
<tree structure from sitemap>

## 3. 业务模块说明

### 3.N <模块名>

#### 模块定位
<conservative description from sitemap module name and page names>

#### 页面范围
- 页面1
- 页面2
- ...

#### 核心业务对象
<inferred from page titles and meaningful labels>

#### 功能清单
- 功能1 (inferred from button labels, menu items)
- 功能2
- ...

#### 页面说明

**页面1名称**
- 页面用途: ...
- 主要展示内容: ...
- 查询/筛选区域: ...
- 表单/录入项: ...
- 列表/表格区域: ...
- 主要操作: ...
- 弹窗/页签/状态切换: ...
- 跳转关系: ...

**页面2名称**
- ...

#### 需业务确认
- (max 3-5 items, only truly impactful questions)

## 4. 共性页面模式
- 左侧菜单导航
- 顶部栏
- 查询条件区
- 表格列表区
- 新增/编辑/删除/查看操作
- 弹窗确认
- 状态开关
- 统计卡片/大屏

## 5. 后续补充材料建议
- 视觉稿/设计标注
- 业务流程图
- 数据字典
- ...
```

## Output Format: strict Mode

```markdown
# <项目名><文档类型>

## 1. 项目概述
- **项目名称**: ...
- **页面总数**: ...
- **模块数量**: ...
- **生成时间**: ...
- **数据来源**: Axure RP HTML 导出包

## 2. 信息架构
<tree structure from sitemap>

## 3. 模块说明

### 3.N <模块名>

#### 模块目标
<inferred from htmlTextHints or "需人工确认">

#### 页面列表
| 页面名称 | URL | 组件数 | 交互数 | 动态面板数 | 表格数 |

#### 主要功能
<inferred from visibleText + interactions>

#### 表单字段
| 字段名称 | 组件类型 | 占位提示 | 必填推断 |

#### 查询/筛选条件
| 筛选项 | 类型 | 说明 |

#### 表格/列表字段
| 列名 | 说明 |

#### 按钮与操作
| 按钮名称 | 触发事件 | 操作类型 | 目标/说明 |

#### 弹窗/动态面板
| 名称 | 状态列表 | 推断用途 |

#### 页面跳转
| 来源页面 | 触发条件 | 目标页面 |

#### 交互规则
| 触发元素 | 事件 | 条件 | 动作 | 说明 |

#### 需人工确认项
- ...

## 4. 全局交互与共性规则
- Sidebar navigation pattern
- Close button pattern
- Table sort pattern
- Toggle switch pattern

## 5. 低置信度/待确认内容
<grouped by module>
```

---

## Safety Constraints (MANDATORY)

1. **Read-only on input**: Never modify the Axure HTML export package
2. **No raw data.js**: Only read `axure_context.json` and context packs; fall back to `pages/*.json` only when context pack is insufficient
3. **No fabrication**: Do not invent features not present in the extracted data
4. **Mark uncertainty**: Label inferred content as "需业务确认" (static-prototype) or "需人工确认" (strict)
5. **Chinese path support**: All file operations must handle Chinese characters in paths
6. **No network requests**: All processing is local
7. **Markdown only**: Output Markdown, never Word/PDF
8. **static-prototype 降噪**: 不列出空 label、State1、空 target、空动态面板等技术噪音
9. **static-prototype 交互翻译**: 不把底层 action 名称大量写进需求文档正文，翻译成业务语言
10. **static-prototype 确认项上限**: 每个模块最多 3-5 条"需业务确认"，全篇不超过 25 条

---

## Failure Handling

| Condition | Behavior |
|-----------|----------|
| Missing `axure_context.json` | FAIL with message: "请先运行 ingest_axure_html.js 生成解析产物" |
| Missing `--input` directory | WARN (does not block if context already exists) |
| Context pack generation fails for a module | Skip module, record error, continue |
| Page JSON parse error | Skip page, record error |
| `outputs/` directory missing | Auto-create |

---

## Component Classification Rules

| Category | friendlyType values | Used for |
|----------|---------------------|----------|
| Input | 文本框, 文本域, 下拉列表, 日期选择器, 单选框, 复选框 | Form fields, Filter conditions |
| Button | 形状/矩形 with action-related labels | Buttons & actions |
| Display | 矩形, 组合, 图片, SVG, 线段, 圆形 | Component counts only |

**Button label keywords**: 按钮, 查询, 新增, 删除, 保存, 取消, 导出, 关闭, 编辑, 查看, 搜索, 重置, 提交, 确认, 开启, 暂停, 下载, 上传

---

## Interaction Deduplication

Same as `make_axure_context_pack.js`: deduplicate by `(sourceLabel, eventType, action, target, conditionString)`.

---

## Common Pitfalls

| Pitfall | Correct Approach |
|---------|-----------------|
| Reading raw data.js files | Use axure_context.json and context packs only |
| Fabricating features not in prototype | Mark as "需业务确认" (static-prototype) or "需人工确认" (strict) |
| Including all 43 pages in one context | Generate per-module context packs |
| Treating inferred descriptions as confirmed | Clearly separate confirmed vs inferred content |
| Hardcoding paths | Use CLI arguments and path.resolve() |
| Listing empty labels, State1, empty targets as confirmation items (static-prototype) | Suppress technical noise; only flag items that impact requirements understanding |
| Writing setFunction/fadeWidget/setPanelState in document body (static-prototype) | Translate to business language: "可能存在弹窗/显隐", "可能存在页签切换" |
| Inferring module positioning from random visibleText (static-prototype) | Use sitemap module name and page names conservatively |
| Listing empty tables one by one (static-prototype) | Write "原型存在表格/列表区域，字段需结合页面视觉稿或业务材料补充" |

---

## Dependencies

- **axure-rp-html-ingest**: Must be run first to produce `axure_context.json`
- **make_axure_context_pack.js**: Called internally to generate per-module context packs

---

## Future Extensions (NOT implemented yet)

- **Test Case Generation**: Auto-generate test cases from interaction rules
- **Diff-based Updates**: Regenerate only changed modules when Axure export is updated
- **Multi-format Output**: Word/PDF export via pandoc
