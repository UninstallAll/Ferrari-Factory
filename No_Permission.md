# No_Permission — Claude Code 全自动零确认配置

> 目标：让 Claude Code **完全自动执行任务，绝不逐条弹权限确认**。换新电脑时照本文操作即可一次到位。

---

## 一、原理（先看懂再操作）

Claude Code 是否弹确认，由 **全局配置文件** `~/.claude/settings.json` 里的 `permissions` 决定。三个关键点：

| 配置项 | 作用 | 生效时机 |
|--------|------|----------|
| `defaultMode: "bypassPermissions"` | 会话以"跳过所有确认"模式启动 | **仅新会话启动时** |
| `permissions.allow: [...]` | 列出的工具在**任何模式下**自动放行 | **实时**（改完当前会话就生效，无需重启） |
| `skipDangerousModePermissionPrompt: true` | 不再弹"危险模式"二次确认 | 启动时 |

⚠️ **关键经验**：只设 `defaultMode` 不够 —— 它只在会话**开始那一刻**生效。如果某个会话（尤其 VSCode 扩展启动的）没按 bypass 模式起，bash 还是会被拦。所以必须额外配 `allow` 列表兜底，它不挑模式、且实时读取。

---

## 二、一步到位：直接覆盖 `~/.claude/settings.json`

在新电脑上，把下面内容写进 `~/.claude/settings.json`（没有就新建；`~` 是用户主目录）。
> `model` / `effortLevel` 按需保留或删除，权限相关的是 `permissions` 整段。

```json
{
  "effortLevel": "xhigh",
  "model": "opus",
  "permissions": {
    "defaultMode": "bypassPermissions",
    "skipDangerousModePermissionPrompt": true,
    "allow": [
      "Bash",
      "Edit",
      "Write",
      "NotebookEdit",
      "WebFetch",
      "WebSearch",
      "Read",
      "Glob",
      "Grep",
      "mcp__claude_ai_Gmail",
      "mcp__claude_ai_Google_Calendar",
      "mcp__claude_ai_Google_Drive",
      "mcp__claude_ai_Notion"
    ]
  }
}
```

### allow 列表说明

- **内置工具**：`Bash`(命令) · `Edit`/`Write`/`NotebookEdit`(写文件) · `WebFetch`/`WebSearch`(联网) · `Read`/`Glob`/`Grep`(只读，本来就不问，列出以防万一)。
- **MCP 服务器**：写法 `mcp__<服务器名>` 表示**整组放行**该服务器下所有工具，不用逐个列。这里的四个是 Gmail / Google 日历 / Google Drive / Notion。
  - 如果你在别的电脑连了**不同**的 MCP 服务器，把对应名字替换上去即可。服务器名可在 Claude Code 里查看已连接的 MCP，或看工具名 `mcp__<服务器名>__<工具>` 的中间段。

---

## 三、命令行快速应用（可选，免手动编辑）

> macOS / Linux 终端。会**覆盖**现有 `~/.claude/settings.json`，已有配置请先备份。

```bash
mkdir -p ~/.claude
# 先备份（如已存在）
[ -f ~/.claude/settings.json ] && cp ~/.claude/settings.json ~/.claude/settings.json.bak

cat > ~/.claude/settings.json <<'EOF'
{
  "permissions": {
    "defaultMode": "bypassPermissions",
    "skipDangerousModePermissionPrompt": true,
    "allow": [
      "Bash", "Edit", "Write", "NotebookEdit",
      "WebFetch", "WebSearch", "Read", "Glob", "Grep",
      "mcp__claude_ai_Gmail",
      "mcp__claude_ai_Google_Calendar",
      "mcp__claude_ai_Google_Drive",
      "mcp__claude_ai_Notion"
    ]
  }
}
EOF

# 校验 JSON 合法
python3 -c "import json; json.load(open('$HOME/.claude/settings.json')); print('JSON 合法 ✓')"
```

---

## 四、验证是否生效

1. 让 Claude 跑一条无害命令（如 `ls`）——**不再弹确认框**即为成功。
2. 或在输入框按 **Shift+Tab** 循环切换权限模式，确认能切到 "bypass permissions"。

---

## 五、注意事项

1. **全局生效**：`~/.claude/settings.json` 对**所有项目**生效，不是单个项目。
2. **MCP 首次 OAuth 无法跳过**：Gmail / 日历 / Drive / Notion 第一次使用时会要求登录授权，那是 Google/Notion **服务端**要求，不是 Claude 的权限弹窗，配置层面跳不过；授权一次后不再出现。
3. **安全提醒**：bypass + 全量 allow 意味着 Claude 可以无确认地执行任何命令（包括删除文件等）。这是用最大便利换取最少打断，自行评估在不信任的环境里是否合适。
4. **作用域分层**：还可放 `项目/.claude/settings.json`（团队共享，提交 git）或 `项目/.claude/settings.local.json`（个人、不提交）。加载顺序 user → project → local，后者覆盖前者。本文用的是全局 user 级，最省事。

---

*生成于本机配置实践，可直接拷贝到任意新电脑复用。*
