#!/usr/bin/env node
/**
 * make_requirements_doc.js
 *
 * 从 Axure 解析产物（axure_context.json）生成结构化需求文档。
 * 按 sitemap 自动识别模块，对每个模块调用 make_axure_context_pack.js
 * 生成 context pack，然后基于 context pack + 页面详情生成需求文档 Markdown。
 *
 * Usage:
 *   node make_requirements_doc.js \
 *     --input <axure_export_root> \
 *     --context <axure_context.json> \
 *     --output <output_path> \
 *     [--modules <模块1,模块2>] \
 *     [--doc-type <需求文档|PRD|功能说明|测试用例>] \
 *     [--no-pack] \
 *     [--max-chars-per-module <N>] \
 *     [--mode <static-prototype|strict>]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================================
// CLI 参数解析
// ============================================================================

function parseArgs(argv) {
  const args = {
    input: null,
    context: null,
    output: null,
    modules: null,
    docType: '需求文档',
    noPack: false,
    maxCharsPerModule: 15000,
    mode: 'static-prototype',
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input':
        args.input = argv[++i];
        break;
      case '--context':
        args.context = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--modules':
        args.modules = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--doc-type':
        args.docType = argv[++i] || '需求文档';
        break;
      case '--no-pack':
        args.noPack = true;
        break;
      case '--max-chars-per-module':
        args.maxCharsPerModule = parseInt(argv[++i], 10);
        if (isNaN(args.maxCharsPerModule) || args.maxCharsPerModule < 1000) {
          console.error('ERROR: --max-chars-per-module 必须为 >= 1000 的数字');
          process.exit(1);
        }
        break;
      case '--mode':
        args.mode = argv[++i] || 'static-prototype';
        if (!['static-prototype', 'strict'].includes(args.mode)) {
          console.error('ERROR: --mode 必须为 static-prototype 或 strict');
          process.exit(1);
        }
        break;
      default:
        console.warn(`未知参数: ${argv[i]}`);
    }
  }

  // 校验必填参数
  const missing = [];
  if (!args.context) missing.push('--context');
  if (!args.input) missing.push('--input');

  if (missing.length > 0) {
    console.error(`ERROR: 缺少必填参数: ${missing.join(', ')}`);
    console.error('Usage: node make_requirements_doc.js --input <axure_root> --context <json> [--output <md>] [--modules <m1,m2>] [--doc-type <类型>] [--no-pack] [--max-chars-per-module <N>] [--mode <static-prototype|strict>]');
    process.exit(1);
  }

  return args;
}

// ============================================================================
// 上下文加载
// ============================================================================

function loadContext(contextPath) {
  const resolved = path.resolve(contextPath);
  if (!fs.existsSync(resolved)) {
    console.error(`FATAL: 上下文文件不存在: ${resolved}`);
    console.error('请先运行 ingest_axure_html.js 生成 axure_context.json');
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (e) {
    console.error(`FATAL: 解析上下文 JSON 失败: ${e.message}`);
    process.exit(1);
  }
}

// ============================================================================
// 模块识别
// ============================================================================

/**
 * 从 sitemap 中识别模块结构。
 * - depth===0 且 type==='Folder' → 项目根（用于提取项目名）
 * - depth===1 且 type==='Folder' → 顶级模块
 * - depth===0 且 type==='Wireframe' → 独立页面（归入"独立页面"模块）
 * - depth===1 且 type==='Wireframe' → 独立页面（归入"独立页面"模块）
 * - depth>1 且 type==='Folder' → 子模块（归入父模块）
 * - depth>1 且 type==='Wireframe' → 归入最近的父模块
 */
function identifyModules(sitemap) {
  const modules = [];
  const standalonePages = [];
  let projectName = null;

  // 第一遍：识别项目名和顶级 Folder
  for (let i = 0; i < sitemap.length; i++) {
    const entry = sitemap[i];
    if (entry.type === 'Folder' && entry.depth === 0 && !projectName) {
      projectName = entry.pageName;
    }
  }

  // 第二遍：构建模块结构
  // 策略：遍历 sitemap，遇到 depth===1 的 Folder 就开始新模块，
  // 后续 depth>=2 的条目归入当前模块，直到遇到下一个 depth<=1 的条目
  let currentModule = null;

  for (let i = 0; i < sitemap.length; i++) {
    const entry = sitemap[i];

    if (entry.type === 'Folder' && entry.depth === 0) {
      // 项目根 Folder，跳过
      continue;
    }

    if (entry.type === 'Folder' && entry.depth === 1) {
      // 顶级模块
      currentModule = {
        moduleName: entry.pageName,
        depth: 1,
        pages: [],
      };
      modules.push(currentModule);
      continue;
    }

    if (entry.type === 'Wireframe' && entry.depth <= 1) {
      // 独立页面（depth 0 或 1 的 Wireframe）
      standalonePages.push({
        pageName: entry.pageName,
        url: entry.url || '',
        depth: entry.depth,
      });
      continue;
    }

    // depth >= 2 的条目归入当前模块
    if (currentModule) {
      if (entry.type === 'Wireframe') {
        currentModule.pages.push({
          pageName: entry.pageName,
          url: entry.url || '',
          depth: entry.depth,
        });
      }
      // depth >= 2 的 Folder 是子模块，其下的 Wireframe 也会在后续遍历中归入当前模块
    }
  }

  // 如果有独立页面，创建一个虚拟模块
  if (standalonePages.length > 0) {
    modules.push({
      moduleName: '独立页面',
      depth: 0,
      pages: standalonePages,
    });
  }

  return { projectName, modules };
}

// ============================================================================
// Context Pack 生成
// ============================================================================

function generatePacks(args, modules, contextPath) {
  const scriptDir = __dirname;
  const extractedDir = path.dirname(path.resolve(contextPath));
  const packsDir = path.join(extractedDir, 'packs');

  // 确保 packs 目录存在
  if (!fs.existsSync(packsDir)) {
    fs.mkdirSync(packsDir, { recursive: true });
  }

  const packPaths = {};

  for (const mod of modules) {
    if (mod.pages.length === 0) {
      console.log(`  模块 "${mod.moduleName}" 无页面，跳过 pack 生成`);
      continue;
    }

    const packPath = path.join(packsDir, `${mod.moduleName}_context_pack.md`);
    packPaths[mod.moduleName] = packPath;

    // 如果 pack 已存在且 --no-pack 未设置，也跳过（除非文件不存在）
    if (fs.existsSync(packPath) && !args.noPack) {
      console.log(`  模块 "${mod.moduleName}" 的 context pack 已存在，跳过生成`);
      continue;
    }

    if (args.noPack) {
      console.log(`  模块 "${mod.moduleName}" 跳过 pack 生成（--no-pack）`);
      continue;
    }

    // 调用 make_axure_context_pack.js 生成 pack
    const pagesArg = mod.pages.map(p => p.pageName).join(',');
    const cmd = `node "${path.join(scriptDir, 'make_axure_context_pack.js')}" --context "${contextPath}" --pages "${pagesArg}" --task "${mod.moduleName}模块需求分析" --output "${packPath}" --sitemap-mode compact --no-emoji --max-chars ${args.maxCharsPerModule} --resume-header`;

    try {
      console.log(`  生成模块 "${mod.moduleName}" 的 context pack...`);
      execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
      console.log(`  ✓ 模块 "${mod.moduleName}" context pack 已生成: ${packPath}`);
    } catch (e) {
      console.error(`  ✗ 模块 "${mod.moduleName}" context pack 生成失败: ${e.message}`);
      // 跳过该模块，继续
      delete packPaths[mod.moduleName];
    }
  }

  return packPaths;
}

// ============================================================================
// 页面数据查找
// ============================================================================

/**
 * 从 ctx.pages 中查找指定页面名的页面数据
 */
function findPageData(ctx, pageName) {
  return ctx.pages.find(p => p.pageName === pageName) || null;
}

// ============================================================================
// 组件分类
// ============================================================================

