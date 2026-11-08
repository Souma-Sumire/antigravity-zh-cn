'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { translateBatchWithApi } = require('./api_translator');

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapePbtxtString(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getSqliteModule() {
  try {
    return require('node:sqlite');
  } catch (_) {
    return null;
  }
}

async function syncHistoricalTitles() {
  if (process.env.AGY_ENABLE_REMOTE_TITLE_TRANSLATION !== '1') {
    return {
      success: true,
      count: 0,
      items: [],
      skipped: true,
      reason: '会话标题翻译与本地数据同步默认已关闭（保护用户隐私与数据安全）。如需开启，请显式设置环境变量 AGY_ENABLE_REMOTE_TITLE_TRANSLATION=1'
    };
  }

  const root = path.join(os.homedir(), '.gemini', 'antigravity');
  const annotationsDir = path.join(root, 'annotations');
  const dbPath = path.join(root, 'conversation_summaries.db');

  const pendingPbtxtFiles = [];
  const pendingDbRows = [];
  const pendingFtsRows = [];
  const titlesToTranslate = new Set();

  function isTitleNeedingTranslation(title) {
    if (!title || typeof title !== 'string') return false;
    const s = title.trim();
    if (!s || s.length < 3) return false;
    return /[a-zA-Z]{3,}/.test(s) && !/^(?:UI|UX|FFXIV|Git|PR)$/.test(s);
  }

  // 1. 扫描 SQLite 本地会话摘要数据库（包含主表与全文检索表）
  const sqlite = getSqliteModule();
  if (sqlite && fs.existsSync(dbPath)) {
    try {
      const db = new sqlite.DatabaseSync(dbPath);

      // 1.1 扫描 conversation_summaries 主表
      const rows = db.prepare('SELECT conversation_id, title FROM conversation_summaries').all();
      const existingSummaryMap = new Map();
      for (const r of rows) {
        const orig = (r.title || '').trim();
        existingSummaryMap.set(r.conversation_id, orig);
        if (isTitleNeedingTranslation(orig)) {
          titlesToTranslate.add(orig);
          pendingDbRows.push({ conversation_id: r.conversation_id, title: orig });
        }
      }

      // 1.2 扫描 conversations_fts 全文索引表（提取归档会话标题及主表缺失的标题）
      try {
        const ftsRows = db.prepare("SELECT conversation_id, title FROM conversations_fts WHERE title != ''").all();
        for (const r of ftsRows) {
          const orig = (r.title || '').trim();
          if (isTitleNeedingTranslation(orig)) {
            titlesToTranslate.add(orig);
            pendingFtsRows.push({ conversation_id: r.conversation_id, title: orig });

            // 若主表中该会话存在但 title 为空，同步加入主表更新列表
            const hasInSummary = existingSummaryMap.has(r.conversation_id);
            const sumTitle = existingSummaryMap.get(r.conversation_id);
            if (hasInSummary && !sumTitle) {
              pendingDbRows.push({ conversation_id: r.conversation_id, title: orig });
            }
          }
        }
      } catch (_) {}

      db.close();
    } catch (_) {}
  }

  // 2. 扫描 annotations/*.pbtxt 文件
  if (fs.existsSync(annotationsDir)) {
    const files = fs.readdirSync(annotationsDir).filter((f) => f.endsWith('.pbtxt'));
    for (const file of files) {
      const fullPath = path.join(annotationsDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const match = content.match(/title:\s*"([^"]+)"/);
        if (!match) continue;

        const originalTitle = match[1].trim();
        if (!isTitleNeedingTranslation(originalTitle)) continue;

        pendingPbtxtFiles.push({
          file,
          fullPath,
          content,
          originalTitle
        });
        titlesToTranslate.add(originalTitle);
      } catch (_) {}
    }
  }

  if (titlesToTranslate.size === 0) {
    return { success: true, count: 0, items: [] };
  }

  // 3. 批量并发翻译所有待处理标题
  const transMap = await translateBatchWithApi(Array.from(titlesToTranslate));
  const updatedItems = [];
  const recorded = new Set();

  // 4. 写回 SQLite 数据库（主表及 FTS 表）
  if (sqlite && (pendingDbRows.length > 0 || pendingFtsRows.length > 0) && fs.existsSync(dbPath)) {
    let db = null;
    let inTx = false;
    try {
      db = new sqlite.DatabaseSync(dbPath);
      const updateSumStmt = db.prepare('UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?');

      let updateFtsStmt = null;
      try {
        updateFtsStmt = db.prepare('UPDATE conversations_fts SET title = ? WHERE conversation_id = ?');
      } catch (_) {}

      db.exec('BEGIN TRANSACTION');
      inTx = true;

      for (const row of pendingDbRows) {
        const trans = transMap[row.title];
        if (trans && trans !== row.title) {
          updateSumStmt.run(trans, row.conversation_id);
          const key = `${row.conversation_id}:${row.title}`;
          if (!recorded.has(key)) {
            recorded.add(key);
            updatedItems.push({
              type: 'db',
              id: row.conversation_id,
              original: row.title,
              translated: trans
            });
          }
        }
      }

      if (updateFtsStmt) {
        for (const row of pendingFtsRows) {
          const trans = transMap[row.title];
          if (trans && trans !== row.title) {
            try {
              updateFtsStmt.run(trans, row.conversation_id);
              const key = `${row.conversation_id}:${row.title}`;
              if (!recorded.has(key)) {
                recorded.add(key);
                updatedItems.push({
                  type: 'fts',
                  id: row.conversation_id,
                  original: row.title,
                  translated: trans
                });
              }
            } catch (_) {}
          }
        }
      }

      db.exec('COMMIT');
      inTx = false;
    } catch (err) {
      if (db && inTx) {
        try { db.exec('ROLLBACK'); } catch (_) {}
      }
    } finally {
      if (db) {
        try { db.close(); } catch (_) {}
      }
    }
  }

  // 5. 写回 annotations/*.pbtxt 文件
  for (const item of pendingPbtxtFiles) {
    const { file, fullPath, content, originalTitle } = item;
    const translatedTitle = transMap[originalTitle];
    if (!translatedTitle || translatedTitle === originalTitle) continue;

    try {
      const titleRegex = new RegExp(`title:\\s*"${escapeRegExp(originalTitle)}"`);
      if (titleRegex.test(content)) {
        const escaped = escapePbtxtString(translatedTitle);
        const newContent = content.replace(titleRegex, () => `title: "${escaped}"`);
        if (newContent !== content) {
          fs.writeFileSync(fullPath, newContent, 'utf8');
          const key = `${file}:${originalTitle}`;
          if (!recorded.has(key)) {
            recorded.add(key);
            updatedItems.push({
              type: 'pbtxt',
              file,
              original: originalTitle,
              translated: translatedTitle
            });
          }
        }
      }
    } catch (_) {}
  }

  if (updatedItems.length > 0) {
    try {
      const manifestPath = path.join(root, 'historical_titles_backup.json');
      let manifest = [];
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      }
      manifest.push(...updatedItems);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (_) {}
  }

  return {
    success: true,
    count: updatedItems.length,
    items: updatedItems
  };
}

