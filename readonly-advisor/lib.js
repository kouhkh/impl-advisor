'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SCHEMA_VERSION = 'readonly-advisor-session/1';
const CONFIG_SCHEMA_VERSION = 'readonly-advisor-project/1';
const RUNTIME_MODES = new Set(['export-dir', 'none']);

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

function nowId(prefix = 'session') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const random = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${stamp}-${random}`;
}

function resolveWorkspace(config) {
  const workspace = path.resolve(config.workspace || '.');
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error(`workspace does not exist: ${workspace}`);
  }
  return workspace;
}

function git(workspace, args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function collectWorkspaceFacts(workspace) {
  const root = git(workspace, ['rev-parse', '--show-toplevel']);
  const commit = git(workspace, ['rev-parse', '--short', 'HEAD']);
  const branch = git(workspace, ['branch', '--show-current']);
  const status = git(workspace, ['status', '--porcelain=v1']);
  return {
    root,
    branch: branch || null,
    commit: commit || null,
    dirty: Boolean(status),
  };
}

function defaultAdvisorHome(project) {
  return path.join(os.homedir(), '.impl-advisor', project || 'project');
}

function defaultRecordDir(project) {
  return path.join(defaultAdvisorHome(project), 'sessions');
}

function defaultConfigPath(project) {
  return path.join(defaultAdvisorHome(project), 'project.json');
}

function defaultNotesDir(project) {
  return path.join(defaultAdvisorHome(project), 'notes');
}

function defaultDshBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;
  const bundled = '/Users/ltc/DshProject/deepseek-harness/apps/cli/lib/bin.js';
  return fs.existsSync(bundled) ? bundled : 'dsh';
}

function normalizeExecutable(value) {
  if (!value) return defaultDshBin();
  return value.includes('/') ? path.resolve(value) : value;
}

function isInside(child, parent) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${path.sep}`);
}

function normalizeRuntime(raw, workspace) {
  if (raw == null) {
    return { mode: 'none' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('runtime must be an object');
  }
  const mode = raw.mode || 'none';
  if (!RUNTIME_MODES.has(mode)) {
    throw new Error(`unsupported runtime.mode: ${mode} (allowed: ${[...RUNTIME_MODES].join(', ')})`);
  }
  if (mode === 'none') return { mode: 'none' };
  const exportDir = path.resolve(raw.exportDir || '');
  if (!raw.exportDir) throw new Error('runtime.mode=export-dir requires runtime.exportDir');
  if (!fs.existsSync(exportDir) || !fs.statSync(exportDir).isDirectory()) {
    throw new Error(`runtime.exportDir does not exist: ${exportDir}`);
  }
  if (isInside(exportDir, workspace)) {
    // Allowed but unusual; keep a note so operators know materials live under code tree.
  }
  return {
    mode: 'export-dir',
    exportDir,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

function loadConfig(file) {
  const configPath = path.resolve(file);
  const config = readJson(configPath);
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`unsupported config schema: ${config.schemaVersion || 'missing'}`);
  }
  if (config.readOnly !== true) throw new Error('readonly advisor requires readOnly: true');
  config.__configPath = configPath;
  config.workspace = resolveWorkspace(config);
  config.recordDir = path.resolve(config.recordDir || defaultRecordDir(config.project || 'project'));
  config.notesDir = path.resolve(config.notesDir || defaultNotesDir(config.project || 'project'));
  if (isInside(config.recordDir, config.workspace)) {
    throw new Error(`recordDir must stay outside target workspace: ${config.recordDir}`);
  }
  if (isInside(configPath, config.workspace)) {
    throw new Error(`advisor config must stay outside target workspace: ${configPath}`);
  }
  if (isInside(config.notesDir, config.workspace)) {
    throw new Error(`notesDir must stay outside target workspace: ${config.notesDir}`);
  }
  config.runtime = normalizeRuntime(config.runtime, config.workspace);
  config.environment = config.environment || null;
  config.dshBin = normalizeExecutable(config.dshBin);
  config.dshHome = config.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return config;
}

function formatRetrieval(config) {
  const retrieval = config.retrieval;
  if (!retrieval || typeof retrieval !== 'object') return '';
  const provider = retrieval.provider ? `提供方：${retrieval.provider}` : '提供方：未命名本地检索';
  const commands = retrieval.commands && typeof retrieval.commands === 'object'
    ? Object.entries(retrieval.commands)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([name, value]) => `- ${name}: ${String(value).split('{workspace}').join(config.workspace)}`)
      .join('\n')
    : '';
  const notes = typeof retrieval.notes === 'string' && retrieval.notes.trim()
    ? `说明：${retrieval.notes.trim()}`
    : '说明：优先用这些命令定位 file:line，再读源文件核对；命令不可用时退回普通搜索。';
  if (!commands) return '';
  return `代码检索层（可选，只读）：\n${provider}\n可用命令：\n${commands}\n${notes}\n`;
}