const INPUT_TYPES = ['文本框', '文本域', '下拉列表', '日期选择器', '单选框', '复选框'];
const INPUT_FRIENDLY_TYPES = new Set(INPUT_TYPES);

const BUTTON_KEYWORDS = ['按钮', '查询', '新增', '删除', '保存', '取消', '导出', '关闭', '确定', '提交', '编辑', '修改', '重置', '搜索', '下载', '上传', '导入', '刷新', '返回', '登录', '注册', '发送', '审核', '启用', '停用', '分配', '同步'];

/**
 * 判断组件是否为输入类
 */
function isInputComponent(comp) {
  return INPUT_FRIENDLY_TYPES.has(comp.friendlyType);
}

/**
 * 判断组件是否为按钮类
 */
function isButtonComponent(comp) {
  if (comp.friendlyType === '形状' || comp.friendlyType === '矩形') {
    if (comp.label && BUTTON_KEYWORDS.some(kw => comp.label.includes(kw))) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// 交互去重
// ============================================================================

function deduplicateInteractions(interactions) {
  const seen = new Set();
  const deduped = [];
  for (const i of interactions) {
    const key = `${i.sourceLabel}|${i.eventType}|${i.action}|${i.target}|${i.conditionString}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(i);
    }
  }
  return deduped;
}

// ============================================================================
// 需求文档构建
// ============================================================================

/**
 * 构建项目概述
 */
function buildProjectOverview(projectName, ctx, docType) {
  const totalPages = ctx.pages.length;
  const moduleCount = ctx.document.sitemap.filter(e => e.type === 'Folder' && e.depth === 1).length;
  const generatedAt = new Date().toISOString();

  let md = '';
  md += `# ${projectName}${docType}\n\n`;
  md += `## 1. 项目概述\n\n`;
  md += `- **项目名称**: ${projectName}\n`;
  md += `- **页面总数**: ${totalPages}\n`;
  md += `- **模块数量**: ${moduleCount}\n`;
  md += `- **生成时间**: ${generatedAt}\n`;
  md += `- **数据来源**: Axure RP HTML 导出包\n\n`;
  return md;
}

/**
 * 构建信息架构（树形结构）
 */
function buildInformationArchitecture(sitemap) {
  let md = '';
  md += `## 2. 信息架构\n\n`;
  md += '```\n';

  for (const entry of sitemap) {
    const indent = '  '.repeat(entry.depth);
    let icon;
    if (entry.type === 'Folder') {
      icon = '[Folder]';
    } else {
      icon = '[Page]';
    }
    const suffix = entry.url ? ` -> ${entry.url}` : '';
    md += `${indent}${icon} ${entry.pageName}${suffix}\n`;
  }

  md += '```\n\n';
  return md;
}

/**
 * 构建模块说明
 */
function buildModuleSections(ctx, modules, packPaths) {
  let md = '';
  md += `## 3. 模块说明\n\n`;

  const manualConfirmItems = [];

  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi];
    md += `### 3.${mi + 1} ${mod.moduleName}\n\n`;

    // ---- 模块目标 ----
    md += `#### 模块目标\n\n`;
    const moduleDescription = extractModuleDescription(ctx, mod);
    md += `${moduleDescription}\n\n`;

    // ---- 页面列表 ----
    md += `#### 页面列表\n\n`;
    md += `| 页面名称 | URL | 组件数 | 交互数 | 动态面板数 | 表格数 |\n`;
    md += `|----------|-----|--------|--------|------------|--------|\n`;

    for (const pageRef of mod.pages) {
      const pageData = findPageData(ctx, pageRef.pageName);
      if (!pageData) {
        md += `| ${pageRef.pageName} | ${pageRef.url || '-'} | - | - | - | - |\n`;
        continue;
      }
      md += `| ${pageData.pageName} | ${pageData.url || '-'} | ${pageData.stats.componentCount} | ${pageData.stats.interactionCount} | ${pageData.stats.dynamicPanelCount} | ${pageData.stats.tableCount} |\n`;
    }
    md += '\n';

    // 收集模块内所有页面的数据
    const modulePages = [];
    for (const pageRef of mod.pages) {
      const pageData = findPageData(ctx, pageRef.pageName);
      if (pageData) {
        modulePages.push(pageData);
      }
    }

    // ---- 主要功能 ----
    md += `#### 主要功能\n\n`;
    md += buildMainFunctions(modulePages);
    md += '\n';

    // ---- 表单字段 ----
    md += `#### 表单字段\n\n`;
    md += buildFormFields(modulePages, manualConfirmItems, mod.moduleName);
    md += '\n';

    // ---- 查询/筛选条件 ----
    md += `#### 查询/筛选条件\n\n`;
    md += buildFilterConditions(modulePages, manualConfirmItems, mod.moduleName);
    md += '\n';

    // ---- 表格/列表字段 ----
    md += `#### 表格/列表字段\n\n`;
    md += buildTableFields(modulePages, manualConfirmItems, mod.moduleName);
    md += '\n';

    // ---- 按钮与操作 ----
    md += `#### 按钮与操作\n\n`;
    md += buildButtonActions(modulePages, manualConfirmItems, mod.moduleName);
    md += '\n';

    // ---- 弹窗/动态面板 ----
    md += `#### 弹窗/动态面板\n\n`;
    md += buildDynamicPanelsSection(modulePages, manualConfirmItems, mod.moduleName);
    md += '\n';

    // ---- 页面跳转 ----
    md += `#### 页面跳转\n\n`;
    md += buildPageNavigation(modulePages);
    md += '\n';

    // ---- 交互规则 ----
    md += `#### 交互规则\n\n`;
    md += buildInteractionRulesSection(modulePages, manualConfirmItems, mod.moduleName);
    md += '\n';

    // ---- 需人工确认项 ----
    md += `#### 需人工确认项\n\n`;
    const moduleConfirms = deduplicateConfirmItems(manualConfirmItems.filter(item => item.module === mod.moduleName));
    if (moduleConfirms.length > 0) {
      for (const item of moduleConfirms) {
        md += `- ${item}\n`;
      }
    } else {
      md += `_无_\n`;
    }
    md += '\n';
  }

  // 对 manualConfirmItems 整体去重
  const dedupedConfirmItems = deduplicateConfirmItems(manualConfirmItems);

  return { md, manualConfirmItems: dedupedConfirmItems };
}

/**
 * 对确认项去重并合并同类项
 * 将相同文本的条目合并为一条，附带计数
 */
function deduplicateConfirmItems(items) {
  const countMap = new Map();
  for (const item of items) {
    const text = item.text || item;
    countMap.set(text, (countMap.get(text) || 0) + 1);
  }
  const result = [];
  for (const [text, count] of countMap) {
    if (count > 1) {
      result.push(`${text}（×${count}）`);
    } else {
      result.push(text);
    }
  }
  return result;
}

/**
 * 提取模块描述（从页面 htmlTextHints 中提取业务描述性文本）
 */
function extractModuleDescription(ctx, mod) {
  const descriptions = [];

  for (const pageRef of mod.pages) {
    const pageData = findPageData(ctx, pageRef.pageName);
    if (!pageData || !pageData.htmlTextHints) continue;

    const visibleTexts = pageData.htmlTextHints
      .filter(h => h.type === 'visibleText')
      .map(h => h.value)
      .filter(v => v && v.length > 4 && v.length < 100);

    // 取前几条有意义的文本作为描述
    for (const text of visibleTexts.slice(0, 3)) {
      if (!descriptions.includes(text)) {
        descriptions.push(text);
      }
    }
  }

  if (descriptions.length > 0) {
    return descriptions.slice(0, 3).join('；');
  }
  return '需人工确认';
}

/**
 * 构建主要功能描述
 */
function buildMainFunctions(pages) {
  const functions = [];

  for (const page of pages) {
    // 从 htmlTextHints 的 visibleText 提取功能描述
    if (page.htmlTextHints) {
      const visibleTexts = page.htmlTextHints
        .filter(h => h.type === 'visibleText')
        .map(h => h.value)
        .filter(v => v && v.length > 2);

      // 从交互中推断功能
      const linkInteractions = page.interactions.filter(i => i.action === 'linkWindow');
      const panelInteractions = page.interactions.filter(i => i.action === 'setPanelState');

      let desc = `**${page.pageName}**: `;
      const features = [];

      // 从可见文本中提取功能关键词
      if (visibleTexts.length > 0) {
        features.push(`页面包含: ${visibleTexts.slice(0, 5).join('、')}`);
      }

      if (linkInteractions.length > 0) {
        const targets = [...new Set(linkInteractions.map(i => i.target).filter(Boolean))];
        if (targets.length > 0) {
          features.push(`可跳转至: ${targets.slice(0, 5).join('、')}`);
        }
      }

      if (panelInteractions.length > 0) {
        features.push(`含动态面板切换交互`);
      }

      if (features.length > 0) {
        desc += features.join('；');
        functions.push(desc);
      }
    }
  }

  if (functions.length > 0) {
    return functions.map(f => `- ${f}`).join('\n') + '\n';
  }
  return '_需人工确认_\n';
}

/**
 * 构建表单字段
 * 对相同 (label, friendlyType, placeholder, pageName) 的条目去重，
 * 空标签同类组件合并为一条并标注数量
 */
function buildFormFields(pages, manualConfirmItems, moduleName) {
  const fields = [];
  const emptyLabelCounts = {}; // pageName -> { friendlyType -> count }

  for (const page of pages) {
    const inputComps = page.components.filter(c => isInputComponent(c));
    const seen = new Set();

    for (const comp of inputComps) {
      const label = comp.label || '';
      const placeholder = comp.placeholderText || '';
      const required = inferRequired(comp, page);

      // 去重：相同 label+type+placeholder+pageName 只保留一条
      const dedupeKey = `${label}|${comp.friendlyType}|${placeholder}|${page.pageName}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!label) {
        // 统计空标签组件数量
        if (!emptyLabelCounts[page.pageName]) emptyLabelCounts[page.pageName] = {};
        emptyLabelCounts[page.pageName][comp.friendlyType] = (emptyLabelCounts[page.pageName][comp.friendlyType] || 0) + 1;
        // 空标签组件只保留一条占位
        const emptyKey = `(空)|${comp.friendlyType}|${placeholder || '-'}|${page.pageName}`;
        if (seen.has(`__empty__${emptyKey}`)) continue;
        seen.add(`__empty__${emptyKey}`);
        fields.push({
          pageName: page.pageName,
          label: `(空)`,
          friendlyType: comp.friendlyType,
          placeholder,
          required,
          isEmpty: true,
        });
      } else {
        fields.push({
          pageName: page.pageName,
          label,
          friendlyType: comp.friendlyType,
          placeholder,
          required,
          isEmpty: false,
        });
      }
    }
  }

  // 生成空标签确认项（合并计数）
  for (const [pageName, typeCounts] of Object.entries(emptyLabelCounts)) {
    for (const [friendlyType, count] of Object.entries(typeCounts)) {
      manualConfirmItems.push({
        module: moduleName,
        text: `[${pageName}] 存在 ${count} 个 label 为空的输入组件（类型: ${friendlyType}）`,
      });
    }
  }

  if (fields.length === 0) {
    return '_无表单字段_\n';
  }

  let md = '';
  md += `| 字段名称 | 组件类型 | 占位提示 | 必填推断 | 所属页面 |\n`;
  md += `|----------|----------|----------|----------|----------|\n`;
  for (const f of fields) {
    md += `| ${f.label} | ${f.friendlyType} | ${f.placeholder || '-'} | ${f.required} | ${f.pageName} |\n`;
  }
  md += '\n';
  return md;
}

/**
 * 推断字段是否必填（简单启发式）
 */
function inferRequired(comp, page) {
  // 从 htmlTextHints 中查找是否有"必填"/"*"标记
  if (page.htmlTextHints) {
    const visibleTexts = page.htmlTextHints
      .filter(h => h.type === 'visibleText')
      .map(h => h.value);
    if (visibleTexts.some(t => t && t.includes('必填'))) {
      return '可能';
    }
  }
  return '未知';
}

/**
 * 构建查询/筛选条件
 * 对空标签同类组件合并
 */
function buildFilterConditions(pages, manualConfirmItems, moduleName) {
  const conditions = [];
  const emptyLabelCounts = {}; // pageName -> { friendlyType -> count }

  for (const page of pages) {
    // 筛选输入类组件 + 下拉列表
    const filterComps = page.components.filter(c =>
      isInputComponent(c) || (c.friendlyType === '下拉列表')
    );

    // 去重
    const seen = new Set();
    for (const comp of filterComps) {
      const label = comp.label || '';
      const key = `${label}|${comp.friendlyType}|${page.pageName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!label) {
        if (!emptyLabelCounts[page.pageName]) emptyLabelCounts[page.pageName] = {};
        emptyLabelCounts[page.pageName][comp.friendlyType] = (emptyLabelCounts[page.pageName][comp.friendlyType] || 0) + 1;
        continue; // 空标签筛选条件跳过，在确认项中汇总
      }

      conditions.push({
        pageName: page.pageName,
        label,
        friendlyType: comp.friendlyType,
        description: '',
      });
    }
  }

  // 生成空标签确认项
  for (const [pageName, typeCounts] of Object.entries(emptyLabelCounts)) {
    for (const [friendlyType, count] of Object.entries(typeCounts)) {
      manualConfirmItems.push({
        module: moduleName,
        text: `[${pageName}] 存在 ${count} 个 label 为空的筛选组件（类型: ${friendlyType}）`,
      });
    }
  }

  if (conditions.length === 0) {
    return '_无明确筛选条件_\n';
  }

  let md = '';
  md += `| 筛选项 | 类型 | 说明 | 所属页面 |\n`;
  md += `|--------|------|------|----------|\n`;
  for (const c of conditions) {
    md += `| ${c.label} | ${c.friendlyType} | ${c.description || '-'} | ${c.pageName} |\n`;
  }
  md += '\n';
  return md;
}

/**
 * 构建表格/列表字段
 * 对空列名的表格合并确认项
 * 对同页面同标签的空表格合并展示
 */
function buildTableFields(pages, manualConfirmItems, moduleName) {
  const tables = [];

  for (const page of pages) {
    const pageTables = [];

    if (page.tables && page.tables.length > 0) {
      for (const table of page.tables) {
        const columns = table.columnLabels || [];
        pageTables.push({
          pageName: page.pageName,
          tableLabel: table.label || '(未命名表格)',
          columns,
        });

        // 检查空列名，合并为一条确认项
        const emptyColCount = columns.filter(c => !c).length;
        if (emptyColCount > 0) {
          manualConfirmItems.push({
            module: moduleName,
            text: `[${page.pageName}] 表格 "${table.label || '(未命名)'}" 存在 ${emptyColCount} 个空列名`,
          });
        }
      }
    }

    // 也从 repeaters 提取
    if (page.repeaters && page.repeaters.length > 0) {
      for (const rep of page.repeaters) {
        const columns = rep.columnNames || [];
        pageTables.push({
          pageName: page.pageName,
          tableLabel: rep.label || '(未命名列表)',
          columns,
        });
      }
    }

    // 合并同页面同标签的空表格（无列名的表格）
    const mergedTables = [];
    const emptyTableCounts = {}; // tableLabel -> count
    for (const t of pageTables) {
      const nonEmptyCols = t.columns.filter(c => c);
      if (nonEmptyCols.length === 0) {
        // 空表格，合并
        emptyTableCounts[t.tableLabel] = (emptyTableCounts[t.tableLabel] || 0) + 1;
      } else {
        mergedTables.push(t);
      }
    }

    // 添加合并后的空表格条目
    for (const [tableLabel, count] of Object.entries(emptyTableCounts)) {
      mergedTables.push({
        pageName: page.pageName,
        tableLabel: count > 1 ? `${tableLabel}（×${count}）` : tableLabel,
        columns: [],
        merged: true,
        mergedCount: count,
      });
    }

    tables.push(...mergedTables);
  }

  if (tables.length === 0) {
    return '_无表格/列表_\n';
  }

  let md = '';
  for (const t of tables) {
    if (t.merged) {
      // 合并的空表格，只显示摘要
      md += `**${t.tableLabel}**（${t.pageName}）— _${t.mergedCount} 个空表格，列名未提取_\n\n`;
    } else {
      md += `**${t.tableLabel}**（${t.pageName}）\n\n`;
      md += `| 列名 | 说明 |\n`;
      md += `|------|------|\n`;
      for (const col of t.columns) {
        if (col) {
          md += `| ${col} | - |\n`;
        }
      }
      md += '\n';
    }
  }
  return md;
}

/**
 * 构建按钮与操作
 * 对空 sourceLabel 和空 target 的确认项合并
 */
function buildButtonActions(pages, manualConfirmItems, moduleName) {
  const buttons = [];
  const emptySourceCounts = {};   // pageName -> { action -> count }
  const emptyTargetCounts = {};   // pageName -> { key -> count }

  for (const page of pages) {
    // 从 interactions 中筛选 action 为 linkWindow/fadeWidget/setPanelState 的交互
    const actionInteractions = page.interactions.filter(i =>
      ['linkWindow', 'fadeWidget', 'setPanelState'].includes(i.action)
    );

    const deduped = deduplicateInteractions(actionInteractions);

    for (const i of deduped) {
      const sourceLabel = i.sourceLabel || '';
      buttons.push({
        pageName: page.pageName,
        sourceLabel,
        eventType: i.eventType,
        action: i.action,
        displayName: i.displayName,
        target: i.target || '',
      });

      if (!sourceLabel) {
        if (!emptySourceCounts[page.pageName]) emptySourceCounts[page.pageName] = {};
        emptySourceCounts[page.pageName][i.action] = (emptySourceCounts[page.pageName][i.action] || 0) + 1;
      }

      if (!i.target || i.target === '[object Object]') {
        const key = `${sourceLabel || '(空)'}|${i.action}`;
        if (!emptyTargetCounts[page.pageName]) emptyTargetCounts[page.pageName] = {};
        emptyTargetCounts[page.pageName][key] = (emptyTargetCounts[page.pageName][key] || 0) + 1;
      }
    }

    // 也从按钮类组件中提取
    const buttonComps = page.components.filter(c => isButtonComponent(c));
    const seenLabels = new Set(buttons.map(b => b.sourceLabel));
    for (const comp of buttonComps) {
      if (comp.label && !seenLabels.has(comp.label)) {
        buttons.push({
          pageName: page.pageName,
          sourceLabel: comp.label,
          eventType: 'onClick',
          action: '(推断)',
          displayName: comp.friendlyType,
          target: '-',
        });
        seenLabels.add(comp.label);
      }
    }
  }

  // 生成合并后的确认项
  for (const [pageName, actionCounts] of Object.entries(emptySourceCounts)) {
    for (const [action, count] of Object.entries(actionCounts)) {
      manualConfirmItems.push({
        module: moduleName,
        text: `[${pageName}] 存在 ${count} 个 sourceLabel 为空的交互（action: ${action}）`,
      });
    }
  }

  for (const [pageName, keyCounts] of Object.entries(emptyTargetCounts)) {
    for (const [key, count] of Object.entries(keyCounts)) {
      const [sourceLabel, action] = key.split('|');
      manualConfirmItems.push({
        module: moduleName,
        text: `[${pageName}] 存在 ${count} 个交互目标为空或异常: sourceLabel="${sourceLabel}", action=${action}`,
      });
    }
  }

  if (buttons.length === 0) {
    return '_无明确按钮操作_\n';
  }

  let md = '';
  md += `| 按钮名称 | 触发事件 | 操作类型 | 目标/说明 | 所属页面 |\n`;
  md += `|----------|----------|----------|-----------|----------|\n`;
  for (const b of buttons) {
    const targetDisplay = b.target && b.target !== '[object Object]' ? b.target : '-';
    md += `| ${b.sourceLabel || '(空)'} | ${b.eventType} | ${b.displayName || b.action} | ${targetDisplay} | ${b.pageName} |\n`;
  }
  md += '\n';
  return md;
}

/**
 * 构建弹窗/动态面板
 * 对空 label 的动态面板合并确认项
 */
function buildDynamicPanelsSection(pages, manualConfirmItems, moduleName) {
  const panels = [];
  const emptyLabelCounts = {}; // pageName -> { stateCount -> count }

  for (const page of pages) {
    if (!page.dynamicPanels || page.dynamicPanels.length === 0) continue;

    for (const dp of page.dynamicPanels) {
      const label = dp.label || '';
      panels.push({
        pageName: page.pageName,
        label,
        stateLabels: dp.stateLabels || [],
        stateCount: dp.stateCount,
      });

      if (!label) {
        if (!emptyLabelCounts[page.pageName]) emptyLabelCounts[page.pageName] = {};
        emptyLabelCounts[page.pageName][dp.stateCount] = (emptyLabelCounts[page.pageName][dp.stateCount] || 0) + 1;
      }
    }
  }

  // 生成合并后的确认项
  for (const [pageName, stateCounts] of Object.entries(emptyLabelCounts)) {
    for (const [stateCount, count] of Object.entries(stateCounts)) {
      manualConfirmItems.push({
        module: moduleName,
        text: `[${pageName}] 存在 ${count} 个 label 为空的动态面板（状态数: ${stateCount}）`,
      });
    }
  }

  if (panels.length === 0) {
    return '_无弹窗/动态面板_\n';
  }

  let md = '';
  md += `| 名称 | 状态列表 | 推断用途 | 所属页面 |\n`;
  md += `|------|----------|----------|----------|\n`;
  for (const p of panels) {
    const inferredUse = inferDynamicPanelUse(p.label, p.stateLabels);
    md += `| ${p.label || '(空)'} | ${p.stateLabels.join(', ')} (${p.stateCount}) | ${inferredUse} | ${p.pageName} |\n`;
  }
  md += '\n';
  return md;
}

/**
 * 推断动态面板用途
 */
function inferDynamicPanelUse(label, stateLabels) {
  if (!label) return '需人工确认';

  const labelLower = label.toLowerCase();
  if (labelLower.includes('弹窗') || labelLower.includes('dialog') || labelLower.includes('modal')) {
    return '弹窗容器';
  }
  if (labelLower.includes('tab') || labelLower.includes('标签') || labelLower.includes('切换')) {
    return '标签页切换';
  }
  if (stateLabels && stateLabels.length === 2) {
    const sl = stateLabels.join('');
    if (sl.includes('展开') || sl.includes('收起') || sl.includes('显示') || sl.includes('隐藏')) {
      return '展开/收起切换';
    }
  }
  return '需人工确认';
}

/**
 * 构建页面跳转
 */
function buildPageNavigation(pages) {
  const navigations = [];

  for (const page of pages) {
    const linkInteractions = page.interactions.filter(i => i.action === 'linkWindow');
    const deduped = deduplicateInteractions(linkInteractions);

    for (const i of deduped) {
      navigations.push({
        sourcePage: page.pageName,
        condition: i.conditionString || '',
        target: i.target || '',
        sourceLabel: i.sourceLabel || '',
      });
    }
  }

  if (navigations.length === 0) {
    return '_无页面跳转_\n';
  }

  let md = '';
  md += `| 来源页面 | 触发条件 | 目标页面 |\n`;
  md += `|----------|----------|----------|\n`;
  for (const n of navigations) {
    const target = n.target && n.target !== '[object Object]' ? n.target : '(未知)';
    const condition = n.condition || (n.sourceLabel ? `点击"${n.sourceLabel}"` : '-');
    md += `| ${n.sourcePage} | ${condition} | ${target} |\n`;
  }
  md += '\n';
  return md;
}

/**
 * 构建交互规则
 */
function buildInteractionRulesSection(pages, manualConfirmItems, moduleName) {
  const allInteractions = [];

  for (const page of pages) {
    const deduped = deduplicateInteractions(page.interactions);
    for (const i of deduped) {
      allInteractions.push({
        pageName: page.pageName,
        sourceLabel: i.sourceLabel || '',
        eventType: i.eventType,
        conditionString: i.conditionString || '',
        action: i.action,
        displayName: i.displayName,
        description: i.description || '',
        target: i.target || '',
      });
    }
  }

  if (allInteractions.length === 0) {
    return '_无交互规则_\n';
  }

  // 限制展示数量，避免文档过长
  const maxShow = 50;
  const shown = allInteractions.slice(0, maxShow);

  let md = '';
  md += `| 触发元素 | 事件 | 条件 | 动作 | 说明 |\n`;
  md += `|----------|------|------|------|------|\n`;
  for (const i of shown) {
    const target = i.target && i.target !== '[object Object]' ? i.target : '-';
    md += `| ${i.sourceLabel || '(空)'} | ${i.eventType} | ${i.conditionString || '-'} | ${i.action} | ${i.description || target} |\n`;
  }

  if (allInteractions.length > maxShow) {
    md += `\n_展示 ${maxShow} 条，共 ${allInteractions.length} 条交互（已去重）_\n`;
  } else {
    md += `\n_共 ${allInteractions.length} 条交互（已去重）_\n`;
  }
  md += '\n';
  return md;
}

/**
 * 构建全局交互与共性规则
 */
function buildGlobalInteractions(ctx, modules) {
  let md = '';
  md += `## 4. 全局交互与共性规则\n\n`;

  // 收集所有交互
  const allInteractions = [];
  for (const page of ctx.pages) {
    for (const i of page.interactions) {
      allInteractions.push({ ...i, pageName: page.pageName });
    }
  }

  const deduped = deduplicateInteractions(allInteractions);

  // 识别共性模式
  const patterns = [];

  // 1. 侧边栏导航
  const sidebarNav = deduped.filter(i => i.action === 'linkWindow' && i.sourceLabel &&
    modules.some(m => m.pages.some(p => p.pageName === i.target))
  );
  if (sidebarNav.length > 0) {
    patterns.push(`- **侧边栏导航**: 通过 linkWindow 跳转到各模块页面，共 ${sidebarNav.length} 处`);
  }

  // 2. 关闭按钮
  const closeActions = deduped.filter(i => i.action === 'fadeWidget' &&
    (i.sourceLabel && (i.sourceLabel.includes('关闭') || i.sourceLabel.includes('取消')))
  );
  if (closeActions.length > 0) {
    patterns.push(`- **关闭/隐藏弹窗**: 通过 fadeWidget 隐藏弹窗或面板，共 ${closeActions.length} 处`);
  }

  // 3. 表格排序
  const sortActions = deduped.filter(i => i.action === 'addSortToRepeater' || i.action === 'refreshRepeater');
  if (sortActions.length > 0) {
    patterns.push(`- **表格排序/刷新**: 通过 addSortToRepeater + refreshRepeater 实现表格排序，共 ${sortActions.length} 处`);
  }

  // 4. 开关切换
  const toggleActions = deduped.filter(i => i.action === 'setFunction' || i.action === 'moveWidget');
  if (toggleActions.length > 0) {
    patterns.push(`- **开关/状态切换**: 通过 setFunction/moveWidget 实现开关切换，共 ${toggleActions.length} 处`);
  }

  // 5. 动态面板切换
  const panelStateActions = deduped.filter(i => i.action === 'setPanelState');
  if (panelStateActions.length > 0) {
    patterns.push(`- **动态面板状态切换**: 通过 setPanelState 切换面板状态，共 ${panelStateActions.length} 处`);
  }

  if (patterns.length > 0) {
    md += patterns.join('\n') + '\n\n';
  } else {
    md += '_未识别到明显共性交互模式_\n\n';
  }

  return md;
}

/**
 * 构建低置信度/待确认内容
 * manualConfirmItems 已是去重后的字符串数组
 */
function buildLowConfidenceSection(manualConfirmItems) {
  let md = '';
  md += `## 5. 低置信度/待确认内容\n\n`;

  if (manualConfirmItems.length === 0) {
    md += '_无待确认项_\n\n';
    return md;
  }

  for (const text of manualConfirmItems) {
    md += `- ${text}\n`;
  }
  md += '\n';

  return md;
}

// ============================================================================
// static-prototype 模式：辅助函数
// ============================================================================

/**
 * 交互 action 翻译为业务语言（弱证据）
 */
function translateActionToBusiness(action) {
  const map = {
    'setPanelState': '可能存在页签/状态切换',
    'fadeWidget': '可能存在弹窗/显隐',
    'linkWindow': '可能存在页面跳转',
    'addSortToRepeater': '可能存在排序功能',
    'refreshRepeater': '可能存在列表刷新',
    'setFunction': '可能存在功能开关/状态变更',
    'moveWidget': '可能存在元素位移/动画',
    'toggleVisibility': '可能存在显隐切换',
    'setWidgetText': '可能存在文本动态更新',
    'setSelected': '可能存在选中状态切换',
  };
  return map[action] || null;
}

/**
 * 推断动态面板的业务用途（static-prototype 模式）
 * 返回简洁的业务描述，不列出技术状态名
 */
function inferDynamicPanelBusinessUse(label, stateLabels) {
  if (!label) {
    // 无标签时，仅从状态名推断
    if (stateLabels && stateLabels.length === 2) {
      const joined = stateLabels.join('');
      if (joined.includes('展开') || joined.includes('收起')) return '展开/收起区域';
      if (joined.includes('显示') || joined.includes('隐藏')) return '显隐切换区域';
    }
    return '可能存在区域切换';
  }

  const labelLower = label.toLowerCase();
  if (labelLower.includes('弹窗') || labelLower.includes('dialog') || labelLower.includes('modal')) {
    return '弹窗';
  }
  if (labelLower.includes('tab') || labelLower.includes('标签') || labelLower.includes('切换')) {
    return '页签切换';
  }
  if (stateLabels && stateLabels.length === 2) {
    const joined = stateLabels.join('');
    if (joined.includes('展开') || joined.includes('收起')) return '展开/收起区域';
    if (joined.includes('显示') || joined.includes('隐藏')) return '显隐切换区域';
  }
  // State1/State2 等默认命名
  const allDefault = stateLabels && stateLabels.every(s => /^State\d+$/i.test(s));
  if (allDefault) return '可能存在区域切换';

  return '可能存在区域切换';
}

/**
 * 从页面数据中提取有意义的标签（过滤空标签和技术噪音）
 */
function extractMeaningfulLabels(page) {
  const labels = [];
  if (page.components) {
    for (const comp of page.components) {
      const label = (comp.label || '').trim();
      if (label && label.length > 0 && !/^(State\d+|Panel|Rectangle|Shape|Box)$/i.test(label)) {
        labels.push(label);
      }
    }
  }
  return [...new Set(labels)];
}

/**
 * 从页面数据中提取按钮文案
 */
function extractButtonLabels(page) {
  const buttons = [];
  if (page.components) {
    for (const comp of page.components) {
      if (isButtonComponent(comp) && comp.label) {
        buttons.push(comp.label);
      }
    }
  }
  // 也从交互中提取有意义的 sourceLabel
  if (page.interactions) {
    for (const i of page.interactions) {
      const sl = (i.sourceLabel || '').trim();
      if (sl && BUTTON_KEYWORDS.some(kw => sl.includes(kw)) && !buttons.includes(sl)) {
        buttons.push(sl);
      }
    }
  }
  return [...new Set(buttons)];
}

/**
 * 从页面数据中提取输入字段（有标签的）
 */
function extractInputFields(page) {
  const fields = [];
  if (page.components) {
    for (const comp of page.components) {
      if (isInputComponent(comp) && comp.label && comp.label.trim()) {
        fields.push({ label: comp.label.trim(), type: comp.friendlyType });
      }
    }
  }
  return fields;
}

/**
 * 从页面数据中提取筛选条件（有标签的下拉列表等）
 */
function extractFilterFields(page) {
  const filters = [];
  if (page.components) {
    for (const comp of page.components) {
      if ((isInputComponent(comp) || comp.friendlyType === '下拉列表') && comp.label && comp.label.trim()) {
        filters.push({ label: comp.label.trim(), type: comp.friendlyType });
      }
    }
  }
  return filters;
}

/**
 * 从页面数据中提取表格列名（有意义的）
 */
function extractTableColumns(page) {
  const columns = [];
  if (page.tables) {
    for (const table of page.tables) {
      if (table.columnLabels) {
        for (const col of table.columnLabels) {
          if (col && col.trim()) columns.push(col.trim());
        }
      }
    }
  }
  if (page.repeaters) {
    for (const rep of page.repeaters) {
      if (rep.columnNames) {
        for (const col of rep.columnNames) {
          if (col && col.trim()) columns.push(col.trim());
        }
      }
    }
  }
  return [...new Set(columns)];
}

/**
 * 判断页面是否有表格/列表区域
 */
function hasTableOrList(page) {
  return (page.tables && page.tables.length > 0) || (page.repeaters && page.repeaters.length > 0);
}

/**
 * 从交互中提取页面跳转关系（业务语言）
 */
function extractPageNavigations(page) {
  const navs = [];
  if (page.interactions) {
    const linkInteractions = page.interactions.filter(i => i.action === 'linkWindow');
    const deduped = deduplicateInteractions(linkInteractions);
    for (const i of deduped) {
      const target = i.target && i.target !== '[object Object]' ? i.target : null;
      if (target) {
        navs.push({ sourceLabel: i.sourceLabel || '', target });
      }
    }
  }
  return navs;
}

/**
 * 从交互中提取业务行为描述（不暴露技术 action 名）
 */
function extractBusinessInteractions(page) {
  const businessActions = [];
  if (page.interactions) {
    const deduped = deduplicateInteractions(page.interactions);
    for (const i of deduped) {
      const sourceLabel = (i.sourceLabel || '').trim();
      if (!sourceLabel) continue; // 跳过无触发元素的交互

      const bizDesc = translateActionToBusiness(i.action);
      if (bizDesc) {
        businessActions.push(`点击"${sourceLabel}"${bizDesc}`);
      }
    }
  }
  return [...new Set(businessActions)];
}

/**
 * 推断页面的核心业务对象（从页面标题和有意义的 label 推断）
 */
function inferPageBusinessObject(page) {
  const pageName = page.pageName || '';

  // 从页面名推断
  const nameHints = ['管理', '列表', '详情', '查询', '监控', '分析', '配置', '设置', '审核', '统计'];
  for (const hint of nameHints) {
    if (pageName.includes(hint)) {
      // 提取 hint 前面的部分作为业务对象
      const idx = pageName.indexOf(hint);
      const obj = pageName.substring(0, idx);
      if (obj && obj.length >= 2) return obj;
    }
  }

  // 从有意义的 label 推断
  const labels = extractMeaningfulLabels(page);
  if (labels.length > 0) {
    // 取第一个有意义的标签作为线索
    return null; // 无法确定，返回 null
  }

  return null;
}

/**
 * 推断模块定位（从 sitemap 模块名和页面名保守生成）
 */
function inferModulePositionStatic(moduleName, pages) {
  // 仅从模块名和页面名推断，不从 visibleText 推断
  const pageNames = pages.map(p => p.pageName);

  if (moduleName === '独立页面') {
    return '独立功能页面，需结合业务材料确认具体定位';
  }

  // 从模块名推断
  const moduleHints = {
    '监控': '业务监控与状态跟踪',
    '质检': '质量检测与审核管理',
    '设备': '设备信息管理',
    '数据': '数据统计与分析',
    '系统': '系统配置与权限管理',
    '服务': '服务管理与评价',
    '用户': '用户管理与认证',
    '订单': '订单处理与跟踪',
    '报表': '报表生成与查看',
    '设置': '系统参数配置',
  };

  for (const [keyword, desc] of Object.entries(moduleHints)) {
    if (moduleName.includes(keyword)) {
      return desc;
    }
  }

  // 从页面名推断
  const allPageNames = pageNames.join('');
  for (const [keyword, desc] of Object.entries(moduleHints)) {
    if (allPageNames.includes(keyword)) {
      return desc;
    }
  }

  return `${moduleName}相关功能，需结合业务材料确认具体定位`;
}

/**
 * 从页面数据推断功能清单（用业务语言描述）
 */
function inferModuleFunctions(pages) {
  const functions = new Set();

  for (const page of pages) {
    const buttons = extractButtonLabels(page);
    for (const btn of buttons) {
      // 将按钮文案转为功能描述
      if (btn.includes('新增') || btn.includes('添加')) functions.add('新增');
      else if (btn.includes('编辑') || btn.includes('修改')) functions.add('编辑');
      else if (btn.includes('删除')) functions.add('删除');
      else if (btn.includes('查询') || btn.includes('搜索')) functions.add('查询/搜索');
      else if (btn.includes('导出')) functions.add('导出');
      else if (btn.includes('导入')) functions.add('导入');
      else if (btn.includes('审核')) functions.add('审核');
      else if (btn.includes('启用') || btn.includes('停用')) functions.add('启用/停用');
      else if (btn.includes('保存') || btn.includes('提交')) functions.add('保存/提交');
      else if (btn.includes('重置')) functions.add('重置');
      else if (btn.includes('刷新')) functions.add('刷新');
      else if (btn.includes('下载')) functions.add('下载');
      else if (btn.includes('上传')) functions.add('上传');
      else if (btn.includes('分配')) functions.add('分配');
      else if (btn.includes('同步')) functions.add('同步');
      else if (btn.includes('关闭') || btn.includes('取消')) { /* 不作为功能 */ }
      else if (btn.includes('确定') || btn.includes('确认')) { /* 不作为功能 */ }
      else functions.add(btn);
    }

    // 从页面名推断
    const pn = page.pageName;
    if (pn.includes('详情')) functions.add('查看详情');
    if (pn.includes('列表') || hasTableOrList(page)) functions.add('列表查看');
    if (pn.includes('统计') || pn.includes('分析')) functions.add('数据统计');
    if (pn.includes('监控')) functions.add('实时监控');
    if (pn.includes('配置') || pn.includes('设置')) functions.add('参数配置');
  }

  return [...functions];
}

/**
 * 构建单个页面的说明（static-prototype 模式）
 */
function buildPageDescriptionStatic(page, confirmItems, moduleName) {
  let md = '';
  md += `##### ${page.pageName}\n\n`;

  // 页面用途
  const bizObj = inferPageBusinessObject(page);
  md += `- **页面用途**: ${bizObj ? `${bizObj}相关操作页面` : '需结合业务材料确认页面用途'}\n`;

  // 主要展示内容
  const labels = extractMeaningfulLabels(page);
  if (labels.length > 0) {
    md += `- **主要展示内容**: ${labels.slice(0, 10).join('、')}\n`;
  }

  // 查询/筛选区域
  const filters = extractFilterFields(page);
  if (filters.length > 0) {
    md += `- **查询/筛选区域**: ${filters.map(f => f.label).join('、')}\n`;
  }

  // 表单/录入项
  const inputs = extractInputFields(page);
  if (inputs.length > 0) {
    md += `- **表单/录入项**: ${inputs.map(f => `${f.label}(${f.type})`).join('、')}\n`;
  }

  // 列表/表格区域
  if (hasTableOrList(page)) {
    const columns = extractTableColumns(page);
    if (columns.length > 0) {
      md += `- **列表/表格区域**: 包含 ${columns.length} 个字段 — ${columns.slice(0, 10).join('、')}${columns.length > 10 ? '等' : ''}\n`;
    } else {
      md += `- **列表/表格区域**: 原型存在表格/列表区域，字段需结合页面视觉稿或业务材料补充\n`;
      // 只在字段完全无法识别时添加确认项
      confirmItems.push(`[${page.pageName}] 表格字段完全无法识别，需结合视觉稿补充`);
    }
  }

  // 主要操作
  const buttons = extractButtonLabels(page);
  if (buttons.length > 0) {
    md += `- **主要操作**: ${buttons.join('、')}\n`;
  } else {
    // 检查是否有关键按钮缺失
    const hasInteraction = page.interactions && page.interactions.length > 0;
    if (hasInteraction) {
      confirmItems.push(`[${page.pageName}] 关键按钮文案缺失，需结合视觉稿确认操作项`);
    }
  }

  // 弹窗/页签/状态切换
  if (page.dynamicPanels && page.dynamicPanels.length > 0) {
    const panelDescs = [];
    for (const dp of page.dynamicPanels) {
      const use = inferDynamicPanelBusinessUse(dp.label, dp.stateLabels);
      panelDescs.push(use);
    }
    const uniqueDescs = [...new Set(panelDescs)];
    md += `- **弹窗/页签/状态切换**: ${uniqueDescs.join('、')}\n`;
  }

  // 跳转关系
  const navs = extractPageNavigations(page);
  if (navs.length > 0) {
    const navDescs = navs.map(n => {
      const label = n.sourceLabel ? `点击"${n.sourceLabel}"` : '操作后';
      return `${label}跳转至"${n.target}"`;
    });
    md += `- **跳转关系**: ${navDescs.join('；')}\n`;
  } else {
    // 检查是否有 linkWindow 但 target 为空
    const linkNoTarget = page.interactions && page.interactions.filter(i =>
      i.action === 'linkWindow' && (!i.target || i.target === '[object Object]')
    );
    if (linkNoTarget && linkNoTarget.length > 0) {
      confirmItems.push(`[${page.pageName}] 页面跳转目标无法判断，可能影响流程闭环`);
    }
  }

  md += '\n';
  return md;
}

// ============================================================================
// static-prototype 模式：主构建函数
// ============================================================================

/**
 * 构建模块说明（static-prototype 模式）
 * 按页面组织，用业务语言描述，确认项降噪
 */
function buildModuleSectionsStatic(ctx, modules, packPaths) {
  let md = '';
  md += `## 3. 业务模块说明\n\n`;

  const allConfirmItems = []; // { module, text }

  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi];
    md += `### ${mod.moduleName}\n\n`;

    // 收集模块内所有页面的数据
    const modulePages = [];
    for (const pageRef of mod.pages) {
      const pageData = findPageData(ctx, pageRef.pageName);
      if (pageData) modulePages.push(pageData);
    }

    // 模块定位
    md += `#### 模块定位\n\n`;
    md += `${inferModulePositionStatic(mod.moduleName, modulePages)}\n\n`;

    // 页面范围
    md += `#### 页面范围\n\n`;
    for (const pageRef of mod.pages) {
      md += `- ${pageRef.pageName}\n`;
    }
    md += '\n';

    // 核心业务对象
    md += `#### 核心业务对象\n\n`;
    const bizObjects = new Set();
    for (const page of modulePages) {
      const obj = inferPageBusinessObject(page);
      if (obj) bizObjects.add(obj);
    }
    if (bizObjects.size > 0) {
      md += `${[...bizObjects].join('、')}\n\n`;
    } else {
      md += `需结合业务材料确认\n\n`;
      allConfirmItems.push({ module: mod.moduleName, text: `[${mod.moduleName}] 页面主体业务对象无法判断，需结合业务材料确认` });
    }

    // 功能清单
    md += `#### 功能清单\n\n`;
    const functions = inferModuleFunctions(modulePages);
    if (functions.length > 0) {
      for (const f of functions) {
        md += `- ${f}\n`;
      }
    } else {
      md += `- 需结合业务材料确认功能点\n`;
    }
    md += '\n';

    // 页面说明
    md += `#### 页面说明\n\n`;
    const moduleConfirmItems = [];
    for (const page of modulePages) {
      md += buildPageDescriptionStatic(page, moduleConfirmItems, mod.moduleName);
    }

    // 如果模块没有页面数据
    if (modulePages.length === 0 && mod.pages.length > 0) {
      md += `_页面数据未找到，请检查上下文文件_\n\n`;
    }

    // 需业务确认（每模块最多5条）
    md += `#### 需业务确认\n\n`;
    // 去重
    const uniqueConfirms = [...new Set(moduleConfirmItems)];
    const limitedConfirms = uniqueConfirms.slice(0, 5);
    if (limitedConfirms.length > 0) {
      for (const item of limitedConfirms) {
        md += `- ${item}\n`;
        allConfirmItems.push({ module: mod.moduleName, text: item });
      }
    } else {
      md += `_无_\n`;
    }
    md += '\n';
  }

  // 全篇确认项不超过25条
  const dedupedAll = [];
  const seenTexts = new Set();
  for (const item of allConfirmItems) {
    if (!seenTexts.has(item.text)) {
      seenTexts.add(item.text);
      dedupedAll.push(item);
    }
  }
  const finalConfirmItems = dedupedAll.slice(0, 25);

  return { md, manualConfirmItems: finalConfirmItems };
}

