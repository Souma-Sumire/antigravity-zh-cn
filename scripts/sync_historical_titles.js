'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  translateWithApi,
  translateBatchWithApi,
  isRemoteTranslateEnabled,
  setCachedTranslations,
  getCacheMap
} = require('./api_translator');

function parseSkillFrontmatter(skillMdPath) {
  try {
    const raw = fs.readFileSync(skillMdPath, 'utf8');
    const fmMatch = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return null;
    const block = fmMatch[1];
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const descMatch = block.match(/^description:\s*(.+)$/m);
    const unquote = (v) => (v ? v.trim().replace(/^["']|["']$/g, '').trim() : '');
    return {
      name: unquote(nameMatch ? nameMatch[1] : ''),
      description: unquote(descMatch ? descMatch[1] : '')
    };
  } catch (_) {
    return null;
  }
}

function loadInstalledSkillMetaMap() {
  const metaMap = new Map();
  const home = os.homedir();
  const skillRoots = [
    path.join(home, '.gemini', 'config', 'skills'),
    path.join(home, '.gemini', 'antigravity', 'builtin', 'skills')
  ];
  const pluginsRoot = path.join(home, '.gemini', 'config', 'plugins');
  try {
    if (fs.existsSync(pluginsRoot)) {
      for (const p of fs.readdirSync(pluginsRoot)) {
        skillRoots.push(path.join(pluginsRoot, p, 'skills'));
      }
    }
  } catch (_) {}

  for (const dir of skillRoots) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
          if (!fs.statSync(full).isDirectory()) continue;
          const skillMdPath = path.join(full, 'SKILL.md');
          const meta = fs.existsSync(skillMdPath) ? parseSkillFrontmatter(skillMdPath) : null;
          const key = entry.toLowerCase();
          if (!metaMap.has(key)) {
            metaMap.set(key, {
              name: (meta && meta.name) || entry,
              description: (meta && meta.description) || ''
            });
          }
          if (meta && meta.name) {
            const nameKey = meta.name.toLowerCase();
            if (!metaMap.has(nameKey)) {
              metaMap.set(nameKey, {
                name: meta.name,
                description: meta.description || ''
              });
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return metaMap;
}

function readTranscriptHeadLines(transcriptPath, maxBytes = 16384) {
  let fd = null;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    if (bytesRead <= 0) return [];
    const text = buf.toString('utf8', 0, bytesRead);
    return text.split(/\r?\n/).filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function detectPureSkillStart(root, conversationId, skillMetaMap) {
  if (!conversationId) return null;
  const transcriptPath = path.join(root, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(transcriptPath)) return null;

  const lines = readTranscriptHeadLines(transcriptPath);
  if (lines.length === 0) return null;

  let firstUserText = null;
  let readSkillPath = null;
  let readSkillDirName = null;

  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj.type === 'USER_INPUT' && firstUserText === null) {
        const rawContent = String(obj.content || '');
        const reqMatch = rawContent.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
        firstUserText = (reqMatch ? reqMatch[1] : rawContent).trim();
      } else if (obj.type === 'PLANNER_RESPONSE' && Array.isArray(obj.tool_calls)) {
        for (const tc of obj.tool_calls) {
          const p = tc && tc.args && tc.args.Path ? String(tc.args.Path).replace(/^"+|"+$/g, '') : '';
          const sm = p.match(/[\\/]([a-zA-Z0-9_-]+)[\\/]SKILL\.md$/i);
          if (sm) {
            readSkillPath = p;
            readSkillDirName = sm[1].toLowerCase();
            break;
          }
        }
      }
    } catch (_) {}
  }

  if (!firstUserText) return null;
  const pureMatch = firstUserText.match(/^\/([a-zA-Z0-9_-]+)\s*$/);
  if (!pureMatch) return null;

  const skillName = pureMatch[1];
  const lower = skillName.toLowerCase();
  const map = skillMetaMap || loadInstalledSkillMetaMap();
  let meta = map.get(lower) || null;

  if (!meta && readSkillPath && fs.existsSync(readSkillPath)) {
    meta = parseSkillFrontmatter(readSkillPath);
  }
  if (!meta && readSkillDirName !== lower) {
    return null;
  }

  return {
    isPureSkill: true,
    skillName,
    displayName: (meta && meta.name) || skillName,
    description: (meta && meta.description) || ''
  };
}

function extractFirstSentence(text) {
  if (!text || typeof text !== 'string') return '';
  let s = text.trim();
  s = s.replace(/^Use when (?:the )?user wants to\s+/i, '');
  s = s.replace(/^Use when\s+/i, '');
  s = s.replace(/^当用户需要|^当用户想要|^用于在/i, (m) => m);
  const firstClause = s.split(/[。！？.!?\n]/)[0].trim();
  return firstClause;
}

function shortenChineseSummary(text, maxLen = 18) {
  if (!text) return '';
  const cleaned = text.replace(/[“”"']/g, '').replace(/[，,：:；;]+$/, '').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).trim();
}

async function buildSkillTitle(skillHit) {
  if (!skillHit || !skillHit.displayName) return '';
  const prefix = `/${skillHit.displayName}`;
  const rawClause = extractFirstSentence(skillHit.description);
  if (rawClause) {
    if (/[\u4e00-\u9fa5]/.test(rawClause)) {
      const shortZh = shortenChineseSummary(rawClause);
      if (shortZh) return `${prefix}：${shortZh}`;
    } else if (isRemoteTranslateEnabled()) {
      try {
        const trans = await translateWithApi(rawClause.slice(0, 120));
        if (trans && /[\u4e00-\u9fa5]/.test(trans)) {
          const shortZh = shortenChineseSummary(trans);
          if (shortZh) return `${prefix}：${shortZh}`;
        }
      } catch (_) {}
    }
  }
  return `${prefix} 技能会话`;
}

async function resolveSkillOverrideForTitle(root, originalTitle) {
  if (!originalTitle || typeof originalTitle !== 'string') return null;
  const target = originalTitle.trim();
  const sqlite = getSqliteModule();
  const dbPath = path.join(root, 'conversation_summaries.db');
  const skillMetaMap = loadInstalledSkillMetaMap();

  if (sqlite && fs.existsSync(dbPath)) {
    let db = null;
    try {
      db = new sqlite.DatabaseSync(dbPath);
      const rows = db.prepare('SELECT conversation_id FROM conversation_summaries WHERE title = ? ORDER BY last_modified_time DESC LIMIT 5').all(target);
      for (const r of rows) {
        const hit = detectPureSkillStart(root, r.conversation_id, skillMetaMap);
        if (hit) return await buildSkillTitle(hit);
      }
    } catch (_) {
    } finally {
      if (db) {
        try { db.close(); } catch (_) {}
      }
    }
  }
  return null;
}

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

function isCorruptedText(s) {
  if (!s || typeof s !== 'string') return false;
  return s.includes('\uFFFD') || /MYMEMORY|USAGELIMITS|FREE TRANSLATIONS|我的记忆警告|记忆警告/i.test(s);
}

function repairCorruptedTitles(root, sqlite) {
  const manifestPath = path.join(root, 'historical_titles_backup.json');
  const cachePath = path.join(root, 'title_api_cache.json');
  const dbPath = path.join(root, 'conversation_summaries.db');
  const annotationsDir = path.join(root, 'annotations');

  const recoveryById = new Map();
  const corruptedToClean = new Map();
  let manifest = [];

  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!Array.isArray(manifest)) manifest = [];
    } catch (_) {
      manifest = [];
    }
  }

  for (const item of manifest) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id || (item.file ? item.file.replace(/\.pbtxt$/, '') : null);
    if (!id) continue;

    if (!recoveryById.has(id)) {
      recoveryById.set(id, { original: null, translated: null });
    }
    const rec = recoveryById.get(id);
    if (item.original && !isCorruptedText(item.original)) {
      if (!rec.original || (/[\u4e00-\u9fa5]/.test(rec.original) && !/[\u4e00-\u9fa5]/.test(item.original))) {
        rec.original = item.original;
      }
    }
    if (item.translated && !isCorruptedText(item.translated) && /[\u4e00-\u9fa5]/.test(item.translated)) {
      if (!rec.translated) {
        rec.translated = item.translated;
      }
    }
  }

  for (const item of manifest) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id || (item.file ? item.file.replace(/\.pbtxt$/, '') : null);
    const rec = id ? recoveryById.get(id) : null;
    const cleanTarget = rec ? (rec.translated || rec.original) : null;
    if (!cleanTarget) continue;
    if (item.original && isCorruptedText(item.original)) {
      corruptedToClean.set(item.original.trim(), cleanTarget);
    }
    if (item.translated && isCorruptedText(item.translated)) {
      corruptedToClean.set(item.translated.trim(), cleanTarget);
    }
  }

  let repairedCount = 0;

  if (sqlite && fs.existsSync(dbPath)) {
    let db = null;
    let inTx = false;
    try {
      db = new sqlite.DatabaseSync(dbPath);
      const rows = db.prepare('SELECT conversation_id, title FROM conversation_summaries').all();
      const updateSum = db.prepare('UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?');
      let ftsRows = [];
      let updateFts = null;
      try {
        ftsRows = db.prepare("SELECT conversation_id, title FROM conversations_fts WHERE title != ''").all();
        updateFts = db.prepare('UPDATE conversations_fts SET title = ? WHERE conversation_id = ?');
      } catch (_) {}

      db.exec('BEGIN TRANSACTION');
      inTx = true;

      for (const r of rows) {
        const cur = (r.title || '').trim();
        if (!isCorruptedText(cur)) continue;
        const rec = recoveryById.get(r.conversation_id);
        const cleanTitle = (rec && (rec.translated || rec.original)) || corruptedToClean.get(cur);
        if (cleanTitle && !isCorruptedText(cleanTitle) && cleanTitle !== cur) {
          updateSum.run(cleanTitle, r.conversation_id);
          repairedCount++;
        }
      }

      if (updateFts) {
        for (const r of ftsRows) {
          const cur = (r.title || '').trim();
          if (!isCorruptedText(cur)) continue;
          const rec = recoveryById.get(r.conversation_id);
          const cleanTitle = (rec && (rec.translated || rec.original)) || corruptedToClean.get(cur);
          if (cleanTitle && !isCorruptedText(cleanTitle) && cleanTitle !== cur) {
            try {
              updateFts.run(cleanTitle, r.conversation_id);
              repairedCount++;
            } catch (_) {}
          }
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

  if (fs.existsSync(annotationsDir)) {
    try {
      const files = fs.readdirSync(annotationsDir).filter((f) => f.endsWith('.pbtxt'));
      for (const file of files) {
        const fullPath = path.join(annotationsDir, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const match = content.match(/title:\s*"([^"]+)"/);
          if (!match) continue;
          const cur = match[1].trim();
          if (!isCorruptedText(cur)) continue;
          const id = file.replace(/\.pbtxt$/, '');
          const rec = recoveryById.get(id);
          const cleanTitle = (rec && (rec.translated || rec.original)) || corruptedToClean.get(cur);
          if (cleanTitle && !isCorruptedText(cleanTitle) && cleanTitle !== cur) {
            const titleRegex = new RegExp(`title:\\s*"${escapeRegExp(match[1])}"`);
            const escaped = escapePbtxtString(cleanTitle);
            const newContent = content.replace(titleRegex, () => `title: "${escaped}"`);
            if (newContent !== content) {
              fs.writeFileSync(fullPath, newContent, 'utf8');
              repairedCount++;
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  if (manifest.length > 0) {
    try {
      const cleanedManifest = [];
      const seenKeys = new Set();
      for (const item of manifest) {
        if (!item || typeof item !== 'object') continue;
        if (isCorruptedText(item.original) || isCorruptedText(item.translated)) continue;
        if (/[\u4e00-\u9fa5]/.test(item.original)) continue;
        const key = `${item.type}:${item.id || item.file}:${item.original}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        cleanedManifest.push(item);
      }
      if (cleanedManifest.length !== manifest.length) {
        fs.writeFileSync(manifestPath, JSON.stringify(cleanedManifest, null, 2), 'utf8');
      }
    } catch (_) {}
  }

  try {
    let cache = {};
    if (fs.existsSync(cachePath)) {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) || {};
    }
    let cacheChanged = false;
    for (const [k, v] of Object.entries(cache)) {
      if (isCorruptedText(k) || isCorruptedText(v) || /[\u4e00-\u9fa5]/.test(k)) {
        delete cache[k];
        cacheChanged = true;
      }
    }
    for (const [, rec] of recoveryById.entries()) {
      if (rec.original && rec.translated && !/[\u4e00-\u9fa5]/.test(rec.original) && cache[rec.original] !== rec.translated) {
        cache[rec.original] = rec.translated;
        cacheChanged = true;
      }
    }
    if (cacheChanged) {
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
    }
  } catch (_) {}

  return repairedCount;
}

async function syncHistoricalTitles() {
  const root = path.join(os.homedir(), '.gemini', 'antigravity');
  const sqlite = getSqliteModule();
  try {
    repairCorruptedTitles(root, sqlite);
  } catch (_) {}

  // 若存在旧版遗留的历史写回备份，先将有效译文迁移至缓存并将数据库与 pbtxt 还原为英文原文
  const manifestPath = path.join(root, 'historical_titles_backup.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (Array.isArray(manifest)) {
        const migrated = {};
        for (const item of manifest) {
          if (
            item &&
            item.original &&
            item.translated &&
            !isCorruptedText(item.original) &&
            !isCorruptedText(item.translated) &&
            !/[\u4e00-\u9fa5]/.test(item.original)
          ) {
            migrated[item.original.trim()] = item.translated.trim();
          }
        }
        setCachedTranslations(migrated);
      }
    } catch (_) {}
    try {
      await revertHistoricalTitles();
    } catch (_) {}
  }

  if (!isRemoteTranslateEnabled()) {
    return {
      success: true,
      count: 0,
      items: [],
      skipped: true,
      reason: '会话标题翻译功能未开启。可通过右下角悬浮按钮右键菜单勾选开启，或设置环境变量 AGY_ENABLE_REMOTE_TITLE_TRANSLATION=1'
    };
  }

  const annotationsDir = path.join(root, 'annotations');
  const dbPath = path.join(root, 'conversation_summaries.db');
  const installedSkills = loadInstalledSkillMetaMap();

  const titleByConvId = new Map();
  const titlesToTranslate = new Set();

  function isTitleNeedingTranslation(title) {
    if (!title || typeof title !== 'string') return false;
    const s = title.trim();
    if (!s || s.length < 3) return false;
    if (isCorruptedText(s) || /[\u4e00-\u9fa5]/.test(s)) return false;
    return /[a-zA-Z]{3,}/.test(s) && !/^(?:UI|UX|Git|PR|API|SDK|CLI|IDE|MCP)$/.test(s);
  }

  // 1. 只读扫描 SQLite 本地会话摘要数据库（主表与全文检索表）
  if (sqlite && fs.existsSync(dbPath)) {
    try {
      const db = new sqlite.DatabaseSync(dbPath);
      const rows = db.prepare('SELECT conversation_id, title FROM conversation_summaries').all();
      for (const r of rows) {
        const orig = (r.title || '').trim();
        if (isTitleNeedingTranslation(orig)) {
          titleByConvId.set(r.conversation_id, orig);
        }
      }
      try {
        const ftsRows = db.prepare("SELECT conversation_id, title FROM conversations_fts WHERE title != ''").all();
        for (const r of ftsRows) {
          const orig = (r.title || '').trim();
          if (isTitleNeedingTranslation(orig) && !titleByConvId.has(r.conversation_id)) {
            titleByConvId.set(r.conversation_id, orig);
          }
        }
      } catch (_) {}
      db.close();
    } catch (_) {}
  }

  // 2. 只读扫描 annotations/*.pbtxt 文件
  if (fs.existsSync(annotationsDir)) {
    const files = fs.readdirSync(annotationsDir).filter((f) => f.endsWith('.pbtxt'));
    for (const file of files) {
      const fullPath = path.join(annotationsDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const match = content.match(/title:\s*"([^"]+)"/);
        if (!match) continue;
        const orig = match[1].trim();
        const convId = file.replace(/\.pbtxt$/, '');
        if (isTitleNeedingTranslation(orig) && !titleByConvId.has(convId)) {
          titleByConvId.set(convId, orig);
        }
      } catch (_) {}
    }
  }

  const updatedItems = [];
  const skillOverrides = {};
  const cacheMap = getCacheMap();

  for (const [convId, orig] of titleByConvId.entries()) {
    const skillHit = detectPureSkillStart(root, convId, installedSkills);
    if (skillHit) {
      const suggestedTitle = await buildSkillTitle(skillHit);
      if (suggestedTitle && cacheMap[orig] !== suggestedTitle) {
        skillOverrides[orig] = suggestedTitle;
        updatedItems.push({
          type: 'skill-cache',
          id: convId,
          original: orig,
          translated: suggestedTitle
        });
      }
      continue;
    }
    if (!cacheMap[orig]) {
      titlesToTranslate.add(orig);
    }
  }

  if (Object.keys(skillOverrides).length > 0) {
    setCachedTranslations(skillOverrides);
  }

  if (titlesToTranslate.size > 0) {
    const transMap = await translateBatchWithApi(Array.from(titlesToTranslate));
    for (const [orig, trans] of Object.entries(transMap)) {
      if (trans && trans !== orig) {
        updatedItems.push({
          type: 'api-cache',
          original: orig,
          translated: trans
        });
      }
    }
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
      let updatePreview = null;
      try {
        updatePreview = db.prepare('UPDATE conversation_summaries SET preview = ? WHERE conversation_id = ? AND preview = ?');
      } catch (_) {}
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
            if (updatePreview) {
              updatePreview.run(item.original, item.id, item.translated);
            }
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
  revertHistoricalTitles,
  detectPureSkillStart,
  resolveSkillOverrideForTitle
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
