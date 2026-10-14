'use strict';

/**
 * Minimal external project/task memory (advisor workspace only).
 * Does not write into the target code repository.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_NOTES_BUDGET = 6000;
const DEFAULT_MEMORY_BUDGET = 8000;
const DEFAULT_FOLLOWUP_BUDGET = 4000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function memoryRoot(config) {
  if (config.memoryDir) return path.resolve(config.memoryDir);
  const home = config.notesDir
    ? path.dirname(config.notesDir)
    : path.join(require('node:os').homedir(), '.impl-advisor', config.project || 'project');
  return path.join(home, 'memory');
}

function git(workspace, args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function listTopEntries(dir, limit = 40) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .slice(0, limit)
    .map((name) => {
      const full = path.join(dir, name);
      let kind = 'file';
      try {
        kind = fs.statSync(full).isDirectory() ? 'dir' : 'file';
      } catch {
        kind = 'unknown';
      }
      return { name, kind };
    });
}

function detectPackageHints(workspace) {
  const hints = [];
  for (const file of ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'README.md']) {
    const full = path.join(workspace, file);
    if (fs.existsSync(full)) hints.push(file);
  }
  let packageName = null;
  const pkg = path.join(workspace, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      packageName = JSON.parse(fs.readFileSync(pkg, 'utf8')).name || null;
    } catch {
      packageName = null;
    }
  }
  return { manifestFiles: hints, packageName };
}

function generateProjectMemory(config, { revision = null } = {}) {
  const workspace = path.resolve(config.workspace);
  const commit = revision || git(workspace, ['rev-parse', '--short', 'HEAD']) || 'unknown';
  const branch = git(workspace, ['branch', '--show-current']);
  const manifests = detectPackageHints(workspace);
  const top = listTopEntries(workspace);
  const entry = {
    status: 'observed',
    source: 'advisor-generate-project-memory',
    revision: commit,
    branch: branch || null,
    observedAt: new Date().toISOString(),
    project: config.project || null,
    workspace,
    packageName: manifests.packageName,
    manifestFiles: manifests.manifestFiles,
    topLevel: top,
    importantPaths: config.importantPaths || {},
    notes: 'Auto-generated directory/manifest observation. Re-read sources before treating as business fact.',
  };
  const root = memoryRoot(config);
  const outDir = path.join(root, 'project-memory');
  ensureDir(outDir);
  const jsonl = path.join(outDir, `${commit}.jsonl`);
  fs.appendFileSync(jsonl, `${JSON.stringify(entry)}\n`, 'utf8');
  const md = path.join(outDir, `${commit}.md`);
  const mdBody = [
    `# project-memory ${commit}`,
    '',
    `- status: ${entry.status}`,
    `- observedAt: ${entry.observedAt}`,
    `- workspace: ${workspace}`,
    `- branch: ${entry.branch || 'unknown'}`,
    `- package: ${entry.packageName || 'unknown'}`,
    `- manifests: ${(entry.manifestFiles || []).join(', ') || 'none'}`,
    '',
    '## Top-level',
    '',
    ...top.map((row) => `- ${row.kind}: ${row.name}`),
    '',
  ].join('\n');
  fs.writeFileSync(md, mdBody, 'utf8');
  return { entry, jsonl, md, memoryRoot: root };
}

function generateTaskMemory(config, {
  task = null,
  question = null,
  revision = null,
  extra = {},
} = {}) {
  const workspace = path.resolve(config.workspace);
  const commit = revision || git(workspace, ['rev-parse', '--short', 'HEAD']) || 'unknown';
  const taskId = String(task || config.task || 'default-task')
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .slice(0, 80) || 'default-task';
  const entry = {
    status: 'derived',
    source: 'advisor-generate-task-memory',
    revision: commit,
    task: taskId,
    observedAt: new Date().toISOString(),
    project: config.project || null,
    questionSeed: question || null,
    terms: config.terms || {},
    importantPaths: config.importantPaths || {},
    taskContextPaths: config.taskContextPaths || [],
    runtimeHints: {
      mode: (config.runtime && config.runtime.mode) || 'none',
      candidateRoots: (config.runtime && config.runtime.candidateRoots) || null,
    },
    openQuestions: [
      'Which paths are authoritative for this task input/output?',
      'Which runtime roots hold evidence for instance questions?',
    ],
    ...extra,
  };
  const root = memoryRoot(config);
  const outDir = path.join(root, 'task-memory', taskId);
  ensureDir(outDir);
  const jsonl = path.join(outDir, `${commit}.jsonl`);
  fs.appendFileSync(jsonl, `${JSON.stringify(entry)}\n`, 'utf8');
  const md = path.join(outDir, `${commit}.md`);
  const mdBody = [
    `# task-memory ${taskId} @ ${commit}`,
    '',
    `- status: ${entry.status} (not confirmed)`,
    `- observedAt: ${entry.observedAt}`,
    `- questionSeed: ${entry.questionSeed || ''}`,
    '',
    '## Paths / terms',
    '',
    `- importantPaths: ${JSON.stringify(entry.importantPaths)}`,
    `- taskContextPaths: ${JSON.stringify(entry.taskContextPaths)}`,
    `- terms: ${JSON.stringify(entry.terms)}`,
    '',
    '## Open questions',
    '',
    ...entry.openQuestions.map((q) => `- ${q}`),
    '',
  ].join('\n');
  fs.writeFileSync(md, mdBody, 'utf8');
  return { entry, jsonl, md, memoryRoot: root, taskId };
}

function confirmMemoryFact(config, {
  kind = 'confirmed',
  text,
  sourceSession = null,
  revision = null,
} = {}) {
  if (!text || !String(text).trim()) throw new Error('confirmMemoryFact requires text');
  const root = memoryRoot(config);
  const file = path.join(root, 'confirmed-facts.jsonl');
  ensureDir(root);
  const entry = {
    status: 'confirmed',
    kind,
    text: String(text).trim(),
    sourceSession,
    revision: revision || null,
    confirmedAt: new Date().toISOString(),
    project: config.project || null,
  };
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return { file, entry };
}

function slugRunKey(value, fallback = 'run') {
  const raw = String(value || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  return raw || fallback;
}

/**
 * 单次运行记忆：与 project/task 地图严格分目录。
 * 只记录「某次部署/候选/日志指针」，禁止写成项目长期事实。
 */
