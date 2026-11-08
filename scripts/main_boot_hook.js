'use strict';

const electron = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

if (!global.__AGY_ZH_CN_MAIN_HOOK_LOADED__) {
  global.__AGY_ZH_CN_MAIN_HOOK_LOADED__ = true;

  const MENU_MAP = {
    'Copy Project Name': '复制项目名称',
    'Project Settings': '项目设置',
    'Delete Project': '删除项目',
    'Archive Project': '归档项目',
    'Unarchive Project': '取消归档项目',
    'Copy Workspace Name': '复制工作区名称',
    'Workspace Settings': '工作区设置',
    'Delete Workspace': '删除工作区',
    'Archive Workspace': '归档工作区',
    'Unarchive Workspace': '取消归档工作区',
    'Copy Folder Name': '复制文件夹名称',
    'Edit Folder Name': '编辑文件夹名称',
    'Delete Folder': '删除文件夹',
    'Copy Group Name': '复制分组名称',
    'Rename Group': '重命名分组',
    'Delete Group': '删除分组',
    'Rename': '重命名',
    'Pin': '置顶',
    'Unpin': '取消置顶',
    'Mark Unread': '标记为未读',
    'Mark Read': '标记为已读',
    'Mark as Unread': '标记为未读',
    'Mark as Read': '标记为已读',
    'Split': '分屏',
    'Archive': '归档',
    'Unarchive': '取消归档',
    'Archive Conversation': '归档对话',
    'Unarchive Conversation': '取消归档对话',
    'Delete Conversation': '删除对话',
    'Projects (Archived)': '项目 (已归档)',
    'Workspaces (Archived)': '工作区 (已归档)',
    'Conversations (Archived)': '对话 (已归档)',
    'Marked 1 conversation as read': '已将 1 个对话标记为已读',
    'Marked 1 conversation as unread': '已将 1 个对话标记为未读',
    'Only the conversation will be rewound; your files will be left as-is.': '仅撤回对话；您的文件将保持原样。',
    'Right': '向右',
    'Down': '向下',
    'Up': '向上',
    'Left': '向左',
    'Split Right': '向右分屏',
    'Split Down': '向下分屏',
    'Split Up': '向上分屏',
    'Split Left': '向左分屏',
    'Move to New Window': '移动到新窗口',
    'Open in New Window': '在新窗口中打开',
    'Duplicate': '创建副本',
    'Duplicate Conversation': '创建对话副本',
    'Copy Conversation Name': '复制对话名称',
    'Copy Conversation ID': '复制对话 ID',
    'Copy Conversation Link': '复制对话链接',
    'Restore': '恢复',
    'Restore Conversation': '恢复对话',
    'Delete Permanently': '永久删除',
    'Permanently Delete': '永久删除',
    'Delete Permanently...': '永久删除...',
    'Permanently Delete...': '永久删除...',
    'Delete Conversation Permanently': '永久删除对话',
    'Permanently Delete Conversation': '永久删除对话',
    'Move Up': '上移',
    'Move Down': '下移',
    'Show in File Explorer': '在文件资源管理器中显示',
    'Reveal in Finder': '在访达中显示',
    'Show in File Manager': '在文件管理器中显示',
    'Open in Cider': '在 Cider 中打开',
    'Open in VS Code': '在 VS Code 中打开',
    'Conversation ID': '对话 ID',
    'Conversation Name': '对话名称',
    'Replace with New': '替换为新对话',
    'Remove from Split': '从分屏中移除',
    'File': '文件(F)',
    'Edit': '编辑(E)',
    'View': '视图(V)',
    'Window': '窗口(W)',
    'Help': '帮助(H)',
    'New Window': '新建窗口',
    'Connect to WSL': '连接到 WSL',
    'Reopen Locally': '在本地重新打开',
    'Docs': '官方文档',
    'Check for Updates': '检查更新',
    'Checking for Updates...': '正在检查更新...',
    'Downloading Update...': '正在下载更新...',
    'Restart to Update': '重启以完成更新',
    'Quit': '退出',
    'Exit': '退出',
    'No agents running': '无运行中的 Agent',
    'Open Antigravity': '打开 Antigravity',
    'Undo': '撤销',
    'Redo': '重做',
    'Cut': '剪切',
    'Copy': '复制',
    'Paste': '粘贴',
    'Delete': '删除',
    'Select All': '全选',
    'Reload': '重新加载',
    'Force Reload': '强制重新加载',
    'Toggle Developer Tools': '切换开发者工具',
    'Actual Size': '实际大小',
    'Reset Zoom': '重置缩放',
    'Zoom In': '放大',
    'Zoom Out': '缩小',
    'Toggle Full Screen': '切换全屏',
    'Minimize': '最小化',
    'Zoom': '缩放',
    'Close': '关闭',
    'Back': '后退',
    'Forward': '前进',
    'Settings': '设置',
    'Copy Link': '复制链接',
    'Copy Link Address': '复制链接地址',
    'Copy Image': '复制图片',
    'Open in': '打开方式',
    'Open in Side Panel': '在侧边面板中打开',
    'Open in External Browser': '在外部浏览器中打开',
    'Open in New Tab': '在新标签页中打开',
    'Open in Built-in Browser': '在内置浏览器中打开',
    'Side Panel': '侧边面板',
    'Side Panel (Default)': '侧边面板 (默认)',
    'External Browser': '外部浏览器',
    'External Browser (Default)': '外部浏览器 (默认)',
    'Built-in Browser': '内置浏览器',
    'Built-in Browser (Default)': '内置浏览器 (默认)',
    'New Tab': '新标签页',
    'New Tab (Default)': '新标签页 (默认)',
    'Add to Chat': '添加到对话',
    'Quote Selection': '引用选中内容',
    'Open in Code Search': '在代码搜索中打开',
    'Comment on Selection': '评论选中内容'
  };

  const ROLE_MAP = {
    'filemenu': '文件(F)',
    'editmenu': '编辑(E)',
    'viewmenu': '视图(V)',
    'windowmenu': '窗口(W)',
    'help': '帮助(H)',
    'undo': '撤销',
    'redo': '重做',
    'cut': '剪切',
    'copy': '复制',
    'paste': '粘贴',
    'delete': '删除',
    'selectall': '全选',
    'reload': '重新加载',
    'forcereload': '强制重新加载',
    'toggledevtools': '切换开发者工具',
    'resetzoom': '实际大小',
    'zoomin': '放大',
    'zoomout': '缩小',
    'togglefullscreen': '切换全屏',
    'minimize': '最小化',
    'zoom': '缩放',
    'close': '关闭',
    'quit': '退出'
  };

  const TOP_MENU_ROLES = new Set(['filemenu', 'editmenu', 'viewmenu', 'windowmenu', 'help']);
  const TOP_MENU_LABELS = new Set(['File', 'Edit', 'View', 'Window', 'Help']);

  function translateLabelString(rawLabel) {
    if (typeof rawLabel !== 'string' || !rawLabel) return rawLabel;
    const clean = rawLabel.replace(/&/g, '');
    if (MENU_MAP[clean]) return MENU_MAP[clean];
    const tabIndex = clean.indexOf('\t');
    if (tabIndex !== -1) {
      const mainPart = clean.substring(0, tabIndex).trim();
      const extra = clean.substring(tabIndex);
      const trans = translateLabelString(mainPart);
      if (trans) return trans + extra;
    }
    const copyNameMatch = clean.match(/^Copy\s+(Project|Workspace|Folder|Group|Conversation)\s+Name$/i);
    if (copyNameMatch) {
      const nounMap = { project: '项目', workspace: '工作区', folder: '文件夹', group: '分组', conversation: '对话' };
      return `复制${nounMap[copyNameMatch[1].toLowerCase()] || copyNameMatch[1]}名称`;
    }
    const settingsMatch = clean.match(/^(Project|Workspace)\s+Settings$/i);
    if (settingsMatch) {
      return `${settingsMatch[1].toLowerCase() === 'project' ? '项目' : '工作区'}设置`;
    }
    const deleteMatch = clean.match(/^Delete\s+(Project|Workspace|Folder|Group|Conversation)$/i);
    if (deleteMatch) {
      const nounMap = { project: '项目', workspace: '工作区', folder: '文件夹', group: '分组', conversation: '对话' };
      return `删除${nounMap[deleteMatch[1].toLowerCase()] || deleteMatch[1]}`;
    }
    const deletePermMatch = clean.match(/^(?:Delete\s+(.+)\s+Permanently|Permanently\s+Delete\s+(.+))$/i);
    if (deletePermMatch) {
      const noun = (deletePermMatch[1] || deletePermMatch[2] || '').trim();
      const nounMap = { project: '项目', workspace: '工作区', folder: '文件夹', group: '分组', conversation: '对话' };
      return `永久删除${nounMap[noun.toLowerCase()] || noun}`;
    }
    const archiveMatch = clean.match(/^Archive\s+(Project|Workspace|Folder|Group|Conversation)$/i);
    if (archiveMatch) {
      const nounMap = { project: '项目', workspace: '工作区', folder: '文件夹', group: '分组', conversation: '对话' };
      return `归档${nounMap[archiveMatch[1].toLowerCase()] || archiveMatch[1]}`;
    }
    const unarchiveMatch = clean.match(/^Unarchive\s+(Project|Workspace|Folder|Group|Conversation)$/i);
    if (unarchiveMatch) {
      const nounMap = { project: '项目', workspace: '工作区', folder: '文件夹', group: '分组', conversation: '对话' };
      return `取消归档${nounMap[unarchiveMatch[1].toLowerCase()] || unarchiveMatch[1]}`;
    }
    const archivedMatch = clean.match(/^(Project|Workspace|Folder|Group|Conversation)s?\s+\(Archived\)$/i);
    if (archivedMatch) {
      const nounMap = { project: '项目', workspace: '工作区', folder: '文件夹', group: '分组', conversation: '对话' };
      return `${nounMap[archivedMatch[1].toLowerCase()] || archivedMatch[1]} (已归档)`;
    }
    const renameMatch = clean.match(/^Rename\s+(Project|Workspace|Folder|Group|Conversation)$/i);
    if (renameMatch) {
      const nounMap = { project: '项目', workspace: '工作区', folder: '文件夹', group: '分组', conversation: '对话' };
      return `重命名${nounMap[renameMatch[1].toLowerCase()] || renameMatch[1]}`;
    }
    const pinMatch = clean.match(/^Pin\s+(Conversation|Tab)$/i);
    if (pinMatch) {
      return pinMatch[1].toLowerCase() === 'conversation' ? '置顶对话' : '固定标签页';
    }
    const unpinMatch = clean.match(/^Unpin\s+(Conversation|Tab)$/i);
    if (unpinMatch) {
      return unpinMatch[1].toLowerCase() === 'conversation' ? '取消置顶对话' : '取消固定标签页';
    }
    const agentMatch = clean.match(/^(\d+)\s+agents?\s+running$/i);
 if (agentMatch) return `${agentMatch[1]} 个 Agent 运行中`;
    const openMatch = clean.match(/^Open\s+(.+)$/i);
    if (openMatch && !MENU_MAP[clean]) return `打开 ${openMatch[1]}`;
    return null;
  }

  function attachMutableLabelAccessor(menuInstance) {
    if (!menuInstance || !Array.isArray(menuInstance.items)) return menuInstance;
    for (const item of menuInstance.items) {
      if (item && item.id === 'running-agents' && !item.__agyMutableLabelAttached) {
        let currentLabel = item.label || 'No agents running';
        try {
          Object.defineProperty(item, 'label', {
            get() {
              return currentLabel;
            },
            set(val) {
              currentLabel = val;
            },
            configurable: true,
            enumerable: true
          });
          item.__agyMutableLabelAttached = true;
        } catch (_) {}
      }
    }
    return menuInstance;
  }

  function translateMenuItemOrTemplate(item, translateTopLevel) {
    if (!item || typeof item !== 'object') return item;
    const copy = Object.assign({}, item);

    const origLabel = copy.label;
    if (typeof item.click === 'function') {
      copy.click = function (menuItem, browserWindow, event) {
        const proxyItem = menuItem ? Object.create(menuItem, {
          label: { value: origLabel || menuItem.label, enumerable: true }
        }) : { label: origLabel };
        return item.click(proxyItem, browserWindow, event);
      };
    }

    const cleanLabel = typeof copy.label === 'string' ? copy.label.replace(/&/g, '') : '';
    const roleKey = typeof copy.role === 'string' ? copy.role.toLowerCase() : '';
    const isTopMenu = TOP_MENU_ROLES.has(roleKey) || TOP_MENU_LABELS.has(cleanLabel);

    if (!isTopMenu || translateTopLevel) {
      const translated = translateLabelString(cleanLabel);
      if (translated) {
        copy.label = translated;
      } else if (roleKey && ROLE_MAP[roleKey]) {
        copy.label = ROLE_MAP[roleKey];
      }
    }

    if (Array.isArray(item.submenu)) {
      copy.submenu = item.submenu.map((sub) => translateMenuItemOrTemplate(sub, false));
    } else if (item.submenu && Array.isArray(item.submenu.items)) {
      copy.submenu = item.submenu.items.map((sub) => translateMenuItemOrTemplate(sub, false));
    }

    if (translateTopLevel && roleKey && TOP_MENU_ROLES.has(roleKey) && Array.isArray(copy.submenu)) {
      delete copy.role;
    }

    return copy;
  }

  function translateMenuTemplate(items, translateTopLevel) {
    if (!Array.isArray(items)) return items;
    return items.map((item) => translateMenuItemOrTemplate(item, translateTopLevel));
  }

  try {
    if (electron.Menu && typeof electron.Menu.buildFromTemplate === 'function') {
      const origBuildFromTemplate = electron.Menu.buildFromTemplate.bind(electron.Menu);

      electron.Menu.buildFromTemplate = function (template) {
        const menu = origBuildFromTemplate(translateMenuTemplate(template, false));
        return attachMutableLabelAccessor(menu);
      };

      if (typeof electron.Menu.setApplicationMenu === 'function') {
        const origSetApplicationMenu = electron.Menu.setApplicationMenu.bind(electron.Menu);
        electron.Menu.setApplicationMenu = function (menu) {
          if (menu && Array.isArray(menu.items)) {
            const rebuilt = origBuildFromTemplate(translateMenuTemplate(menu.items, true));
            return origSetApplicationMenu(rebuilt);
          }
          return origSetApplicationMenu(menu);
        };
      }

      if (electron.Tray && electron.Tray.prototype && typeof electron.Tray.prototype.setContextMenu === 'function') {
        const origSetContextMenu = electron.Tray.prototype.setContextMenu;
        electron.Tray.prototype.setContextMenu = function (menu) {
          if (menu && Array.isArray(menu.items)) {
            attachMutableLabelAccessor(menu);
            const rebuilt = origBuildFromTemplate(translateMenuTemplate(menu.items, false));
            return origSetContextMenu.call(this, rebuilt);
          }
          return origSetContextMenu.call(this, menu);
        };
      }
    }
  } catch (_) {}

  const DIALOG_TEXT_MAP = {
    'Confirm Quit': '确认退出',
    'Are you sure you want to quit?': '确定要退出 Antigravity 吗？',
    'There may be agents or background tasks running.': '当前可能仍有 Agent 或后台任务正在运行。',
    'Check for Updates': '检查更新',
    'No updates available': '当前已是最新版本',
    'Open workspace': '打开工作区',
    'Open workspaces': '打开工作区',
    'Cannot open folder': '无法打开文件夹',
    'Folder is on the Windows filesystem': '文件夹位于 Windows 文件系统中',
    'WSL distro not found': '未找到 WSL 发行版',
    'Antigravity opened on Windows instead.': '已改为在 Windows 本地环境中打开 Antigravity。',
    'Cancel': '取消',
    'Quit': '退出',
    'OK': '确定',
    'Delete': '删除',
    'Delete Permanently': '永久删除',
    'Delete conversation permanently?': '永久删除对话？',
    'Are you sure you want to permanently delete this conversation?': '确定要永久删除此对话吗？',
    'Are you sure you want to permanently delete this conversation? This action cannot be undone.': '确定要永久删除此对话吗？此操作无法撤销。',
    'Are you sure you want to delete this conversation permanently? This action cannot be undone.': '确定要永久删除此对话吗？此操作无法撤销。'
  };

  function translateDialogOptions(opts) {
    if (!opts || typeof opts !== 'object') return opts;
    const copy = Object.assign({}, opts);
    if (typeof copy.title === 'string' && DIALOG_TEXT_MAP[copy.title]) {
      copy.title = DIALOG_TEXT_MAP[copy.title];
    }
    if (typeof copy.message === 'string' && DIALOG_TEXT_MAP[copy.message]) {
      copy.message = DIALOG_TEXT_MAP[copy.message];
    }
    if (typeof copy.detail === 'string' && DIALOG_TEXT_MAP[copy.detail]) {
      copy.detail = DIALOG_TEXT_MAP[copy.detail];
    }
    if (Array.isArray(copy.buttons)) {
      copy.buttons = copy.buttons.map((b) => (typeof b === 'string' && DIALOG_TEXT_MAP[b] ? DIALOG_TEXT_MAP[b] : b));
    }
    return copy;
  }

  try {
    if (electron.dialog) {
      if (typeof electron.dialog.showMessageBox === 'function') {
        const origShowMessageBox = electron.dialog.showMessageBox.bind(electron.dialog);
        electron.dialog.showMessageBox = function (winOrOpts, maybeOpts) {
          if (maybeOpts && typeof maybeOpts === 'object') {
            return origShowMessageBox(winOrOpts, translateDialogOptions(maybeOpts));
          }
          return origShowMessageBox(translateDialogOptions(winOrOpts));
        };
      }
      if (typeof electron.dialog.showOpenDialog === 'function') {
        const origShowOpenDialog = electron.dialog.showOpenDialog.bind(electron.dialog);
        electron.dialog.showOpenDialog = function (winOrOpts, maybeOpts) {
          if (maybeOpts && typeof maybeOpts === 'object') {
            return origShowOpenDialog(winOrOpts, translateDialogOptions(maybeOpts));
          }
          return origShowOpenDialog(translateDialogOptions(winOrOpts));
        };
      }
    }
  } catch (_) {}

  function translateNotificationTextInMain(text) {
    if (!text || typeof text !== 'string') return text;
    const s = text.trim();
    if (!s) return text;

    if (/^Agent finished:\s*/i.test(s)) {
      const rest = s.replace(/^Agent finished:\s*/i, '').trim();
      let transRest = rest;
      try {
        const cachePath = path.join(os.homedir(), '.gemini', 'antigravity', 'title_api_cache.json');
        if (fs.existsSync(cachePath)) {
          const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          if (cache[rest]) transRest = cache[rest];
        }
      } catch (_) {}
      return `Agent 已完成：${transRest}`;
    }
    if (/^Subagent finished:\s*/i.test(s)) {
      const rest = s.replace(/^Subagent finished:\s*/i, '').trim();
      return `子 Agent 已完成：${rest}`;
    }
    if (/^Task finished:\s*/i.test(s)) {
      const rest = s.replace(/^Task finished:\s*/i, '').trim();
      return `任务已完成：${rest}`;
    }
    if (/^Finished:\s*/i.test(s)) {
      const rest = s.replace(/^Finished:\s*/i, '').trim();
      return `已完成：${rest}`;
    }
    if (/^Agent finished\s*(?:\.|$)/i.test(s)) {
      return s.endsWith('.') ? 'Agent 已完成。' : 'Agent 已完成';
    }
    if (/^Subagent finished\s*(?:\.|$)/i.test(s)) {
      return s.endsWith('.') ? '子 Agent 已完成。' : '子 Agent 已完成';
    }
    if (/^Task finished\s*(?:\.|$)/i.test(s)) {
      return s.endsWith('.') ? '任务已完成。' : '任务已完成';
    }
    if (/^Finished\s*(?:\.|$)/i.test(s)) {
      return s.endsWith('.') ? '已完成。' : '已完成';
    }
    if (s.includes('has a question') || s.includes('has questions')) {
      return 'Agent 提问：';
    }
    if (s.startsWith('Requesting your permission:') || s === 'Requesting your permission') {
      return '请求权限：';
    }
    if (s === 'Action requires your attention') {
      return '需要确认';
    }
    if (s.includes('Click to respond')) {
      return '点击回复';
    }
    if (s === 'The agent is waiting for your input.') {
      return 'Agent 等待输入';
    }

    return text;
  }

  try {
    const wrapNotificationOpts = (options) => {
      if (options && typeof options === "object") {
        const copy = Object.assign({}, options);
        if (typeof copy.title === "string") {
          copy.title = translateNotificationTextInMain(copy.title);
        }
        if (typeof copy.body === "string") {
          copy.body = translateNotificationTextInMain(copy.body);
        }
        return copy;
      }
      return options;
    };

    if (electron.ipcMain) {
      const origHandle = electron.ipcMain.handle.bind(electron.ipcMain);
      electron.ipcMain.handle = function (channel, listener) {
        if (channel === "notification:send" && typeof listener === "function") {
          const wrapped = async (event, options) => {
            return listener(event, wrapNotificationOpts(options));
          };
          return origHandle(channel, wrapped);
        }
        return origHandle(channel, listener);
      };
    }

    if (electron.Notification) {
      const OrigNotif = electron.Notification;
      class AgyMainNotification extends OrigNotif {
        constructor(options) {
          super(wrapNotificationOpts(options));
        }
      }
      try {
        electron.Notification = AgyMainNotification;
      } catch (_) {}
    }
  } catch (_) {}

  const pluginScriptsDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'zh-cn-ui', 'scripts');

  // 注册主进程翻译 API 桥接
  if (electron.ipcMain && !electron.ipcMain.__agyTitleApiBridgeRegistered) {
    electron.ipcMain.__agyTitleApiBridgeRegistered = true;
    const callTimes = [];
    electron.ipcMain.handle('agy-translate-title', async (event, text) => {
      const senderUrl = event?.senderFrame?.url || '';
      const isInternal =
        senderUrl.startsWith('file://') ||
        senderUrl.startsWith('vscode-file://') ||
        senderUrl.startsWith('vscode-webview://');
      if (!isInternal) return text;
      if (typeof text !== 'string' || !text.trim() || text.length > 500) return text;
      const now = Date.now();
      while (callTimes.length > 0 && now - callTimes[0] > 10000) callTimes.shift();
      if (callTimes.length >= 30) return text;
      callTimes.push(now);
      try {
        const translatorPath = path.join(pluginScriptsDir, 'api_translator.js');
        if (fs.existsSync(translatorPath)) {
          const { translateWithApi } = require(translatorPath);
          return await translateWithApi(text);
        }
      } catch (_) {}
      return text;
    });
  }

  let cachedScript = '';
  let lastMtime = 0;

  function getRuntimeScript() {
    const candidates = [
      path.join(pluginScriptsDir, 'zh_cn_runtime.js'),
      path.join(__dirname, 'zh_cn_runtime.js')
    ];
    let script = '';
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          if (cachedScript && stat.mtimeMs === lastMtime) {
            script = cachedScript;
            break;
          }
          cachedScript = fs.readFileSync(p, 'utf8');
          lastMtime = stat.mtimeMs;
          script = cachedScript;
          break;
        }
      } catch (_) {}
    }
    if (!script) return cachedScript;
    return script;
  }

  getRuntimeScript();

  // 仅当检测到 pending 目录存在已下载的更新安装包、即将执行退出更新时，才派生一次性 60 秒短生命周期修补任务，平时零后台进程
  let postUpdateScheduled = false;
  function scheduleOneShotPostUpdatePatchIfPending() {
    if (postUpdateScheduled) return;
    try {
      const pendingDir = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'antigravity-updater',
        'pending'
      );
      if (!fs.existsSync(pendingDir)) return;
      const files = fs.readdirSync(pendingDir);
      const hasUpdatePayload = files.some((f) => f.endsWith('.exe') || f === 'update-info.json');
      if (!hasUpdatePayload) return;

      postUpdateScheduled = true;
      const installScript = path.join(pluginScriptsDir, 'install_boot_hook.js');
      const injectScript = path.join(pluginScriptsDir, 'inject_live.js');
      if (!fs.existsSync(installScript)) return;

      const sysNode = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe');
      if (!fs.existsSync(sysNode)) return;

      const oneShotCode = `
        const fs = require('fs');
        const { asarPath, isAsarPatched, install } = require(${JSON.stringify(installScript)});
        const { injectLive } = require(${JSON.stringify(injectScript)});
        let ticks = 0;
        const timer = setInterval(async () => {
          ticks++;
          if (ticks > 75) {
            clearInterval(timer);
            process.exit(0);
          }
          try {
            if (fs.existsSync(asarPath) && !isAsarPatched(asarPath)) {
              clearInterval(timer);
              install(false);
              try { await injectLive('apply', 20, 450); } catch (_) {}
              process.exit(0);
            }
          } catch (_) {}
        }, 800);
      `;

      const child = spawn(sysNode, ['-e', oneShotCode], {
        cwd: os.tmpdir(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
    } catch (_) {}
  }


  function injectIntoWebContents(wc) {
    if (!wc || wc.isDestroyed()) return;
    try {
      const type = typeof wc.getType === 'function' ? wc.getType() : 'window';
      if (type !== 'window') return;
    } catch (_) {}

    const getTitleCacheInjection = () => {
      try {
        const cachePath = path.join(os.homedir(), '.gemini', 'antigravity', 'title_api_cache.json');
        if (fs.existsSync(cachePath)) {
          const cache = fs.readFileSync(cachePath, 'utf8');
          const safeJson = JSON.stringify(JSON.parse(cache));
          return `try{window.__AGY_TITLE_CACHE__=Object.assign(window.__AGY_TITLE_CACHE__||{},${safeJson});}catch(_){}\n`;
        }
      } catch (_) {}
      return '';
    };

    const runInjectImmediate = () => {
      if (wc.isDestroyed()) return;
      const url = wc.getURL ? wc.getURL() : '';
      if (!url || url === 'about:blank' || url.startsWith('data:') || url.startsWith('devtools://')) return;
      const code = getRuntimeScript();
      if (!code) return;
      wc.executeJavaScript(getTitleCacheInjection() + code, true).catch(() => {});
    };

    wc.on('dom-ready', runInjectImmediate);
    wc.on('did-finish-load', runInjectImmediate);
    wc.on('did-navigate-in-page', () => {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript('try{if(!window.__AGY_I18N__){' + getRuntimeScript() + '}}catch(_){}', true).catch(() => {});
    });
  }

  if (electron.app) {
    electron.app.on('web-contents-created', (_event, contents) => {
      injectIntoWebContents(contents);
    });
    electron.app.on('browser-window-created', (_event, win) => {
      if (win && win.webContents) {
        injectIntoWebContents(win.webContents);
      }
    });
    electron.app.on('before-quit', () => {
      scheduleOneShotPostUpdatePatchIfPending();
    });
    electron.app.on('will-quit', () => {
      scheduleOneShotPostUpdatePatchIfPending();
    });
  }
}
