'use strict';

const electron = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

if (!global.__AGY_ZH_CN_MAIN_HOOK_LOADED__) {
  global.__AGY_ZH_CN_MAIN_HOOK_LOADED__ = true;

  const MENU_MAP = {
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
    'No agents running': '无运行中的智能体',
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
    const agentMatch = clean.match(/^(\d+)\s+agents?\s+running$/i);
    if (agentMatch) return `${agentMatch[1]} 个智能体运行中`;
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
    const copy = {};
    if (item.id !== undefined) copy.id = item.id;
    if (item.label !== undefined) copy.label = item.label;
    if (item.role !== undefined) copy.role = item.role;
    if (item.type !== undefined) copy.type = item.type;
    if (item.accelerator !== undefined) copy.accelerator = item.accelerator;
    if (item.icon !== undefined) copy.icon = item.icon;
    if (item.sublabel !== undefined) copy.sublabel = item.sublabel;
    if (item.toolTip !== undefined) copy.toolTip = item.toolTip;
    if (typeof item.enabled === 'boolean') copy.enabled = item.enabled;
    if (typeof item.visible === 'boolean') copy.visible = item.visible;
    if (typeof item.checked === 'boolean') copy.checked = item.checked;

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
    'There may be agents or background tasks running.': '当前可能仍有智能体或后台任务正在运行。',
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
    'OK': '确定'
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

  const pluginScriptsDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'zh-cn-ui', 'scripts');

  let cachedScript = '';
  let lastMtime = 0;

  function getRuntimeScript() {
    const candidates = [
      path.join(pluginScriptsDir, 'zh_cn_runtime.js'),
      path.join(__dirname, 'zh_cn_runtime.js')
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          if (cachedScript && stat.mtimeMs === lastMtime) {
            return cachedScript;
          }
          cachedScript = fs.readFileSync(p, 'utf8');
          lastMtime = stat.mtimeMs;
          return cachedScript;
        }
      } catch (_) {}
    }
    return cachedScript;
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

    const runInjectImmediate = () => {
      if (wc.isDestroyed()) return;
      const url = wc.getURL ? wc.getURL() : '';
      if (!url || url === 'about:blank' || url.startsWith('data:') || url.startsWith('devtools://')) return;
      const code = getRuntimeScript();
      if (!code) return;
      wc.executeJavaScript(code, true).catch(() => {});
    };

    wc.on('dom-ready', runInjectImmediate);
    wc.on('did-finish-load', runInjectImmediate);
    wc.on('did-navigate-in-page', runInjectImmediate);
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
