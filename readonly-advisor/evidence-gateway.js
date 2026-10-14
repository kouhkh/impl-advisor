'use strict';

/**
 * 证据网关：把代码/运行材料访问收成少量固定操作，返回结构化证据卡。
 * harness 负责怎么调工具；本模块负责「允许找什么、找到了什么」。
 *
 * 不做完整沙箱。权限控制（独立用户 / ACL / SSH jail）在外层。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EVIDENCE_CARD_SCHEMA = 'readonly-advisor-evidence-card/1';
const GATEWAY_OPS = Object.freeze([
  'code.search',
  'code.read',
  'run.list',
  'run.summary',
  'run.log_slice',
  'run.record_list',
  'run.record_get',
  'version.bind',
]);

const DEFAULT_READ_BUDGET = 6000;
const DEFAULT_SEARCH_HITS = 20;
const DEFAULT_LOG_LINES = 40;

function nowIso() {
  return new Date().toISOString();
}

function makeCard({
  op,
  kind,
  status = 'observed',
  title,
  summary = '',
  pointers = [],
  payload = null,
  budgetChars = null,
} = {}) {
  if (!GATEWAY_OPS.includes(op)) {
    throw new Error(`unknown evidence gateway op: ${op}`);
  }
  if (!['observed', 'derived', 'confirmed', 'stale'].includes(status)) {
    throw new Error(`invalid evidence status: ${status}`);
  }
  return {
    schemaVersion: EVIDENCE_CARD_SCHEMA,
    id: `${op.replace(/\./g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    op,
    kind: kind || op.split('.')[0],
    status,
    title: String(title || op),
    summary: String(summary || '').slice(0, 800),
    pointers: (Array.isArray(pointers) ? pointers : []).map(String).slice(0, 24),
    payload: payload == null ? null : payload,
    budgetChars: budgetChars == null ? null : Number(budgetChars),
    observedAt: nowIso(),
  };
}

function assertInsideWorkspace(filePath, workspace) {
  const root = path.resolve(workspace);
  // 相对路径一律相对 workspace，避免 cwd 不同导致误判逃逸。
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`path escapes workspace: ${filePath}`);
  }
  return resolved;
}

function codeSearch(config, { query, maxHits = DEFAULT_SEARCH_HITS } = {}) {
  const workspace = path.resolve(config.workspace);
  const q = String(query || '').trim();
  if (!q) throw new Error('code.search requires query');
  const result = spawnSync(
    'rg',
    ['-n', '--no-heading', '-S', '-m', String(Math.max(1, maxHits)), '--', q, '.'],
    { cwd: workspace, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  );
  // rg exit 1 = no matches; 2 = error
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    const detail = (result.stderr || result.error && result.error.message || '').trim().slice(0, 400);
    return makeCard({
      op: 'code.search',
      kind: 'code',
      status: 'observed',
      title: `code.search 失败：${q}`,
      summary: detail || `rg status ${result.status}`,
      pointers: [],
      payload: { query: q, hits: [], error: detail || `status ${result.status}` },
    });
  }
  const hits = String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxHits)
    .map((line) => {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) return { raw: line };
      return { path: m[1], line: Number(m[2]), text: m[3].slice(0, 240) };
    });
  return makeCard({
    op: 'code.search',
    kind: 'code',
    status: 'observed',
    title: `code.search：${q}`,
    summary: hits.length ? `命中 ${hits.length} 处` : '无命中',
    pointers: hits.map((h) => (h.path ? `${h.path}:${h.line}` : h.raw)).slice(0, 20),
    payload: { query: q, hits },
  });
}

function codeRead(config, { file, startLine = 1, maxChars = DEFAULT_READ_BUDGET } = {}) {
  const workspace = path.resolve(config.workspace);
  const resolved = assertInsideWorkspace(file, workspace);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`code.read target missing: ${file}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const lines = raw.split(/\r?\n/);
  const from = Math.max(1, Number(startLine) || 1);
  const slice = lines.slice(from - 1).join('\n');
  const budget = Math.max(200, Number(maxChars) || DEFAULT_READ_BUDGET);
  const text = slice.length <= budget
    ? slice
    : `${slice.slice(0, budget)}\n…(code.read truncated at ${budget} chars)`;
  const rel = path.relative(workspace, resolved);
  return makeCard({
    op: 'code.read',
    kind: 'code',
    status: 'observed',
    title: `code.read：${rel}`,
    summary: `从第 ${from} 行起，共 ${text.length} 字符`,
    pointers: [`${rel}:${from}`],
    payload: { path: rel, startLine: from, text },
    budgetChars: budget,
  });
}

function runList(config, {
  question = '',
  pageContext = null,
  runSshOpFn = null,
  auditPath = null,
  force = false,
} = {}) {
  const { searchRunCandidates } = require('./runtime-search');
  const { runSshOp, defaultAuditPath } = require('./ssh-readonly');
  const runtimeSearch = searchRunCandidates(config, {
    runSshOpFn: runSshOpFn || runSshOp,
    auditPath: auditPath || defaultAuditPath(config.project),
    question,
    pageContext,
    force,
  });
  const classification = runtimeSearch.classification || { status: runtimeSearch.status };
  const candidates = runtimeSearch.candidates || [];
  return makeCard({
    op: 'run.list',
    kind: 'run',
    status: 'observed',
    title: `run.list：${classification.status || runtimeSearch.status}`,
    summary: classification.detail || runtimeSearch.detail || runtimeSearch.error || '',
    pointers: candidates.slice(0, 12).map((c) => c.path).filter(Boolean),
    payload: {
      status: runtimeSearch.status,
      classification,
      roots: runtimeSearch.roots || [],
      candidates: candidates.slice(0, 24),
      host: runtimeSearch.host || null,
    },
  });
}

function runSummary(runtimeSearchOrCard) {
  const runtimeSearch = runtimeSearchOrCard && runtimeSearchOrCard.payload
    ? runtimeSearchOrCard.payload
    : runtimeSearchOrCard;
  if (!runtimeSearch) {
    return makeCard({
      op: 'run.summary',
      kind: 'run',
      status: 'derived',
      title: 'run.summary：无候选数据',
      summary: '尚未执行 run.list',
      pointers: [],
      payload: { status: 'missing' },
    });
  }
  const classification = runtimeSearch.classification || { status: runtimeSearch.status };
  const candidates = runtimeSearch.candidates || [];
  return makeCard({
    op: 'run.summary',
    kind: 'run',
    status: 'derived',
    title: `run.summary：${classification.status || runtimeSearch.status}`,
    summary: [
      classification.detail || runtimeSearch.detail || '',
      `候选数=${candidates.length}`,
      classification.status === 'multiple' ? '须先确认唯一候选，禁止混读' : '',
      classification.status === 'none' ? '缺运行材料，不得编造 run_id' : '',
    ].filter(Boolean).join('；'),
    pointers: candidates.slice(0, 8).map((c) => c.path).filter(Boolean),
    payload: {
      status: runtimeSearch.status,
      classification,
      candidateCount: candidates.length,
      selected: null,
    },
  });
}

function runLogSlice(config, {
  candidatePath,
  lines = DEFAULT_LOG_LINES,
  classification = null,
  confirmed = false,
  runSshOpFn = null,
  auditPath = null,
} = {}) {
  // 策略拒绝优先于传输层检查：多候选/无候选时直接返回卡片，不要求 ssh。
  if (classification && classification.status === 'multiple' && !confirmed) {
    return makeCard({
      op: 'run.log_slice',
      kind: 'run',
      status: 'derived',
      title: 'run.log_slice 拒绝：多候选未确认',
      summary: '多个运行候选时不得自动读日志正文；先确认唯一候选。',
      pointers: [],
      payload: { refused: true, reason: 'multiple_unconfirmed' },
    });
  }
  if (classification && classification.status === 'none') {
    return makeCard({
      op: 'run.log_slice',
      kind: 'run',
      status: 'derived',
      title: 'run.log_slice 拒绝：无候选',
      summary: '没有可读取的运行候选。',
      pointers: [],
      payload: { refused: true, reason: 'none' },
    });
  }
  const runtime = config.runtime || { mode: 'none' };
  if (runtime.mode !== 'ssh') {
    throw new Error('run.log_slice requires runtime.mode=ssh');
  }
  if (!candidatePath) throw new Error('run.log_slice requires candidatePath');
  const { runSshOp, defaultAuditPath } = require('./ssh-readonly');
  const rel = String(candidatePath).replace(/^\/+/, '');
  const result = (runSshOpFn || runSshOp)(runtime, {
    op: 'head',
    args: { path: rel, lines: Math.max(1, Math.min(Number(lines) || DEFAULT_LOG_LINES, 80)) },
    auditPath: auditPath || defaultAuditPath(config.project),
  });
  const text = String(result.stdout || '').slice(0, DEFAULT_READ_BUDGET);
  return makeCard({
    op: 'run.log_slice',
    kind: 'run',
    status: confirmed ? 'confirmed' : 'observed',
    title: `run.log_slice：${rel}`,
    summary: `head ${lines} 行，${text.length} 字符`,
    pointers: [rel],
    payload: { path: rel, text, ms: result.ms },
    budgetChars: DEFAULT_READ_BUDGET,
  });
}

function collectLocalGitFacts(workspace) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
    if (result.status !== 0) return null;
    return result.stdout.trim();
  };
  const status = git(['status', '--porcelain=v1']);
  return {
    root: git(['rev-parse', '--show-toplevel']),
    branch: git(['branch', '--show-current']) || null,
    commit: git(['rev-parse', '--short', 'HEAD']) || null,
    fullCommit: git(['rev-parse', 'HEAD']) || null,
    dirty: Boolean(status),
  };
}

function runRecordList(config, args = {}) {
  const { listRecords } = require('./structured-runtime');
  const structured = config.structuredRuntime || { mode: 'none', enabled: false };
  const result = listRecords(structured, args);
  const records = result.records || [];
  return makeCard({
    op: 'run.record_list',
    kind: 'run',
    status: result.status === 'observed' ? 'observed' : 'derived',
    title: `run.record_list：${args.collection || '?'} (${result.status})`,
    summary: result.detail
      || `${result.returned || 0}/${result.totalMatched || 0} records`
      || '',
    pointers: records.map((row) => `${args.collection}/${row.id}`).filter(Boolean).slice(0, 20),
    payload: result,
  });
}

function runRecordGet(config, args = {}) {
  const { getRecord } = require('./structured-runtime');
  const structured = config.structuredRuntime || { mode: 'none', enabled: false };
  const result = getRecord(structured, args);
  const pointer = args.collection && args.id ? `${args.collection}/${args.id}` : null;
  return makeCard({
    op: 'run.record_get',
    kind: 'run',
    status: result.status === 'observed' ? 'observed' : 'derived',
    title: `run.record_get：${pointer || '?'} (${result.status})`,
    summary: result.detail
      || (result.record ? `chars=${result.chars || 0}${result.truncated ? ' truncated' : ''}` : 'no record'),
    pointers: pointer ? [pointer] : [],
    payload: result,
    budgetChars: structured.limits && structured.limits.maxGetChars,
  });
}

function versionBind(config, {
  includeDeploySnapshot = true,
  collectWorkspaceFactsFn = null,
  runSshOpFn = null,
  auditPath = null,
} = {}) {
  const { bindVersions } = require('./version-binding');
  const { runSshOp, defaultAuditPath } = require('./ssh-readonly');
  const versions = bindVersions(config, {
    collectWorkspaceFactsFn: collectWorkspaceFactsFn || ((workspace) => collectLocalGitFacts(workspace || config.workspace)),
    runSshOpFn: runSshOpFn || runSshOp,
    auditPath: auditPath || defaultAuditPath(config.project),
    includeDeploySnapshot,
  });
  const code = versions.code || {};
  const deploy = versions.deploy || {};
  const comparison = versions.comparison || {};
  return makeCard({
    op: 'version.bind',
    kind: 'version',
    status: 'observed',
    title: `version.bind：${comparison.status || 'unknown'}`,
    summary: comparison.detail || '',
    pointers: [
      code.fullCommit || code.commit ? `code:${code.fullCommit || code.commit}` : null,
      deploy.releaseSha ? `deploy:${deploy.releaseSha}` : null,
    ].filter(Boolean),
    payload: versions,
  });
}

/**
 * 把 ask 预检产物（versions / runtimeSearch）收成证据卡，供工作记忆入库。
 */