// 卸载时按备份清单精准回滚用户数据，不碰用户新增会话
async function revertHistoricalTitles() {
  const root = path.join(os.homedir(), '.gemini', 'antigravity');
  const manifestPath = path.join(root, 'historical_titles_backup.json');
  if (!fs.existsSync(manifestPath)) {
    return { restored: 0, items: [] };
  }

  let manifest = [];
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return { restored: 0, items: [] };
  }

  if (!Array.isArray(manifest) || manifest.length === 0) {
    try { fs.unlinkSync(manifestPath); } catch (_) {}
    return { restored: 0, items: [] };
  }

  const sqlite = getSqliteModule();
  const dbPath = path.join(root, 'conversation_summaries.db');
  let restoredCount = 0;

  if (sqlite && fs.existsSync(dbPath)) {
    let db = null;
    let inTx = false;
    try {
      db = new sqlite.DatabaseSync(dbPath);
      const updateSum = db.prepare('UPDATE conversation_summaries SET title = ? WHERE conversation_id = ? AND title = ?');
      let updateFts = null;
      try {
        updateFts = db.prepare('UPDATE conversations_fts SET title = ? WHERE conversation_id = ? AND title = ?');
      } catch (_) {}

      db.exec('BEGIN TRANSACTION');
      inTx = true;

      for (const item of manifest) {
        if (item.type === 'db' && item.id && item.original && item.translated) {
          try {
            updateSum.run(item.original, item.id, item.translated);
            restoredCount++;
          } catch (_) {}
        } else if (item.type === 'fts' && item.id && item.original && item.translated && updateFts) {
          try {
            updateFts.run(item.original, item.id, item.translated);
            restoredCount++;
          } catch (_) {}
        }
      }

      db.exec('COMMIT');
      inTx = false;
    } catch (_) {
      if (db && inTx) {
        try { db.exec('ROLLBACK'); } catch (_) {}
      }
    } finally {
      if (db) {
        try { db.close(); } catch (_) {}
      }
    }
  }

  const annotationsDir = path.join(root, 'annotations');
  for (const item of manifest) {
    if (item.type === 'pbtxt' && item.file && item.original && item.translated) {
      const fullPath = path.join(annotationsDir, item.file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const transRegex = new RegExp(`title:\\s*"${escapeRegExp(escapePbtxtString(item.translated))}"`);
          if (transRegex.test(content)) {
            const reverted = content.replace(transRegex, () => `title: "${escapePbtxtString(item.original)}"`);
            fs.writeFileSync(fullPath, reverted, 'utf8');
            restoredCount++;
          }
        } catch (_) {}
      }
    }
  }

  try { fs.unlinkSync(manifestPath); } catch (_) {}

  return { restored: restoredCount, items: manifest };
}

module.exports = {
  syncHistoricalTitles,
  revertHistoricalTitles
};

if (require.main === module) {
  (async () => {
    console.log('正在调用翻译引擎 API 扫描并同步历史与归档会话标题...');
    const res = await syncHistoricalTitles();
    console.log(`处理完成，共汉化 ${res.count} 个历史与归档会话标题：`);
    for (const item of res.items) {
      console.log(`  - [${item.original}] -> [${item.translated}]`);
    }
  })();
}
