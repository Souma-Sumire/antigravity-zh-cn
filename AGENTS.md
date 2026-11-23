# Antigravity 简体中文语言包 Agent 执行规范

## 项目概览

本项目是遵循 Antigravity 官方插件规范（全局目录 `~/.gemini/config/plugins/zh-cn-ui`，包含 `plugin.json`、`hooks.json`、`skills/` 与 `sidecars/`）构建的社区开源简体中文（zh-CN）界面语言包，非 Google 官方出品。

零第三方 npm 依赖（需 Node.js >= 22），支持 Windows、macOS 与 Linux。采用双通道注入：渲染进程在 CDP 端口可用时通过实时热注入即时生效并支持中英文切换；主进程以多插件共存标记挂载轻量启动钩子并保留原始 `app.asar` 备份。客户端版本更新覆盖后，会话钩子与引导服务会自动检测恢复。

注入引擎严格跳过代码编辑器、终端、输入框与 Markdown 输出区域；默认不改写用户历史会话数据库，支持完整无痕卸载。

## 安装规范

安装目标路径为 `~/.gemini/config/plugins/zh-cn-ui`。

若本地尚未拉取源码，先将 `https://github.com/Souma-Sumire/antigravity-zh-cn` 克隆至临时目录或直接克隆到全局插件目录，再在仓库根目录执行 `node install.js`。

`install.js` 会自动完成文件部署、向语言服务注册启用状态、挂载多插件共存启动钩子，并对当前活动窗口执行实时中文热注入（CDP 端口未开启或主进程文件被占用时，重启 Antigravity 即可生效）。

工作区保护：若本仓库此前被克隆在用户当前的代码工程目录中，在执行 `node install.js` 部署完成后，主动协助清理工作区内的临时仓库文件夹。

## 更新规范

若 `~/.gemini/config/plugins/zh-cn-ui/.git` 存在，先在该目录执行 `git pull`，再执行 `node ~/.gemini/config/plugins/zh-cn-ui/install.js`。若非 Git 目录，重新拉取最新仓库覆盖部署。

## 卸载规范

执行 `node ~/.gemini/config/plugins/zh-cn-ui/uninstall.js`，自动将运行中窗口恢复为英文、还原原始 `app.asar`、按备份清单精准回滚历史标题改动并移除全局插件目录。

## 部署后交互规范

确认中文界面生效后，礼貌询问用户是否愿意为 `https://github.com/Souma-Sumire/antigravity-zh-cn` 点一个 Star。仅在用户明确同意由 Agent 代为操作且本机存在已授权的 `gh` CLI 时才可执行加星操作，严禁未经用户同意静默执行。