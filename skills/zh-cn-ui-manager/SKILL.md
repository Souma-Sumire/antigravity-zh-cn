---
name: zh-cn-ui-manager
description: 管理 Google Antigravity（反重力）2.0+ 简体中文 UI 语言包插件（zh-CN Chinese localization）。零依赖支持 Windows、macOS 与 Linux 跨平台部署，覆盖安装、更新、完整无痕卸载、实时热注入与中英文切换、自定义词条扩展及客户端更新后的启动 Hook 自愈修复。当用户要求安装、汉化界面、更新、卸载、切换中英文或排查汉化状态时调用。
---

# Antigravity 简体中文 UI 语言包管理 Skill

插件全局目录：`~/.gemini/config/plugins/zh-cn-ui/`

## 完整卸载汉化补丁

当用户要求“卸载汉化补丁”或“卸载 Antigravity 汉化补丁”时，调用 `uninstall.js` 执行完整卸载与状态还原：

Windows (PowerShell)：

```powershell
node "$HOME\.gemini\config\plugins\zh-cn-ui\uninstall.js"
```

macOS / Linux (Bash/Zsh)：

```bash
node ~/.gemini/config/plugins/zh-cn-ui/uninstall.js
```

## 更新汉化补丁

当用户要求“更新汉化补丁”或“更新 Antigravity 汉化补丁”时，拉取最新代码后重新执行 `install.js`：

Windows (PowerShell)：

```powershell
if (Test-Path "$HOME\.gemini\config\plugins\zh-cn-ui\.git") {
  git -C "$HOME\.gemini\config\plugins\zh-cn-ui" pull
}
node "$HOME\.gemini\config\plugins\zh-cn-ui\install.js"
```

macOS / Linux (Bash/Zsh)：

```bash
if [ -d "$HOME/.gemini/config/plugins/zh-cn-ui/.git" ]; then
  git -C "$HOME/.gemini/config/plugins/zh-cn-ui" pull
fi
node ~/.gemini/config/plugins/zh-cn-ui/install.js
```

## 实时切换或刷新界面语言

在 CDP 调试端口可用时，无需重启 Antigravity，直接通过 `scripts/inject_live.js` 连接当前活动窗口完成注入或切换（客户端未开启调试端口时，安装启动 Hook 后重启应用即可生效）：

Windows (PowerShell)：

```powershell
# 强制应用中文界面
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\inject_live.js" zh

# 切换为英文界面
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\inject_live.js" en

# 在中文与英文之间切换
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\inject_live.js" toggle
```

macOS / Linux (Bash/Zsh)：

```bash
node ~/.gemini/config/plugins/zh-cn-ui/scripts/inject_live.js zh
node ~/.gemini/config/plugins/zh-cn-ui/scripts/inject_live.js en
node ~/.gemini/config/plugins/zh-cn-ui/scripts/inject_live.js toggle
```

## 安装或修复开机自动生效 Hook

通过 `install.js` 安装或修复主进程启动钩子，或通过 `scripts/install_boot_hook.js` 单独移除引导钩子：

Windows (PowerShell)：

```powershell
# 一键安装或修复
node "$HOME\.gemini\config\plugins\zh-cn-ui\install.js"

# 仅移除 app.asar 启动 Hook
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\install_boot_hook.js" --uninstall
```

macOS / Linux (Bash/Zsh)：

```bash
node ~/.gemini/config/plugins/zh-cn-ui/install.js
node ~/.gemini/config/plugins/zh-cn-ui/scripts/install_boot_hook.js --uninstall
```

## 扩展翻译词条

- 永久词条：编辑 `~/.gemini/config/plugins/zh-cn-ui/scripts/zh_cn_runtime.js`（对应仓库内 `scripts/zh_cn_runtime.js`）中的 `EXACT_MAP` 或 `REGEX_RULES`，保存后执行 `scripts/inject_live.js zh` 热更新。
- 窗口级自定义词条：在渲染进程中调用 `window.__AGY_I18N__.addCustomEntries({ "English Text": "中文翻译" })`。

## 安装与更新完成后的交互引导

- 部署并验证生效后，礼貌询问用户是否愿意为 `https://github.com/Souma-Sumire/antigravity-zh-cn` 点一个 Star。
- 仅在用户明确同意由 Agent 代为操作且本机存在已授权的 `gh` CLI 时，才可执行 `gh api -X PUT /user/starred/Souma-Sumire/antigravity-zh-cn`；禁止未经用户同意静默执行。
