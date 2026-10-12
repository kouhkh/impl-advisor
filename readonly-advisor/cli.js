#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SCHEMA_VERSION = 'readonly-advisor-session/1';
const CONFIG_SCHEMA_VERSION = 'readonly-advisor-project/1';

function usage(exitCode = 0) {
  const text = `\nReadonly Advisor (DSH)\n\nCommands:\n  init      create a minimal project config\n  ask       ask a read-only business/task question and record the session\n  followup  continue a recorded session\n  propose   create a developer-reviewable modification proposal\n  review    record a developer decision on a proposal\n\nExamples:\n  node readonly-advisor/cli.js init \\\n    --project planora --task "技术规格书语气改写" \\\n    --workspace /path/to/planora --output /path/to/planora.advisor.json\n\n  node readonly-advisor/cli.js ask --config /path/to/planora.advisor.json \\\n    --question "为什么这句话被改写？请定位证据。"\n\n  node readonly-advisor/cli.js propose --session /path/to/session\n`;
  process.stdout.write(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq >= 0) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    if (key === 'help' || key === 'dry-run') {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function required(args, key) {
  if (!args[key] || args[key] === true) throw new Error(`missing --${key}`);
  return args[key];
}

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

function defaultRecordDir(project) {
  return path.join(os.homedir(), '.dsh-advisor', project, 'sessions');
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

function buildPrompt({ config, question, mode, transcript }) {
  const paths = config.importantPaths && Object.entries(config.importantPaths)
    .map(([name, value]) => `- ${name}: ${value}`).join('\n');
  const terms = config.terms && Object.entries(config.terms)
    .map(([name, value]) => `- ${name}: ${value}`).join('\n');
  const taskContext = Array.isArray(config.taskContextPaths) && config.taskContextPaths.length
    ? config.taskContextPaths.map((value) => `- ${value}`).join('\n')
    : '';
  const retrieval = formatRetrieval(config);
  const task = config.task || '未指定业务任务';
  const base = `你是项目的只读 coding agent 顾问。\n\n项目：${config.project || '未命名项目'}\n目标任务：${task}\n工作区：${config.workspace}\n${paths ? `重要路径：\n${paths}\n` : ''}${taskContext ? `业务任务资料（优先读取）：\n${taskContext}\n` : ''}${terms ? `项目术语：\n${terms}\n` : ''}${retrieval ? `${retrieval}\n` : ''}\n硬性要求：\n1. 只读检查，不修改文件、不提交、不部署、不写业务数据。\n2. 只把实际读取到的内容当作事实；把代码推测和缺失材料分开。\n3. 回答中列出实际读取的文件路径、关键符号或命令。\n4. 不要输出凭据、环境变量值、密钥或隐私数据。\n5. 如果无法还原某次实际运行，要明确说明缺少什么。\n\n专家问题：\n${question}\n`;
  if (mode === 'proposal') {
    return `${base}\n请在只读基础上生成一份“待研发确认的修改建议”，不要直接改代码。必须包含：\n- 问题复述；\n- 直接证据及路径；\n- 可能涉及的规则、配置、workflow、Agent、工具或代码对象；\n- 建议修改范围和不应修改的范围；\n- 验证、回放或评测方式；\n- 风险、未知项和需要研发确认的问题。\n如果证据不足，不要猜测具体实现。\n${transcript ? `\n已有专家会话记录：\n${transcript}\n` : ''}`;
  }
  return `${base}\n回答结构建议：\n1. 结论；\n2. 证据路径和关键符号；\n3. 直接事实 / 代码推测 / 缺失材料；\n4. 专家下一步可以确认的问题。\n`;
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

function createSession(config, question, answer) {
  const sessionId = nowId('advisor');
  const sessionDir = path.join(config.recordDir, sessionId);
  ensureDir(sessionDir);
  const facts = collectWorkspaceFacts(config.workspace);
  const metadata = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    project: config.project || null,
    task: config.task || null,
    question,
    createdAt: new Date().toISOString(),
    workspace: config.workspace,
    git: facts,
    readOnly: true,
    modelPolicy: { default: 'flash', escalation: 'manual-or-checker' },
    dshProfile: 'headless',
    configPath: config.__configPath,
    status: 'answered',
    turns: 1,
  };
  writeJson(path.join(sessionDir, 'session.json'), metadata);
  fs.writeFileSync(path.join(sessionDir, 'question.md'), `${question.trim()}\n`, 'utf8');
  fs.writeFileSync(path.join(sessionDir, 'answer.md'), `${answer.trim()}\n`, 'utf8');
  fs.writeFileSync(path.join(sessionDir, 'transcript.md'), `# 顾问会话 ${sessionId}\n\n- 项目：${metadata.project || ''}\n- 任务：${metadata.task || ''}\n- 工作区提交：${facts.commit || 'unknown'}\n- 只读：是\n`, 'utf8');
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'expert', question);
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'agent', answer);
  return { sessionDir, metadata };
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

function commandInit(args) {
  const project = required(args, 'project');
  const workspace = path.resolve(required(args, 'workspace'));
  const output = path.resolve(args.output || path.join(workspace, '.dsh-advisor.project.json'));
  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    project,
    task: args.task || '',
    workspace,
    readOnly: true,
    recordDir: args.recordDir || defaultRecordDir(project),
    dshBin: args['dsh-bin'] || defaultDshBin(),
    dshHome: args['dsh-home'] || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    importantPaths: {},
    taskContextPaths: [],
    terms: {},
    retrieval: null,
  };
  writeJson(output, config);
  process.stdout.write(`created ${output}\n`);
}

function commandAsk(args) {
  const config = loadConfig(required(args, 'config'));
  config.dryRun = Boolean(args['dry-run']);
  const question = required(args, 'question');
  const answer = runDsh(config, buildPrompt({ config, question, mode: 'answer' }));
  const result = createSession(config, question, answer);
  process.stdout.write(`${result.sessionDir}\n\n${answer}\n`);
}

function commandFollowup(args) {
  const { sessionDir, metadata } = loadSession(required(args, 'session'));
  const config = loadConfig(metadata.configPath);
  config.dryRun = Boolean(args['dry-run']);
  const question = required(args, 'question');
  const transcript = fs.readFileSync(path.join(sessionDir, 'transcript.md'), 'utf8');
  const answer = runDsh(config, buildPrompt({ config, question, mode: 'answer', transcript }));
  fs.writeFileSync(path.join(sessionDir, `turn-${String(metadata.turns + 1).padStart(3, '0')}-question.md`), `${question.trim()}\n`, 'utf8');
  fs.writeFileSync(path.join(sessionDir, `turn-${String(metadata.turns + 1).padStart(3, '0')}-answer.md`), `${answer.trim()}\n`, 'utf8');
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'expert', question);
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'agent', answer);
  updateSession(sessionDir, { turns: metadata.turns + 1, updatedAt: new Date().toISOString() });
  process.stdout.write(`${sessionDir}\n\n${answer}\n`);
}