/**
 * 构建共性页面模式（static-prototype 模式）
 * 从页面数据中推断共性模式，用业务语言描述
 */
function buildCommonPagePatterns(ctx, modules) {
  let md = '';
  md += `## 4. 共性页面模式\n\n`;

  const patterns = [];

  // 收集所有页面
  const allPages = ctx.pages;

  // 1. 左侧菜单导航
  const navInteractions = allPages.reduce((count, page) => {
    return count + page.interactions.filter(i => i.action === 'linkWindow').length;
  }, 0);
  if (navInteractions > 3) {
    patterns.push(`- **左侧菜单导航**: 多个页面存在导航跳转，推测采用左侧菜单导航结构`);
  }

  // 2. 顶部栏
  const hasTopBar = allPages.some(p =>
    p.components && p.components.some(c => c.label && (c.label.includes('首页') || c.label.includes('退出') || c.label.includes('用户')))
  );
  if (hasTopBar) {
    patterns.push(`- **顶部栏**: 页面存在首页/退出/用户等元素，推测存在顶部导航栏`);
  }

  // 3. 查询条件区
  const pagesWithFilters = allPages.filter(p => {
    const filters = extractFilterFields(p);
    return filters.length >= 2;
  });
  if (pagesWithFilters.length >= 2) {
    patterns.push(`- **查询条件区**: ${pagesWithFilters.length} 个页面存在多个筛选条件，推测采用查询条件区+列表的标准布局`);
  }

  // 4. 表格列表区
  const pagesWithTables = allPages.filter(p => hasTableOrList(p));
  if (pagesWithTables.length >= 2) {
    patterns.push(`- **表格列表区**: ${pagesWithTables.length} 个页面存在表格/列表区域，数据以表格形式展示`);
  }

  // 5. 新增/编辑/删除/查看操作
  const crudPages = allPages.filter(p => {
    const buttons = extractButtonLabels(p);
    return buttons.some(b => ['新增', '编辑', '修改', '删除', '查看'].some(kw => b.includes(kw)));
  });
  if (crudPages.length >= 2) {
    patterns.push(`- **新增/编辑/删除/查看操作**: ${crudPages.length} 个页面存在增删改查操作按钮`);
  }

  // 6. 弹窗确认
  const pagesWithDialogs = allPages.filter(p =>
    p.dynamicPanels && p.dynamicPanels.some(dp => {
      const use = inferDynamicPanelBusinessUse(dp.label, dp.stateLabels);
      return use === '弹窗';
    })
  );
  if (pagesWithDialogs.length >= 1) {
    patterns.push(`- **弹窗确认**: ${pagesWithDialogs.length} 个页面存在弹窗交互`);
  }

  // 7. 状态开关
  const pagesWithToggle = allPages.filter(p =>
    p.interactions && p.interactions.some(i => i.action === 'setFunction' || i.action === 'setSelected')
  );
  if (pagesWithToggle.length >= 1) {
    patterns.push(`- **状态开关**: ${pagesWithToggle.length} 个页面存在状态切换操作`);
  }

  // 8. 统计卡片/大屏
  const pagesWithStats = allPages.filter(p => {
    const pn = p.pageName || '';
    return pn.includes('统计') || pn.includes('大屏') || pn.includes('监控') || pn.includes('概览');
  });
  if (pagesWithStats.length >= 1) {
    patterns.push(`- **统计卡片/大屏**: ${pagesWithStats.length} 个页面可能包含统计卡片或大屏展示`);
  }

  if (patterns.length > 0) {
    md += patterns.join('\n') + '\n\n';
  } else {
    md += `_未识别到明显共性页面模式_\n\n`;
  }

  return md;
}

