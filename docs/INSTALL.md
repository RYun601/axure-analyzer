# 主流 Agent 安装方式

`axure-analyzer` 是标准 Agent Skill：一个目录，包含 `SKILL.md`、`scripts/`、`references/`。  
不同 Agent 的 skill 发现路径不同，但安装方式都是“把整个目录放到它的 skills 根目录”。

> 本仓库目前是单 skill，没有发布插件市场。下面的安装方式以 Agent Skills 目录为主；需要 `/plugin install` 的市场安装需要额外发布插件清单。
>
> 命令以 `RYun601/axure-analyzer` 为例；fork 后替换成你的仓库地址。
>
> 如果希望交给 AI 助手代为安装，直接使用 README 的「一键安装（发给 AI 助手）」段落即可。

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

### macOS

```bash
git clone https://github.com/RYun601/axure-analyzer.git
cd axure-analyzer

bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps
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

macOS：

```bash
mkdir -p ~/.claude/skills
ln -s ~/.agents/skills/axure-analyzer ~/.claude/skills/axure-analyzer
```

这样只维护一份文件，Claude Code 也能使用。

## Claude Code

个人级：

Windows：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.claude\skills" -InstallDeps
```

macOS：

```bash
bash ./install.sh --skills-root "$HOME/.claude/skills" --install-deps
```

项目级：

Windows：

```powershell
.\install.ps1 -ProjectRoot "D:\path\to\project" -InstallDeps
```

macOS：

```bash
bash ./install.sh --project-root "/path/to/project" --install-deps
```

安装后路径：

```text
.claude/skills/axure-analyzer/
```

验证：在 Claude Code 中输入 `/skills`，或直接问“列出当前可用的 skills”。

## OpenCode

项目级（默认）：

Windows：

```powershell
.\install.ps1 -ProjectRoot "D:\path\to\project" -InstallDeps
```

macOS：

```bash
bash ./install.sh --project-root "/path/to/project" --install-deps
```

全局：

Windows：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.config\opencode\skills" -InstallDeps
```

macOS：

```bash
bash ./install.sh --skills-root "$HOME/.config/opencode/skills" --install-deps
```

安装后路径：

```text
.opencode/skills/axure-analyzer/
```

验证：让 OpenCode 使用 `skill` 工具列出 skills，或直接问“有哪些可用 skill”。

## Codex

Codex 扫描仓库内的 `.agents/skills`。推荐安装到用户级：

Windows：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

macOS：

```bash
bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps
```

项目级：

Windows：

```powershell
# 在项目根目录执行
.\install.ps1 -SkillsRoot ".agents\skills" -InstallDeps
```

macOS：

```bash
# 在项目根目录执行
bash ./install.sh --skills-root ".agents/skills" --install-deps
```

验证：在 Codex CLI 中使用 `/skills`，或输入 `$` 选择 skill。

## Cursor

Cursor 会读取：

- `~/.agents/skills` / `.agents/skills`
- `~/.cursor/skills` / `.cursor/skills`
- 兼容 `~/.claude/skills`、`~/.codex/skills`

推荐安装到 `~/.agents/skills`：

Windows：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

macOS：

```bash
bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps
```

验证：Cursor Settings → Rules → Skills，或在 Agent 中输入 `/` 搜索 `axure-analyzer`。

## Gemini CLI

Gemini CLI 会读取：

- `~/.agents/skills` / `.agents/skills`
- `~/.gemini/skills` / `.gemini/skills`

推荐安装到 `~/.agents/skills`：

Windows：

```powershell
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

macOS：

```bash
bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps
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

更新主副本后，重新执行安装命令即可。

Windows：

```powershell
git pull
.\install.ps1 -SkillsRoot "$HOME\.agents\skills" -InstallDeps
```

macOS：

```bash
git pull
bash ./install.sh --skills-root "$HOME/.agents/skills" --install-deps
```

如果 Claude Code 使用 junction/symlink，不需要重复复制。

## 依赖

- Node.js >= 18
- 系统 Chrome 或 Edge
- `npm install`（安装 `playwright-core`）
- OCR 可选：`python -m pip install rapidocr_onnxruntime`

`install.ps1 -InstallDeps` 或 `install.sh --install-deps` 会自动在目标 skill 目录执行 `npm install`。