function commandPropose(args) {
  const { sessionDir, metadata } = loadSession(required(args, 'session'));
  const config = loadConfig(metadata.configPath);
  config.dryRun = Boolean(args['dry-run']);
  const transcript = fs.readFileSync(path.join(sessionDir, 'transcript.md'), 'utf8');
  const question = args.question || metadata.question;
  const proposal = runDsh(config, buildPrompt({ config, question, mode: 'proposal', transcript }));
  const proposalPath = path.join(sessionDir, 'change-proposal.md');
  fs.writeFileSync(proposalPath, `# 待研发确认的修改建议\n\n- 会话：${metadata.sessionId}\n- 项目：${metadata.project || ''}\n- 任务：${metadata.task || ''}\n- 生成时间：${new Date().toISOString()}\n- 状态：pending_review\n\n${proposal.trim()}\n`, 'utf8');
  updateSession(sessionDir, { status: 'proposal_pending_review', proposalFile: proposalPath, updatedAt: new Date().toISOString() });
  process.stdout.write(`${proposalPath}\n\n${proposal}\n`);
}

function commandReview(args) {
  const { sessionDir, metadata } = loadSession(required(args, 'session'));
  if (!metadata.proposalFile || !fs.existsSync(metadata.proposalFile)) {
    throw new Error('no change proposal exists for this session');
  }
  const decision = required(args, 'decision');
  const allowed = new Set(['approved', 'rejected', 'needs_changes']);
  if (!allowed.has(decision)) throw new Error(`decision must be one of: ${[...allowed].join(', ')}`);
  const note = args.note || '';
  const review = {
    decision,
    note,
    reviewer: args.reviewer || process.env.USER || null,
    reviewedAt: new Date().toISOString(),
  };
  writeJson(path.join(sessionDir, 'review.json'), review);
  appendTranscript(path.join(sessionDir, 'transcript.md'), 'reviewer', `决定：${decision}\n\n${note}`);
  updateSession(sessionDir, {
    status: decision === 'approved' ? 'proposal_approved' : decision === 'rejected' ? 'proposal_rejected' : 'proposal_needs_changes',
    reviewFile: path.join(sessionDir, 'review.json'),
    updatedAt: review.reviewedAt,
  });
  process.stdout.write(`${path.join(sessionDir, 'review.json')}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) usage(0);
  try {
    if (command === 'init') return commandInit(args);
    if (command === 'ask') return commandAsk(args);
    if (command === 'followup') return commandFollowup(args);
    if (command === 'propose') return commandPropose(args);
    if (command === 'review') return commandReview(args);
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    process.stderr.write(`readonly-advisor: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
