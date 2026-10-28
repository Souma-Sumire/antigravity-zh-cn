---
name: zh-cn-ui-manager
description: 管理 Antigravity 简体中文 UI 语言包插件（启用/禁用中文界面、实时注入、切换中英文、完整卸载汉化补丁、扩展自定义翻译词条、修复版本更新后的启动钩子）。当用户要求安装、卸载、切换 Antigravity 界面语言或排查界面汉化状态时调用。
---

# Antigravity 简体中文 UI 语言包管理技能

插件目录：`~/.gemini/config/plugins/zh-cn-ui/`

## 1. 完整卸载汉化补丁

当用户要求“卸载汉化补丁”或“卸载 Antigravity 汉化”时，直接执行：

```powershell
node "$HOME\.gemini\config\plugins\zh-cn-ui\uninstall.js"
```

## 2. 实时切换或刷新界面语言

无需重启 Antigravity，直接通过 `inject_live.js` 连接当前活动窗口的 CDP 端口完成注入或切换：

```powershell
# 强制应用中文界面
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\inject_live.js" zh

# 切换为英文界面
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\inject_live.js" en

# 在中文与英文之间切换
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\inject_live.js" toggle
```

## 3. 安装或修复开机自动生效钩子

```powershell
# 一键安装或修复
node "$HOME\.gemini\config\plugins\zh-cn-ui\install.js"

# 仅移除 app.asar 启动钩子
node "$HOME\.gemini\config\plugins\zh-cn-ui\scripts\install_boot_hook.js" --uninstall
```

## 4. 扩展翻译词条

- 永久词条：编辑 `~/.gemini/config/plugins/zh-cn-ui/scripts/zh_cn_runtime.js` 中的 `EXACT_MAP` 或 `REGEX_RULES`，保存后执行 `inject_live.js zh` 即可热更新。
- 窗口级自定义词条：在渲染进程中调用 `window.__AGY_I18N__.addCustomEntries({ "English Text": "中文翻译" })`。
