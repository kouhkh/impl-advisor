'use strict';

/**
 * 项目只读数据面（第三面材料；命名曾误作「仅运行记录」）：
 * - 代码面：workspace
 * - 运行文件面：SSH ls/head/find / export-dir
 * - 项目数据面：元数据 / 文档 / 策略 / 任务 / draft 等（只读 DB/API/fixture）
 *
 * 通用契约：按「集合 + 记录」list/get；产品默认不给模型自由 SQL。
 * 合作方注册集合或命名查询；顾问只拿证据卡。
 * 现用网关名 run.record_* 为过渡名，目标迁到 data.list/get。
 */
const fs = require('node:fs');
const path = require('node:path');

const STRUCTURED_RUNTIME_SCHEMA = 'readonly-advisor-structured-runtime/1';
const FIXTURE_SCHEMA = 'readonly-advisor-structured-runtime-fixture/1';
const MODES = new Set(['none', 'fixture', 'sql']);

const DEFAULT_LIMITS = {
  maxList: 20,
  maxGetChars: 8000,
  maxFilterKeys: 8,
};

function deepMergeLimits(raw) {
  return { ...DEFAULT_LIMITS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeStructuredRuntime(raw, { workspace = null } = {}) {
  if (raw == null || raw === false) {
    return { mode: 'none', enabled: false };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('structuredRuntime must be an object');
  }
  if (raw.enabled === false) {
    return { mode: 'none', enabled: false };
  }
  const mode = raw.mode || (raw.fixturePath || raw.fixtureDir ? 'fixture' : 'none');
  if (!MODES.has(mode)) {
    throw new Error(`unsupported structuredRuntime.mode: ${mode} (allowed: ${[...MODES].join(', ')})`);
  }
  if (mode === 'none') {
    return { mode: 'none', enabled: false };
  }

  const limits = deepMergeLimits(raw.limits);
  const collections = normalizeCollectionHints(raw.collections);

  if (mode === 'fixture') {
    const fixturePath = resolveFixturePath(raw.fixturePath || raw.fixtureDir, workspace);
    return {
      schemaVersion: STRUCTURED_RUNTIME_SCHEMA,
      mode: 'fixture',
      enabled: true,
      fixturePath,
      collections,
      limits,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
    };
  }

  // sql：契约先占位，执行层尚未接通（避免半吊子连生产库）。
  if (!raw.connectionEnv && !raw.connectionUrl) {
    throw new Error('structuredRuntime.mode=sql requires connectionEnv or connectionUrl');
  }
  if (!raw.allowQueries || typeof raw.allowQueries !== 'object' || Array.isArray(raw.allowQueries)) {
    throw new Error('structuredRuntime.mode=sql requires allowQueries object (named readonly queries)');
  }
  return {
    schemaVersion: STRUCTURED_RUNTIME_SCHEMA,
    mode: 'sql',
    enabled: true,
    connectionEnv: raw.connectionEnv ? String(raw.connectionEnv) : null,
    connectionUrl: raw.connectionUrl ? String(raw.connectionUrl) : null,
    allowQueries: raw.allowQueries,
    collections,
    limits,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

function normalizeCollectionHints(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    out[String(name)] = {
      description: typeof value.description === 'string' ? value.description : '',
      listFields: Array.isArray(value.listFields) ? value.listFields.map(String) : null,
      getFields: Array.isArray(value.getFields) ? value.getFields.map(String) : null,
    };
  }
  return out;
}

function resolveFixturePath(value, workspace) {
  if (!value) throw new Error('structuredRuntime.mode=fixture requires fixturePath');
  const resolved = path.resolve(String(value));
  if (workspace && path.resolve(resolved) === path.resolve(workspace)) {
    throw new Error('structuredRuntime.fixturePath must not be the workspace root');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`structuredRuntime.fixturePath does not exist: ${resolved}`);
  }
  return resolved;
}

function loadFixtureBundle(structured) {
  if (!structured || structured.mode !== 'fixture') {
    throw new Error('loadFixtureBundle requires mode=fixture');
  }
  const target = structured.fixturePath;
  const file = fs.statSync(target).isDirectory()
    ? path.join(target, 'manifest.json')
    : target;
  if (!fs.existsSync(file)) {
    throw new Error(`structured runtime fixture manifest missing: ${file}`);
  }
  const bundle = readJson(file);
  if (bundle.schemaVersion && bundle.schemaVersion !== FIXTURE_SCHEMA) {
    throw new Error(`unsupported fixture schema: ${bundle.schemaVersion}`);
  }
  const collections = bundle.collections && typeof bundle.collections === 'object'
    ? bundle.collections
    : {};
  return { file, bundle, collections };
}

function projectFields(record, fields) {
  if (!fields || !fields.length) return { ...record };
  const out = {};
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  // id 始终保留，便于指针回源
  if (record.id != null && out.id == null) out.id = record.id;
  return out;
}

function truncateRecord(record, maxChars) {
  const raw = JSON.stringify(record);
  if (raw.length <= maxChars) return { record, truncated: false, chars: raw.length };
  const clone = { ...record };
  // 优先截断较长的字符串字段
  const stringKeys = Object.keys(clone)
    .filter((key) => typeof clone[key] === 'string')
    .sort((a, b) => String(clone[b]).length - String(clone[a]).length);
  for (const key of stringKeys) {
    const current = JSON.stringify(clone);
    if (current.length <= maxChars) break;
    const overflow = current.length - maxChars + 40;
    const value = String(clone[key]);
    if (value.length <= overflow) {
      clone[key] = `${value.slice(0, Math.max(0, Math.floor(value.length / 2)))}…(truncated)`;
    } else {
      clone[key] = `${value.slice(0, Math.max(0, value.length - overflow))}…(truncated)`;
    }
  }
  const finalRaw = JSON.stringify(clone);
  if (finalRaw.length > maxChars) {
    return {
      record: { id: record.id || null, note: 'record exceeded budget', preview: finalRaw.slice(0, maxChars) },
      truncated: true,
      chars: maxChars,
    };
  }
  return { record: clone, truncated: true, chars: finalRaw.length };
}

function matchWhere(record, where) {
  if (!where || typeof where !== 'object') return true;
  for (const [key, expected] of Object.entries(where)) {
    const actual = record[key];
    if (expected == null) continue;
    if (typeof expected === 'string') {
      if (!String(actual ?? '').includes(expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function matchQuery(record, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const blob = JSON.stringify(record).toLowerCase();
  return blob.includes(q);
}

function listRecordsFromFixture(structured, {
  collection,
  where = null,
  query = null,
  limit = null,
} = {}) {
  const name = String(collection || '').trim();
  if (!name) throw new Error('run.record_list requires collection');
  const { collections, file } = loadFixtureBundle(structured);
  const entry = collections[name];
  if (!entry) {
    return {
      status: 'missing_collection',
      collection: name,
      source: file,
      records: [],
      detail: `collection not found: ${name}`,
      availableCollections: Object.keys(collections),
    };
  }
  const hint = (structured.collections && structured.collections[name]) || {};
  const listFields = hint.listFields || entry.listFields || null;
  const limits = structured.limits || DEFAULT_LIMITS;
  const maxList = Math.max(1, Math.min(Number(limit) || limits.maxList, limits.maxList));
  const whereKeys = where && typeof where === 'object' ? Object.keys(where) : [];
  if (whereKeys.length > limits.maxFilterKeys) {
    throw new Error(`where exceeds maxFilterKeys=${limits.maxFilterKeys}`);
  }

  const rows = Array.isArray(entry.records) ? entry.records : [];
  const normalized = rows.map((row, index) => {
    if (!row || typeof row !== 'object') return null;
    const fields = row.fields && typeof row.fields === 'object' ? row.fields : row;
    const id = row.id != null ? String(row.id) : (fields.id != null ? String(fields.id) : `row-${index + 1}`);
    return { id, ...fields, id };
  }).filter(Boolean);

  const filtered = normalized
    .filter((row) => matchWhere(row, where))
    .filter((row) => matchQuery(row, query));

  const records = filtered.slice(0, maxList).map((row) => projectFields(row, listFields));
  return {
    status: 'observed',
    mode: 'fixture',
    collection: name,
    source: file,
    description: hint.description || entry.description || '',
    totalMatched: filtered.length,
    returned: records.length,
    truncated: filtered.length > records.length,
    records,
  };
}

function getRecordFromFixture(structured, {
  collection,
  id,
} = {}) {
  const name = String(collection || '').trim();
  const recordId = String(id || '').trim();
  if (!name) throw new Error('run.record_get requires collection');
  if (!recordId) throw new Error('run.record_get requires id');
  const listed = listRecordsFromFixture(structured, { collection: name, limit: structured.limits.maxList });
  if (listed.status === 'missing_collection') return { ...listed, record: null };

  // get 需要完整字段：重新从 bundle 取
  const { collections, file } = loadFixtureBundle(structured);
  const entry = collections[name];
  const hint = (structured.collections && structured.collections[name]) || {};
  const getFields = hint.getFields || entry.getFields || null;
  const rows = Array.isArray(entry.records) ? entry.records : [];
  let found = null;
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const fields = row.fields && typeof row.fields === 'object' ? row.fields : row;
    const rid = row.id != null ? String(row.id) : (fields.id != null ? String(fields.id) : `row-${index + 1}`);
    if (rid === recordId) found = { id: rid, ...fields, id: rid };
  });
  if (!found) {
    return {
      status: 'missing_record',
      mode: 'fixture',
      collection: name,
      id: recordId,
      source: file,
      record: null,
      detail: `record not found: ${name}/${recordId}`,
    };
  }
  const projected = projectFields(found, getFields);
  const clipped = truncateRecord(projected, structured.limits.maxGetChars);
  return {
    status: 'observed',
    mode: 'fixture',
    collection: name,
    id: recordId,
    source: file,
    truncated: clipped.truncated,
    chars: clipped.chars,
    record: clipped.record,
  };
}

function listRecords(structured, args = {}) {
  if (!structured || !structured.enabled || structured.mode === 'none') {
    return {
      status: 'not_configured',
      records: [],
      detail: 'structuredRuntime disabled; no structured run records available',
    };
  }
  if (structured.mode === 'fixture') return listRecordsFromFixture(structured, args);
  if (structured.mode === 'sql') {
    return {
      status: 'not_implemented',
      mode: 'sql',
      records: [],
      detail: 'structuredRuntime.mode=sql is reserved; wire a readonly driver before use',
      allowQueries: Object.keys(structured.allowQueries || {}),
    };
  }
  throw new Error(`unsupported structuredRuntime.mode: ${structured.mode}`);
}

function getRecord(structured, args = {}) {
  if (!structured || !structured.enabled || structured.mode === 'none') {
    return {
      status: 'not_configured',
      record: null,
      detail: 'structuredRuntime disabled; no structured run records available',
    };
  }
  if (structured.mode === 'fixture') return getRecordFromFixture(structured, args);
  if (structured.mode === 'sql') {
    return {
      status: 'not_implemented',
      mode: 'sql',
      record: null,
      detail: 'structuredRuntime.mode=sql is reserved; wire a readonly driver before use',
      allowQueries: Object.keys(structured.allowQueries || {}),
    };
  }
  throw new Error(`unsupported structuredRuntime.mode: ${structured.mode}`);
}

function formatStructuredRuntime(structured) {
  if (!structured || !structured.enabled || structured.mode === 'none') return '';
  const lines = [
    '项目只读数据（第三面：元数据/文档/策略/任务/draft 等；不是日志文件的替代）：',
    `- 模式：${structured.mode}`,
    '- 操作：run.record_list / run.record_get（过渡名；先 list 名片，再 get 单条；禁止自由 SQL / 扫全库）',
  ];
  if (structured.mode === 'fixture') {
    lines.push(`- fixture：${structured.fixturePath}`);
  }
  if (structured.mode === 'sql') {
    lines.push('- sql：仅允许配置里的命名只读查询（自由 SQL 不对模型开放；驱动未接通时 not_implemented）');
  }
  const names = Object.keys(structured.collections || {});
  if (names.length) {
    lines.push(`- 已声明集合：${names.join(', ')}`);
    for (const name of names.slice(0, 8)) {
      const hint = structured.collections[name];
      if (hint && hint.description) lines.push(`  - ${name}：${hint.description}`);
    }
  }
  if (structured.notes) lines.push(`- 说明：${structured.notes}`);
  lines.push('- 规则：多条命中先列 id/摘要并追问；数据面事实不得与代码 HEAD 或未确认的日志候选混用。');
  return `${lines.join('\n')}\n`;
}

function listConfiguredCollections(structured) {
  if (!structured || !structured.enabled) return [];
  if (structured.mode === 'fixture') {
    try {
      const { collections } = loadFixtureBundle(structured);
      return Object.keys(collections);
    } catch {
      return Object.keys(structured.collections || {});
    }
  }
  return Object.keys(structured.collections || structured.allowQueries || {});
}

module.exports = {
  STRUCTURED_RUNTIME_SCHEMA,
  FIXTURE_SCHEMA,
  DEFAULT_LIMITS,
  MODES,
  normalizeStructuredRuntime,
  listRecords,
  getRecord,
  formatStructuredRuntime,
  listConfiguredCollections,
  loadFixtureBundle,
};