function formatRuntime(config) {
  const runtime = config.runtime;
  if (!runtime || runtime.mode === 'none') {
    return '运行材料：本次未配置运行入口。只能解释实现，不能声称还原某次实际运行。\n';
  }
  if (runtime.mode === 'export-dir') {
    const notes = runtime.notes ? `说明：${runtime.notes}\n` : '';
    return `运行材料（只读，export-dir）：\n目录：${runtime.exportDir}\n${notes}规则：\n1. 只读浏览该目录下的导出材料；\n2. 没有唯一 run_id 时先列出候选，再追问专家，不要合并不同运行；\n3. 读不到部署版本就记为未知，不能用代码 HEAD 冒充。\n`;
  }
  return '';
}

function formatPageContext(pageContext) {
  if (!pageContext || typeof pageContext !== 'object') return '';
  const lines = ['页面事实（来自 PinAsk/页面入口，只作线索）：'];
  if (pageContext.page_url) lines.push(`- URL：${pageContext.page_url}`);
  if (pageContext.captured_at) lines.push(`- 采集时间：${pageContext.captured_at}`);
  if (pageContext.source) lines.push(`- 来源：${pageContext.source}`);
  const target = pageContext.ui_target;
  if (target && typeof target === 'object') {
    if (target.selector) lines.push(`- 选择器：${target.selector}`);
    if (target.visible_text) lines.push(`- 可见文本：${String(target.visible_text).slice(0, 1200)}`);
    if (target.ancestor_summary) lines.push(`- 祖先摘要：${String(target.ancestor_summary).slice(0, 1200)}`);
    if (target.screenshot_ref) lines.push(`- 截图引用：${target.screenshot_ref}`);
  }
  if (Array.isArray(pageContext.ui_elements) && pageContext.ui_elements.length) {
    lines.push(`- 选中元素数：${pageContext.ui_elements.length}`);
    pageContext.ui_elements.slice(0, 8).forEach((el, index) => {
      const text = el && (el.text || el.visible_text || el.label || '');
      const tag = el && (el.tag || el.selector || el.css || '');
      lines.push(`  ${index + 1}. ${String(tag).slice(0, 120)} :: ${String(text).slice(0, 200)}`);
    });
  }
  if (pageContext.scene && typeof pageContext.scene === 'object') {
    lines.push(`- scene：${JSON.stringify(pageContext.scene).slice(0, 1500)}`);
  }
  lines.push('注意：页面事实不能伪造 run_id 或部署版本；没有这些字段时保持未知。');
  return `${lines.join('\n')}\n`;
}

function buildPrompt({ config, question, mode, transcript, pageContext }) {
  const paths = config.importantPaths && Object.entries(config.importantPaths)
    .map(([name, value]) => `- ${name}: ${value}`).join('\n');
  const terms = config.terms && Object.entries(config.terms)
    .map(([name, value]) => `- ${name}: ${value}`).join('\n');
  const taskContext = Array.isArray(config.taskContextPaths) && config.taskContextPaths.length
    ? config.taskContextPaths.map((value) => `- ${value}`).join('\n')
    : '';
  const retrieval = formatRetrieval(config);
  const runtime = formatRuntime(config);
  const page = formatPageContext(pageContext);
  const task = config.task || '未指定业务任务';
  const envLine = config.environment ? `环境：${config.environment}\n` : '';
  const base = `你是项目的只读 coding agent 顾问。\n\n项目：${config.project || '未命名项目'}\n${envLine}目标任务：${task}\n工作区：${config.workspace}\n${paths ? `重要路径：\n${paths}\n` : ''}${taskContext ? `业务任务资料（优先读取）：\n${taskContext}\n` : ''}${terms ? `项目术语：\n${terms}\n` : ''}${retrieval ? `${retrieval}\n` : ''}${runtime}${page ? `\n${page}\n` : ''}\n硬性要求：\n1. 只读检查，不修改文件、不提交、不部署、不写业务数据。\n2. 只把实际读取到的内容当作事实；把代码推测和缺失材料分开。\n3. 回答中列出实际读取的文件路径、关键符号或命令。\n4. 不要输出凭据、环境变量值、密钥或隐私数据。\n5. 如果无法还原某次实际运行，要明确说明缺少什么。\n\n专家问题：\n${question}\n`;
  const history = transcript ? `\n已有专家会话记录：\n${transcript}\n` : '';
  if (mode === 'proposal') {
    return `${base}\n请在只读基础上生成一份“待研发确认的修改建议”，不要直接改代码。必须包含：\n- 问题复述；\n- 直接证据及路径；\n- 可能涉及的规则、配置、workflow、Agent、工具或代码对象；\n- 建议修改范围和不应修改的范围；\n- 验证、回放或评测方式；\n- 风险、未知项和需要研发确认的问题。\n如果证据不足，不要猜测具体实现。\n${history}`;
  }
  return `${base}\n回答结构建议：\n1. 结论；\n2. 证据路径和关键符号；\n3. 直接事实 / 代码推测 / 缺失材料；\n4. 专家下一步可以确认的问题。\n${history}`;
}