function generateRunMemory(config, {
  runKey = null,
  sessionId = null,
  question = null,
  versions = null,
  runtimeSearch = null,
  selectedCandidate = null,
  note = null,
} = {}) {
  const classification = runtimeSearch && (runtimeSearch.classification || null);
  const status = (classification && classification.status)
    || (runtimeSearch && runtimeSearch.status)
    || 'unknown';
  const candidates = (runtimeSearch && Array.isArray(runtimeSearch.candidates))
    ? runtimeSearch.candidates
    : [];
  const deploySha = versions && versions.deploy
    ? (versions.deploy.releaseSha || versions.deploy.currentBasename || null)
    : null;
  const codeCommit = versions && versions.code
    ? (versions.code.commit || versions.code.fullCommit || null)
    : null;
  const key = slugRunKey(
    runKey
      || selectedCandidate
      || (candidates.length === 1 && candidates[0].path)
      || deploySha
      || sessionId
      || `run-${Date.now()}`,
  );
  const entry = {
    schemaVersion: 'readonly-advisor-run-memory/1',
    kind: 'run-memory',
    status: status === 'single' || selectedCandidate ? 'observed' : 'derived',
    source: 'advisor-generate-run-memory',
    runKey: key,
    observedAt: new Date().toISOString(),
    project: config.project || null,
    sessionId: sessionId || null,
    questionSeed: question || null,
    note: note || null,
    versionBind: versions && versions.comparison
      ? {
        status: versions.comparison.status,
        codeCommit,
        deploySha,
        detail: versions.comparison.detail || null,
      }
      : { status: 'unknown', codeCommit, deploySha },
    runCandidate: {
      status,
      selected: selectedCandidate || (status === 'single' && candidates[0] ? candidates[0].path : null),
      candidateCount: candidates.length,
      roots: (runtimeSearch && runtimeSearch.roots) || null,
      pointers: candidates.slice(0, 12).map((row) => row.path || row),
      detail: (classification && classification.detail)
        || (runtimeSearch && runtimeSearch.detail)
        || null,
    },
    warning: 'run-memory 仅描述单次运行材料，不得当作项目地图或长期业务事实。',
  };
  const root = memoryRoot(config);
  const outDir = path.join(root, 'run-memory', key);
  ensureDir(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonl = path.join(outDir, 'events.jsonl');
  fs.appendFileSync(jsonl, `${JSON.stringify(entry)}\n`, 'utf8');
  const md = path.join(outDir, `${stamp}.md`);
  const mdBody = [
    `# run-memory ${key}`,
    '',
    `- status: ${entry.status}`,
    `- observedAt: ${entry.observedAt}`,
    `- session: ${entry.sessionId || 'n/a'}`,
    `- version: ${entry.versionBind.status} code=${entry.versionBind.codeCommit || '?'} deploy=${entry.versionBind.deploySha || '?'}`,
    `- runCandidate: ${entry.runCandidate.status} selected=${entry.runCandidate.selected || 'none'} count=${entry.runCandidate.candidateCount}`,
    '',
    '> 警告：这是单次运行记忆，不要与 project-memory / task-memory 混读成长期事实。',
    '',
    '## Pointers',
    '',
    ...(entry.runCandidate.pointers.length
      ? entry.runCandidate.pointers.map((p) => `- ${p}`)
      : ['- (none)']),
    '',
    entry.runCandidate.detail ? `## Detail\n\n${entry.runCandidate.detail}\n` : '',
    entry.questionSeed ? `## Question seed\n\n${entry.questionSeed}\n` : '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(md, mdBody, 'utf8');
  writeJson(path.join(outDir, 'latest.json'), entry);
  return { entry, jsonl, md, memoryRoot: root, runKey: key, outDir };
}

function recordRunMemoryFromSession(config, {
  sessionId,
  question = null,
  versions = null,
  runtimeSearch = null,
  selectedCandidate = null,
} = {}) {
  if (!runtimeSearch && !versions) return null;
  const useful = runtimeSearch
    && ['observed', 'error'].includes(runtimeSearch.status);
  const hasVersions = Boolean(versions && (versions.code || versions.deploy));
  if (!useful && !hasVersions) return null;
  return generateRunMemory(config, {
    sessionId,
    question,
    versions,
    runtimeSearch,
    selectedCandidate,
  });
}

function latestMemoryMarkdown(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  const full = path.join(dir, files[0].name);
  return { path: full, body: fs.readFileSync(full, 'utf8') };
}

function scoreTextAgainstQuestion(text, question) {
  const q = String(question || '').toLowerCase();
  if (!q) return 0;
  const body = String(text || '').toLowerCase();
  let score = 0;
  for (const token of q.split(/[^\p{L}\p{N}_/-]+/u).filter((t) => t.length >= 2).slice(0, 24)) {
    if (body.includes(token)) score += 1;
  }
  return score;
}

function truncateText(text, budget) {
  const raw = String(text || '').trim();
  if (raw.length <= budget) return raw;
  return `${raw.slice(0, Math.max(0, budget - 20)).trimEnd()}\n…(truncated)`;
}

function loadMemoryForPrompt(config, { question = '', budget = DEFAULT_MEMORY_BUDGET } = {}) {
  if (config.memory === false || (config.memory && config.memory.enabled === false)) {
    return { text: '', files: [], skipped: 'memory disabled' };
  }
  const root = memoryRoot(config);
  const chunks = [];
  const files = [];
  const projectDir = path.join(root, 'project-memory');
  const project = latestMemoryMarkdown(projectDir);
  if (project) {
    chunks.push({ role: 'project-memory', score: 1 + scoreTextAgainstQuestion(project.body, question), ...project });
  }
  const taskName = String(config.task || 'default-task')
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .slice(0, 80) || 'default-task';
  const taskDir = path.join(root, 'task-memory', taskName);
  const task = latestMemoryMarkdown(taskDir);
  if (task) {
    chunks.push({ role: 'task-memory', score: 2 + scoreTextAgainstQuestion(task.body, question), ...task });
  }
  // Also try any task-memory folder that matches question tokens
  const taskRoot = path.join(root, 'task-memory');
  if (fs.existsSync(taskRoot)) {
    for (const name of fs.readdirSync(taskRoot)) {
      if (name === taskName) continue;
      const hit = latestMemoryMarkdown(path.join(taskRoot, name));
      if (!hit) continue;
      const score = scoreTextAgainstQuestion(`${name}\n${hit.body}`, question);
      if (score >= 2) chunks.push({ role: `task-memory:${name}`, score, ...hit });
    }
  }
  // run-memory：仅当问题像运行/部署相关时才注入，且单独标注，绝不并入 project 地图。
  const runtimeLike = /运行|日志|deploy|候选|job|ssh|版本|改写记录|适配|测试/i.test(question || '');
  const runRoot = path.join(root, 'run-memory');
  if (runtimeLike && fs.existsSync(runRoot)) {
    for (const name of fs.readdirSync(runRoot)) {
      const hit = latestMemoryMarkdown(path.join(runRoot, name));
      if (!hit) continue;
      const score = 3 + scoreTextAgainstQuestion(`${name}\n${hit.body}`, question);
      if (score >= 4) {
        chunks.push({ role: `run-memory:${name}`, score, ...hit });
      }
    }
  }
  chunks.sort((a, b) => b.score - a.score);
  const selected = [];
  let used = 0;
  // 最多 2 条 project/task + 1 条 run-memory，避免运行片段淹没地图
  let runSlots = 1;
  let otherSlots = 2;
  for (const chunk of chunks) {
    const isRun = String(chunk.role).startsWith('run-memory');
    if (isRun) {
      if (runSlots <= 0) continue;
      runSlots -= 1;
    } else {
      if (otherSlots <= 0) continue;
      otherSlots -= 1;
    }
    const header = `### ${chunk.role} (${path.basename(chunk.path)})\n`;
    const room = budget - used - header.length;
    if (room < 200) break;
    const body = truncateText(chunk.body, room);
    selected.push(`${header}${body}`);
    files.push(chunk.path);
    used += header.length + body.length;
    if (runSlots <= 0 && otherSlots <= 0) break;
  }
  if (!selected.length) return { text: '', files: [], skipped: 'no memory files' };
  return {
    text: `外置记忆（顾问工作区，可能过期；以回源为准；预算 ${budget} 字符；run-memory 仅单次运行指针）：\n${selected.join('\n\n')}\n`,
    files,
    skipped: null,
  };
}

function formatNotesWithBudget(config, { question = '', budget = DEFAULT_NOTES_BUDGET } = {}) {
  const NOTE_FILES = ['map.md', 'task.md', 'runtime-reading.md'];
  const notesDir = config.notesDir;
  if (!notesDir || !fs.existsSync(notesDir)) return '';
  const scored = [];
  for (const name of NOTE_FILES) {
    const file = path.join(notesDir, name);
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file, 'utf8').trim();
    if (!body) continue;
    let roleBoost = name === 'task.md' ? 2 : name === 'map.md' ? 1 : 1;
    if (/运行|日志|deploy|候选|job/i.test(question || '') && name === 'runtime-reading.md') roleBoost += 2;
    if (/目录|模块|入口|路径/i.test(question || '') && name === 'map.md') roleBoost += 2;
    scored.push({
      name,
      body,
      score: roleBoost + scoreTextAgainstQuestion(body, question),
    });
  }
  if (!scored.length) return '';
  scored.sort((a, b) => b.score - a.score);
  const totalRaw = scored.reduce((sum, item) => sum + item.body.length + item.name.length + 8, 0);
  // If everything fits, keep all notes; otherwise keep the top-scored subset.
  const picked = totalRaw <= budget ? scored : scored.slice(0, 2);
  const parts = [];
  let used = 0;
  for (const item of picked) {
    const header = `### ${item.name}\n`;
    const room = budget - used - header.length;
    if (room < 120) break;
    const body = truncateText(item.body, room);
    parts.push(`${header}${body}`);
    used += header.length + body.length;
  }
  if (!parts.length) return '';
  return `外部查询笔记（按问题挑选，预算 ${budget} 字符；可能过期）：\n${parts.join('\n\n')}\n`;
}

function buildFollowupBrief(sessionDir, { budget = DEFAULT_FOLLOWUP_BUDGET } = {}) {
  // Prefer the bounded cross-turn working memory. Older sessions may not have
  // it yet, so retain the legacy one-turn fallback below for compatibility.
  try {
    const { buildWorkingMemoryBrief } = require('./working-memory');
    const working = buildWorkingMemoryBrief(sessionDir, { budget });
    if (working) return working;
  } catch {
    // A malformed or partially written working-memory file must not make an
    // existing session impossible to continue.
  }
  const answerPath = path.join(sessionDir, 'answer.md');
  const questionPath = path.join(sessionDir, 'question.md');
  const metaPath = path.join(sessionDir, 'session.json');
  const parts = ['上一轮会话摘要（完整 transcript 仅落盘，不重复注入）：'];
  if (fs.existsSync(metaPath)) {
    try {
      const meta = readJson(metaPath);
      parts.push(`- session: ${meta.sessionId || path.basename(sessionDir)}`);
      parts.push(`- turns: ${meta.turns || 1}`);
      if (meta.observation && meta.observation.dshSessionId) {
        parts.push(`- lastDshSession: ${meta.observation.dshSessionId}`);
      }
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(questionPath)) {
    parts.push('', '## 上轮问题', truncateText(fs.readFileSync(questionPath, 'utf8'), 800));
  }
  if (fs.existsSync(answerPath)) {
    parts.push('', '## 上轮结论摘要', truncateText(fs.readFileSync(answerPath, 'utf8'), Math.max(600, budget - 1200)));
  }
  const evidence = [];
  for (const name of ['agent-trace.md', 'runtime-candidates.json', 'versions.json']) {
    if (fs.existsSync(path.join(sessionDir, name))) evidence.push(name);
  }
  if (evidence.length) {
    parts.push('', `## 证据指针（同目录文件）`, evidence.map((n) => `- ${n}`).join('\n'));
  }
  parts.push('', '未决：若上轮要求确认运行候选，本轮须先确认后再读正文。');
  return truncateText(parts.join('\n'), budget);
}

module.exports = {
  DEFAULT_NOTES_BUDGET,
  DEFAULT_MEMORY_BUDGET,
  DEFAULT_FOLLOWUP_BUDGET,
  memoryRoot,
  generateProjectMemory,
  generateTaskMemory,
  generateRunMemory,
  recordRunMemoryFromSession,
  confirmMemoryFact,
  loadMemoryForPrompt,
  formatNotesWithBudget,
  buildFollowupBrief,
  truncateText,
  scoreTextAgainstQuestion,
  slugRunKey,
};