/**
 * 构建后续补充材料建议（static-prototype 模式）
 */
function buildSupplementSuggestions(ctx, modules, confirmItems) {
  let md = '';
  md += `## 5. 后续补充材料建议\n\n`;

  const suggestions = [];

  // 根据确认项推断需要补充的材料
  const confirmTexts = confirmItems.map(i => (typeof i === 'string' ? i : i.text || '')).join('');

  if (confirmTexts.includes('视觉稿')) {
    suggestions.push(`- **视觉稿/设计稿**: 多处页面字段和操作项需结合视觉稿确认，建议补充完整的设计稿`);
  } else {
    suggestions.push(`- **视觉稿/设计稿**: 原型解析无法获取完整视觉信息，建议补充设计稿以确认布局和字段`);
  }

  if (confirmTexts.includes('业务材料') || confirmTexts.includes('业务对象')) {
    suggestions.push(`- **业务流程图**: 部分模块业务对象不明确，建议补充业务流程图以明确业务范围`);
  }

  if (confirmTexts.includes('跳转') || confirmTexts.includes('流程闭环')) {
    suggestions.push(`- **业务流程图**: 页面跳转关系不完整，建议补充业务流程图以确认流程闭环`);
  }

  // 通用建议
  const hasTables = ctx.pages.some(p => hasTableOrList(p));
  if (hasTables) {
    suggestions.push(`- **数据字典**: 页面存在多个表格/列表，建议补充数据字典以明确字段定义和业务含义`);
  }

  const hasForms = ctx.pages.some(p => extractInputFields(p).length > 0);
  if (hasForms) {
    suggestions.push(`- **字段校验规则**: 页面存在表单录入，建议补充字段校验规则（必填、格式、范围等）`);
  }

  const hasDynamicPanels = ctx.pages.some(p => p.dynamicPanels && p.dynamicPanels.length > 0);
  if (hasDynamicPanels) {
    suggestions.push(`- **交互说明文档**: 页面存在弹窗/页签/状态切换等交互，建议补充交互说明文档`);
  }

  // 去重
  const uniqueSuggestions = [...new Set(suggestions)];
  for (const s of uniqueSuggestions) {
    md += `${s}\n`;
  }
  md += '\n';

  return md;
}