function cardsFromAskContext({ versions = null, runtimeSearch = null } = {}) {
  const cards = [];
  if (versions) {
    const comparison = versions.comparison || {};
    const code = versions.code || {};
    const deploy = versions.deploy || {};
    cards.push(makeCard({
      op: 'version.bind',
      kind: 'version',
      status: 'observed',
      title: `version.bind：${comparison.status || 'unknown'}`,
      summary: comparison.detail || '',
      pointers: [
        code.fullCommit || code.commit ? `code:${code.fullCommit || code.commit}` : null,
        deploy.releaseSha ? `deploy:${deploy.releaseSha}` : null,
      ].filter(Boolean),
      payload: {
        comparison,
        codeCommit: code.fullCommit || code.commit || null,
        deploySha: deploy.releaseSha || null,
      },
    }));
  }
  if (runtimeSearch) {
    cards.push(runSummary(runtimeSearch));
    if (runtimeSearch.status === 'observed' || (runtimeSearch.candidates || []).length) {
      cards.push(makeCard({
        op: 'run.list',
        kind: 'run',
        status: 'observed',
        title: `run.list：${(runtimeSearch.classification && runtimeSearch.classification.status) || runtimeSearch.status}`,
        summary: (runtimeSearch.classification && runtimeSearch.classification.detail)
          || runtimeSearch.detail
          || '',
        pointers: (runtimeSearch.candidates || []).slice(0, 12).map((c) => c.path).filter(Boolean),
        payload: {
          status: runtimeSearch.status,
          classification: runtimeSearch.classification || null,
          roots: runtimeSearch.roots || [],
          candidates: (runtimeSearch.candidates || []).slice(0, 24),
        },
      }));
    }
  }
  return cards;
}

function executeOp(op, config, args = {}) {
  switch (op) {
    case 'code.search':
      return codeSearch(config, args);
    case 'code.read':
      return codeRead(config, args);
    case 'run.list':
      return runList(config, args);
    case 'run.summary':
      return runSummary(args.runtimeSearch || args.card || args);
    case 'run.log_slice':
      return runLogSlice(config, args);
    case 'run.record_list':
      return runRecordList(config, args);
    case 'run.record_get':
      return runRecordGet(config, args);
    case 'version.bind':
      return versionBind(config, args);
    default:
      throw new Error(`unknown evidence gateway op: ${op}`);
  }
}

module.exports = {
  EVIDENCE_CARD_SCHEMA,
  GATEWAY_OPS,
  DEFAULT_READ_BUDGET,
  makeCard,
  codeSearch,
  codeRead,
  runList,
  runSummary,
  runLogSlice,
  runRecordList,
  runRecordGet,
  versionBind,
  cardsFromAskContext,
  executeOp,
};