function runDsh(config, prompt) {
  const isJsLauncher = config.dshBin.endsWith('.js');
  if (isJsLauncher && !fs.existsSync(config.dshBin)) throw new Error(`DSH binary does not exist: ${config.dshBin}`);
  if (config.dryRun) return `[dry-run]\n${prompt}`;
  const env = { ...process.env, DSH_HOME: config.dshHome };
  const command = isJsLauncher ? process.execPath : config.dshBin;
  const commandArgs = isJsLauncher ? [config.dshBin, '--profile', 'headless', prompt] : ['--profile', 'headless', prompt];
  const result = spawnSync(command, commandArgs, {
    cwd: config.workspace,
    env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-4000);
    throw new Error(`DSH failed with status ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function appendTranscript(file, role, text) {
  const heading = role === 'expert' ? '专家' : role === 'agent' ? '顾问' : role === 'reviewer' ? '研发' : '系统';
  fs.appendFileSync(file, `\n## ${heading} · ${new Date().toISOString()}\n\n${text.trim()}\n`, 'utf8');
}

function createSession(config, question, answer, pageContext) {
  const sessionId = nowId('advisor');
  const sessionDir = path.join(config.recordDir, sessionId);
  ensureDir(sessionDir);
  ensureDir(config.notesDir);
  const facts = collectWorkspaceFacts(config.workspace);
  const metadata = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    project: config.project || null,
    environment: config.environment || null,
    task: config.task || null,
    question,
    createdAt: new Date().toISOString(),
    workspace: config.workspace,
    git: facts,
    runtime: config.runtime || { mode: 'none' },
    pageContext: pageContext || null,
    readOnly: true,
    modelPolicy: { default: 'flash', escalation: 'manual-or-checker' },
    dshProfile: 'headless',
    configPath: config.__configPath,
    notesDir: config.notesDir,
    status: 'answered',
    turns: 1,
  };
  writeJson(path.join(sessionDir, 'session.json'), metadata);
  fs.writeFileSync(path.join(sessionDir, 'question.md'), `${question.trim()}\n`, 'utf8');
  fs.writeFileSync(path.join(sessionDir, 'answer.md'), `${answer.trim()}\n`, 'utf8');
  if (pageContext) writeJson(path.join(sessionDir, 'page-context.json'), pageContext);
  fs.writeFileSync(path.join(sessionDir, 'transcript.md'), `# 顾问会话 ${sessionId}\n\n- 项目：${metadata.project || ''}\n- 任务：${metadata.task || ''}\n- 工作区提交：${facts.commit || 'unknown'}\n- 只读：是\n`, 'utf8');
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'expert', question);
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'agent', answer);
  return { sessionDir, metadata, answer };
}

function loadSession(sessionArg) {
  const sessionDir = path.resolve(sessionArg);
  const metadataPath = path.join(sessionDir, 'session.json');
  if (!fs.existsSync(metadataPath)) throw new Error(`session.json not found: ${metadataPath}`);
  const metadata = readJson(metadataPath);
  return { sessionDir, metadata };
}

function updateSession(sessionDir, patch) {
  const file = path.join(sessionDir, 'session.json');
  const metadata = readJson(file);
  writeJson(file, { ...metadata, ...patch });
  return { ...metadata, ...patch };
}

function readPageContextArg(args) {
  if (!args['page-context']) return null;
  const value = args['page-context'];
  if (value === true) throw new Error('missing --page-context value');
  const resolved = path.resolve(value);
  if (fs.existsSync(resolved)) return readJson(resolved);
  return JSON.parse(value);
}

function pageContextFromPinAskBatch(batch) {
  if (!batch || typeof batch !== 'object') return null;
  const first = Array.isArray(batch.ui_elements) && batch.ui_elements[0] ? batch.ui_elements[0] : null;
  return {
    page_url: (batch.scene && (batch.scene.url || batch.scene.href)) || batch.page_url || null,
    captured_at: batch.created_at || null,
    source: batch.source || 'pinask',
    ui_target: first ? {
      selector: first.selector || first.css || null,
      visible_text: first.text || first.visible_text || null,
      ancestor_summary: first.ancestor_summary || first.ancestors || null,
      screenshot_ref: first.screenshot_ref || null,
    } : null,
    ui_elements: batch.ui_elements || [],
    selection_groups: batch.selection_groups || [],
    scene: batch.scene || null,
  };
}