// ============================================================================
// 主函数
// ============================================================================

function main() {
  const args = parseArgs(process.argv);

  console.log('=== Axure 需求文档生成器 ===');
  console.log(`输入目录:     ${args.input}`);
  console.log(`上下文文件:   ${args.context}`);
  console.log(`输出路径:     ${args.output || '(自动)'}`);
  console.log(`指定模块:     ${args.modules ? args.modules.join(', ') : '全部'}`);
  console.log(`文档类型:     ${args.docType}`);
  console.log(`跳过 Pack:    ${args.noPack}`);
  console.log(`模块字符上限: ${args.maxCharsPerModule}`);
  console.log(`生成模式:     ${args.mode}`);
  console.log('');

  // 检查 --input 目录
  if (!fs.existsSync(path.resolve(args.input))) {
    console.warn(`WARN: 输入目录不存在: ${args.input}（不影响已有 context）`);
  }

  // 加载上下文
  const ctx = loadContext(args.context);
  console.log(`已加载上下文: ${ctx.pages.length} 个页面, ${ctx.document.sitemap.length} 个 sitemap 条目`);

  // 识别模块
  const { projectName, modules } = identifyModules(ctx.document.sitemap);
  console.log(`项目名称: ${projectName || '(未识别)'}`);
  console.log(`识别到 ${modules.length} 个模块:`);
  for (const mod of modules) {
    console.log(`  - ${mod.moduleName} (${mod.pages.length} 个页面)`);
  }

  // 过滤模块（如果指定了 --modules）
  let filteredModules = modules;
  if (args.modules && args.modules.length > 0) {
    filteredModules = modules.filter(m => args.modules.includes(m.moduleName));
    const notFound = args.modules.filter(m => !modules.some(mod => mod.moduleName === m));
    if (notFound.length > 0) {
      console.warn(`WARN: 以下模块未找到: ${notFound.join(', ')}`);
    }
    console.log(`过滤后保留 ${filteredModules.length} 个模块`);
  }

  // 生成 context packs
  console.log('\n--- 生成 Context Packs ---');
  const packPaths = generatePacks(args, filteredModules, args.context);

  // 确定项目名
  const finalProjectName = projectName || path.basename(path.resolve(args.input));

  // 确定输出路径
  const outputPath = args.output || path.join('outputs', `${finalProjectName}_${args.docType}.md`);

  // 构建需求文档
  console.log('\n--- 构建需求文档 ---');
  let md = '';
  let manualConfirmItems = [];

  if (args.mode === 'static-prototype') {
    // static-prototype 模式：需求初稿风格

    // 1. 项目概述
    md += buildProjectOverview(finalProjectName, ctx, args.docType);

    // 2. 信息架构
    md += buildInformationArchitecture(ctx.document.sitemap);

    // 3. 业务模块说明
    const staticResult = buildModuleSectionsStatic(ctx, filteredModules, packPaths);
    md += staticResult.md;
    manualConfirmItems = staticResult.manualConfirmItems;

    // 4. 共性页面模式
    md += buildCommonPagePatterns(ctx, filteredModules);

    // 5. 后续补充材料建议
    md += buildSupplementSuggestions(ctx, filteredModules, manualConfirmItems);

  } else {
    // strict 模式：原有行为（Axure 解析报告风格）

    // 1. 项目概述
    md += buildProjectOverview(finalProjectName, ctx, args.docType);

    // 2. 信息架构
    md += buildInformationArchitecture(ctx.document.sitemap);

    // 3. 模块说明
    const { md: moduleMd, manualConfirmItems: strictConfirmItems } = buildModuleSections(ctx, filteredModules, packPaths);
    md += moduleMd;
    manualConfirmItems = strictConfirmItems;

    // 4. 全局交互与共性规则
    md += buildGlobalInteractions(ctx, filteredModules);

    // 5. 低置信度/待确认内容
    md += buildLowConfidenceSection(manualConfirmItems);
  }

  // 写入输出文件
  const resolvedOutputPath = path.resolve(outputPath);
  const outputDir = path.dirname(resolvedOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(resolvedOutputPath, md, 'utf-8');

  // 统计
  const charCount = md.length;
  const chineseChars = (md.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (md.match(/[a-zA-Z]+/g) || []).length;
  const estimatedWords = chineseChars + englishWords;

  console.log(`\n需求文档已生成: ${resolvedOutputPath}`);
  console.log(`文档统计: ~${estimatedWords} 词 (${charCount} 字符)`);
  console.log(`待确认项: ${manualConfirmItems.length} 条`);
  console.log('\n=== 需求文档生成完成 ===');
}

main();
