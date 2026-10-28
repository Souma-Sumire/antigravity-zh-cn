# Antigravity 简体中文语言包开发与维护交接文档

本文档面向后续接手此项目的开发者与 AI Agent，详细记录系统架构、运行机制、新版本迭代流程及故障排查指南。

---

## 1. 项目架构全景

Antigravity 采用典型 Electron 架构（主进程 Node.js + 渲染进程 Web SPA + 独立 Language Server 后台进程）。本项目通过非侵入式双通道注入，实现全界面深度汉化且不破坏原生业务逻辑与编辑器输入体验。

```
                  ┌────────────────────────────────────────┐
                  │          Antigravity 启动               │
                  └──────────────────┬─────────────────────┘
                                     │
             ┌───────────────────────┴───────────────────────┐
             ▼                                               ▼
   【主进程注入通道】                               【渲染进程热重载通道】
  app.asar -> main.js                              DevToolsActivePort (CDP)
             │                                               │
             ▼                                               ▼
     main_boot_hook.js                                zh_cn_runtime.js
  - 系统窗口菜单汉化                                  - DOM 树遍历与字典替换
  - 右键上下文菜单汉化                                - MutationObserver 响应式监听
  - 新建窗口 session preload 拦截                     - 状态变化双向追踪 (防 select 锁死)
```

---

## 2. 目录结构与职责说明

```
antigravity-zh-cn/
├── README.md                      # 用户侧文档（保持极简，用户安装/卸载提示词）
├── install.js                     # 用户侧一键安装入口
├── uninstall.js                   # 用户侧一键完整卸载与状态复原脚本
├── plugin.json                    # Antigravity 官方规范插件元数据
├── hooks.json                     # 会话级钩子定义 (session-start 触发)
├── assets/
│   └── logo.svg                   # 插件图标
├── docs/
│   └── DEVELOPMENT.md             # 开发侧完整交接技术文档（即本文档）
├── scripts/
│   ├── zh_cn_runtime.js           # 核心运行时：DOM 响应式汉化引擎、字典、正则与状态机
│   ├── main_boot_hook.js          # 主进程启动拦截补丁：系统菜单与右键菜单汉化
│   ├── install_boot_hook.js       # 主进程注入管理工具：针对 app.asar 的挂载与卸载
│   ├── install_all.js             # 复合安装器：集成文件复制、热注入、启动挂载与 RPC 激活
│   ├── inject_live.js             # CDP 通讯工具：基于 DevToolsActivePort 的无感实时注入
│   ├── session_hook.js            # hooks.json 调用的静默自愈钩子
│   └── extract_untranslated.js    # 开发侧核心工具：自动化从二进制提取 UI 字符串与词库对比
└── skills/
    └── zh-cn-ui-manager/
        └── SKILL.md               # 插件配套 Agent 技能规范
```

---

## 3. 核心机制详解

### 3.1 响应式 DOM 翻译与 Select 选项变化追踪机制

在 React 等声明式前端框架中，下拉框（Select/Dropdown）、模型切换器、模式选择器常复用同一个文本节点并直接修改 `node.nodeValue`。

- **防锁死双向记录**：在 `zh_cn_runtime.js` 中使用 `nodeMap: new WeakMap()` 保存 `{ orig, translated }`：
  1. 初始渲染时记录初始英文为 `orig`，翻译结果记录为 `translated`。
  2. 当监听到 `characterData` 变动时，对比当前 DOM 值与 `translated`：
     - 若相等，说明是汉化本身引起的微任务，直接跳过。
     - 若不相等，表明外部 React 状态主动改变了选项（例如从 `默认深色` 切换至 `Dracula`），此时将当前值识别为新的 `orig`，并动态重新计算翻译或保持原名。
- **安全过滤边界**：
  - 严格跳过代码编辑区（`code`、`pre`、`.monaco-editor`、`.xterm`、`[contenteditable="true"]`、`[data-lexical-editor="true"]`）。
  - 严禁触碰用户输入框、Markdown 输出区与图标字体（`material-symbols`、`codicon`），防止破坏编辑器代码和聊天输入。

### 3.2 双模持久化保障机制

1. **常驻注入**：
   - `install_boot_hook.js` 会在 `resources/app.asar` 头部微打补丁引入 `main_boot_hook.js`。
   - `main_boot_hook.js` 拦截 Electron 的 `Menu.setApplicationMenu` 及窗口创建的 `webPreferences.preload`，使每次启动时窗口天然加载汉化。
2. **热修复与自愈**：
   - 遇到 Antigravity 自动更新覆盖 `app.asar` 时，插件配套的 `session_hook.js` 在 Agent 会话启动时自动检测补丁状态并实现静默自愈与热重载。

---

## 4. Antigravity 新版本升级与词条维护流程

当 Antigravity 发布新版本更新时，维护者只需执行以下标准化操作：

### 第一步：全自动提取并生成未翻译清单
在项目根目录下执行开发侧提取脚本：
```bash
node scripts/extract_untranslated.js
```
- 脚本会自动定位 `language_server.exe`，从其内嵌 Zip 资源中提取最新 `main.js`（约 10MB）。
- 执行多维模式匹配（React 属性、DOM 属性、JSX 文本节点），剔除无意义代码符号。
- 与当前内置的 4,100+ 词条自动对比，在 `scripts/` 下输出：
  - `untranslated_report.json`（待翻译清单）
  - `untranslated_template.json`（填词模板）

### 第二步：翻译与校对
在 `untranslated_template.json` 中填充对应的简体中文翻译，或交给 AI Agent 进行批量高质量审校。

### 第三步：一键合并入词典
```bash
node scripts/extract_untranslated.js --merge scripts/untranslated_template.json
```
脚本会自动将翻译词条追加到 `zh_cn_runtime.js` 的 `EXACT_MAP` 中，并格式化语法树。

### 第四步：实时热重载验证
确保 Antigravity 处于开启状态，执行：
```bash
node scripts/inject_live.js zh
```
观察运行中界面的汉化呈现，验证是否有新增未覆盖文案或布局截断问题。

---

## 5. 常见问题排查与注意事项

1. **关于主题名称翻译规范**：
   - 系统主题（如 `Default Dark`、`Default Light`）应翻译为 `默认深色`、`默认浅色`。
   - 知名专有第三方主题（如 `One Dark Pro`、`One Light`、`Solarized Dark`、`Catppuccin`、`Dracula`、`Monokai`、`Tokyo Night`）必须严格保留原生名称，禁止中英混杂（如错误的 `One 深色 Pro`）。
2. **关于禁止后台进程**：
   - 本项目严禁引入后台常驻守护进程（如 `.vbs` 或隐式后台轮询），所有持久化与热恢复必须通过标准的 Electron 启动挂钩与 CDP 触发通道实现。
3. **编码规范**：
   - 所有源码与词库文件必须使用带无 BOM 的 UTF-8 编码保存，避免 Windows 控制台环境引发乱码。