function askQuestion(config, { question, pageContext = null, dryRun = false } = {}) {
  if (!question || !String(question).trim()) throw new Error('missing question');
  const runtimeConfig = { ...config, dryRun: Boolean(dryRun) };
  const answer = runDsh(runtimeConfig, buildPrompt({
    config: runtimeConfig,
    question,
    mode: 'answer',
    pageContext,
  }));
  return createSession(runtimeConfig, question, answer, pageContext);
}

function followupQuestion(sessionDirOrMeta, { question, pageContext = null, dryRun = false } = {}) {
  const { sessionDir, metadata } = typeof sessionDirOrMeta === 'string'
    ? loadSession(sessionDirOrMeta)
    : sessionDirOrMeta;
  if (!question || !String(question).trim()) throw new Error('missing question');
  const config = loadConfig(metadata.configPath);
  config.dryRun = Boolean(dryRun);
  const transcript = fs.readFileSync(path.join(sessionDir, 'transcript.md'), 'utf8');
  const answer = runDsh(config, buildPrompt({
    config,
    question,
    mode: 'answer',
    transcript,
    pageContext: pageContext || metadata.pageContext || null,
  }));
  const turn = metadata.turns + 1;
  fs.writeFileSync(path.join(sessionDir, `turn-${String(turn).padStart(3, '0')}-question.md`), `${question.trim()}\n`, 'utf8');
  fs.writeFileSync(path.join(sessionDir, `turn-${String(turn).padStart(3, '0')}-answer.md`), `${answer.trim()}\n`, 'utf8');
  if (pageContext) writeJson(path.join(sessionDir, `turn-${String(turn).padStart(3, '0')}-page-context.json`), pageContext);
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'expert', question);
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'agent', answer);
  updateSession(sessionDir, { turns: turn, updatedAt: new Date().toISOString() });
  return { sessionDir, metadata: { ...metadata, turns: turn }, answer };
}

function initProject({
  project,
  workspace,
  task = '',
  output,
  recordDir,
  notesDir,
  environment = null,
  runtime = null,
  dshBin,
  dshHome,
}) {
  const resolvedWorkspace = path.resolve(workspace);
  const out = path.resolve(output || defaultConfigPath(project));
  if (isInside(out, resolvedWorkspace)) {
    throw new Error(`refusing to write advisor config inside target workspace: ${out} (use --output under ~/.impl-advisor or another external path)`);
  }
  const resolvedRecordDir = path.resolve(recordDir || defaultRecordDir(project));
  if (isInside(resolvedRecordDir, resolvedWorkspace)) {
    throw new Error(`refusing to store sessions inside target workspace: ${resolvedRecordDir}`);
  }
  const resolvedNotesDir = path.resolve(notesDir || defaultNotesDir(project));
  if (isInside(resolvedNotesDir, resolvedWorkspace)) {
    throw new Error(`refusing to store notes inside target workspace: ${resolvedNotesDir}`);
  }
  let runtimeConfig = { mode: 'none' };
  if (runtime) {
    runtimeConfig = normalizeRuntime(runtime, resolvedWorkspace);
  }
  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    project,
    environment,
    task: task || '',
    workspace: resolvedWorkspace,
    readOnly: true,
    recordDir: resolvedRecordDir,
    notesDir: resolvedNotesDir,
    runtime: runtimeConfig.mode === 'none' ? null : runtimeConfig,
    dshBin: dshBin || defaultDshBin(),
    dshHome: dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    importantPaths: {},
    taskContextPaths: [],
    terms: {},
    retrieval: null,
  };
  writeJson(out, config);
  ensureDir(resolvedRecordDir);
  ensureDir(resolvedNotesDir);
  const placeholder = path.join(resolvedNotesDir, 'README.md');
  if (!fs.existsSync(placeholder)) {
    fs.writeFileSync(placeholder, `# ${project} advisor notes\n\n外部查询笔记目录。不要写入目标代码仓库。\n`, 'utf8');
  }
  return { configPath: out, config };
}

module.exports = {
  SCHEMA_VERSION,
  CONFIG_SCHEMA_VERSION,
  ensureDir,
  writeJson,
  readJson,
  defaultAdvisorHome,
  defaultRecordDir,
  defaultConfigPath,
  defaultNotesDir,
  defaultDshBin,
  loadConfig,
  buildPrompt,
  runDsh,
  createSession,
  loadSession,
  updateSession,
  readPageContextArg,
  pageContextFromPinAskBatch,
  askQuestion,
  followupQuestion,
  initProject,
  formatPageContext,
  formatRuntime,
  normalizeRuntime,
  isInside,
  appendTranscript,
};
