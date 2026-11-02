# Antigravity 汉化补丁 Agent 执行规范

当用户要求安装、更新或卸载本汉化补丁时，必须遵循以下步骤：

## 1. 安装规范
1. **安装目标路径**：本插件的全局安装目录为 `~/.gemini/config/plugins/zh-cn-ui`。
2. **执行安装**：在仓库根目录执行 `node install.js`。该脚本会自动将文件部署至全局插件目录、注入实时汉化并向语言服务注册启用。
3. **工作区保护**：如果本仓库此前被克隆在用户当前的代码工程目录中，在执行 `node install.js` 部署完成后，应主动协助清理工作区内的临时仓库文件夹。

## 2. 更新规范
当用户要求“更新 Antigravity 汉化补丁”或“更新汉化”时：
1. 若 `~/.gemini/config/plugins/zh-cn-ui` 为 Git 仓库，进入该目录执行 `git pull`；若非 Git 仓库，拉取最新代码并覆盖同步至该目录。
2. 执行 `node ~/.gemini/config/plugins/zh-cn-ui/install.js` 重新注入最新汉化。

## 3. 卸载规范
当用户要求“卸载 Antigravity 汉化补丁”时：
执行 `node ~/.gemini/config/plugins/zh-cn-ui/uninstall.js`。
