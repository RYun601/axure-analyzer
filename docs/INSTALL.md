# 主流 Agent 安装方式

`axure-analyzer` 是标准 Agent Skill：一个目录，包含 `SKILL.md`、`scripts/`、`references/`。  
不同 Agent 的 skill 发现路径不同，但安装方式都是“把整个目录放到它的 skills 根目录”。

> 本仓库目前是单 skill，没有发布插件市场。下面的安装方式以 Agent Skills 目录为主；需要 `/plugin install` 的市场安装需要额外发布插件清单。
>
> 命令以 `RYun601/axure-analyzer` 为例；fork 后替换成你的仓库地址。

## 路径速查

| Agent | 用户级（全局） | 项目级 | 说明 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/skills` | `.claude/skills` | 官方路径 |
| OpenCode | `~/.config/opencode/skills` 或 `~/.agents/skills` | `.opencode/skills` 或 `.agents/skills` | 兼容 `.claude/skills`、`.agents/skills` |
| Codex | `~/.agents/skills` | `.agents/skills` | Codex 扫描仓库内 `.agents/skills`；用户级路径以版本为准 |
| Cursor | `~/.agents/skills` 或 `~/.cursor/skills` | `.agents/skills` 或 `.cursor/skills` | 兼容 `.claude/skills`、`.codex/skills` |
| Gemini CLI | `~/.agents/skills` 或 `~/.gemini/skills` | `.agents/skills` 或 `.gemini/skills` | 支持 `gemini skills install/link` |
| 其他兼容 Agent Skills 的工具 | 通常 `~/.agents/skills` | `.agents/skills` | 以工具文档为准 |

## 推荐：安装到 `~/.agents/skills`

OpenCode、Codex、Cursor、Gemini CLI 都会读取 `~/.agents/skills`，适合作为主副本。

### Windows

```powershell
git clone https://github.com/RYun601/axure-analyzer.git
cd axure-analyzer

powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -SkillsRoot "$HOME\.agents\skills" `
  -InstallDeps
```

### macOS / Linux

```bash
git clone https://github.com/RYun601/axure-analyzer.git
cd axure-analyzer

DEST="$HOME/.agents/skills/axure-analyzer"
mkdir -p "$DEST"
cp SKILL.md README.md LICENSE package.json "$DEST"/
cp -R scripts references "$DEST"/
(cd "$DEST" && npm install --omit=dev)
```

### Claude Code 额外链接

Claude Code 默认读 `~/.claude/skills`，不保证读取 `~/.agents/skills`。可以建一个目录链接：

Windows（junction）：

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
New-Item -ItemType Junction `
  -Path "$HOME\.claude\skills\axure-analyzer" `
  -Target "$HOME\.agents\skills\axure-analyzer"
```

macOS / Linux：

```bash
mkdir -p ~/.claude/skills
ln -s ~/.agents/skills/axure-analyzer ~/.claude/skills/axure-analyzer
```

这样只维护一份文件，Claude Code 也能使用。

## Claude Code

个人级：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.claude\skills" -InstallDeps
```

项目级：

```powershell
.\install.ps1 -ProjectRoot "D:\path\to\project" -InstallDeps
```

安装后路径：

```text
.claude/skills/axure-analyzer/
```

验证：在 Claude Code 中输入 `/skills`，或直接问“列出当前可用的 skills”。

## OpenCode

项目级（默认）：

```powershell
.\install.ps1 -ProjectRoot "D:\path\to\project" -InstallDeps
```

全局：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.config\opencode\skills" -InstallDeps
```

安装后路径：

```text
.opencode/skills/axure-analyzer/
```

验证：让 OpenCode 使用 `skill` 工具列出 skills，或直接问“有哪些可用 skill”。

## Codex

Codex 扫描仓库内的 `.agents/skills`。推荐安装到用户级：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

项目级：

```powershell
# 在项目根目录执行
.\install.ps1 -SkillsRoot ".agents\skills" -InstallDeps
```

验证：在 Codex CLI 中使用 `/skills`，或输入 `$` 选择 skill。

## Cursor

Cursor 会读取：

- `~/.agents/skills` / `.agents/skills`
- `~/.cursor/skills` / `.cursor/skills`
- 兼容 `~/.claude/skills`、`~/.codex/skills`

推荐安装到 `~/.agents/skills`：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

验证：Cursor Settings → Rules → Skills，或在 Agent 中输入 `/` 搜索 `axure-analyzer`。

## Gemini CLI

Gemini CLI 会读取：

- `~/.agents/skills` / `.agents/skills`
- `~/.gemini/skills` / `.gemini/skills`

推荐安装到 `~/.agents/skills`：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

也可以使用 Gemini CLI 自带命令（以本机版本为准）：

```bash
# 从本地目录链接
gemini skills link /path/to/axure-analyzer

# 或从仓库安装
gemini skills install https://github.com/RYun601/axure-analyzer.git
```

验证：`/skills list`。

## 其他 Agent

如果工具支持 Agent Skills，但没有列出专用目录，优先尝试：

```text
~/.agents/skills/axure-analyzer
```

或项目级：

```text
.agents/skills/axure-analyzer
```

如果工具完全不支持 skills：

1. 把 `SKILL.md` 作为规则/上下文文件加载；
2. 手动运行脚本：

```bash
node scripts/analyze.js --input "D:/path/to/axure-export" --output "analysis/axure" --pages "PageName"
```

## 更新

更新主副本后，重新执行安装命令即可：

```powershell
git pull
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

如果 Claude Code 使用 junction/symlink，不需要重复复制。

## 依赖

- Node.js >= 18
- 系统 Chrome 或 Edge
- `npm install`（安装 `playwright-core`）
- OCR 可选：`python -m pip install rapidocr_onnxruntime`

`install.ps1 -InstallDeps` 会自动在目标 skill 目录执行 `npm install`。
