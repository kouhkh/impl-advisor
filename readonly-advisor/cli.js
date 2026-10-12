#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  loadConfig,
  buildPrompt,
  runDsh,
  loadSession,
  updateSession,
  readPageContextArg,
  askQuestion,
  followupQuestion,
  initProject,
  refreshContextNotes,
  loadContextNotes,
  writeJson,
  appendTranscript,
} = require('./lib');

function usage(exitCode = 0) {
  const text = `\nReadonly Advisor (DSH)\n\nCommands:\n  init      create a minimal project config outside the target workspace\n  ask       ask a read-only business/task question and record the session\n  followup  continue a recorded session\n  notes     refresh or show external Context Notes\n  propose   create a developer-reviewable modification proposal\n  review    record a developer decision on a proposal\n\nExamples:\n  node readonly-advisor/cli.js init \\\n    --project planora --task "技术规格书语气改写" \\\n    --workspace /path/to/planora \\\n    --runtime-mode export-dir --export-dir /path/to/exports\n\n  node readonly-advisor/cli.js notes --config ~/.impl-advisor/planora/project.json --refresh\n\n  # default config/sessions/notes live under ~/.impl-advisor/<project>/\n  node readonly-advisor/cli.js ask --config ~/.impl-advisor/planora/project.json \\\n    --question "为什么这句话被改写？请定位证据。" \\\n    --page-context /path/to/page-context.json\n\n  node readonly-advisor/cli.js propose --session /path/to/session\n`;
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

function commandInit(args) {
  const runtimeMode = args['runtime-mode'] || null;
  const runtime = runtimeMode
    ? {
      mode: runtimeMode,
      exportDir: args['export-dir'],
      host: args['ssh-host'],
      user: args['ssh-user'],
      port: args['ssh-port'],
      root: args['ssh-root'],
      notes: args['runtime-notes'] || '',
    }
    : null;
  const result = initProject({
    project: required(args, 'project'),
    workspace: required(args, 'workspace'),
    task: args.task || '',
    output: args.output,
    recordDir: args.recordDir,
    notesDir: args.notesDir,
    environment: args.environment || null,
    runtime,
    dshBin: args['dsh-bin'],
    dshHome: args['dsh-home'],
  });
  process.stdout.write(`created ${result.configPath}\n`);
}

function commandAsk(args) {
  const config = loadConfig(required(args, 'config'));
  const pageContext = readPageContextArg(args);
  const result = askQuestion(config, {
    question: required(args, 'question'),
    pageContext,
    dryRun: Boolean(args['dry-run']),
  });
  process.stdout.write(`${result.sessionDir}\n\n${result.answer}\n`);
}

function commandFollowup(args) {
  const result = followupQuestion(required(args, 'session'), {
    question: required(args, 'question'),
    pageContext: readPageContextArg(args),
    dryRun: Boolean(args['dry-run']),
  });
  process.stdout.write(`${result.sessionDir}\n\n${result.answer}\n`);
}

function commandPropose(args) {
  const { sessionDir, metadata } = loadSession(required(args, 'session'));
  const config = loadConfig(metadata.configPath);
  config.dryRun = Boolean(args['dry-run']);
  const transcript = fs.readFileSync(path.join(sessionDir, 'transcript.md'), 'utf8');
  const question = args.question || metadata.question;
  const proposal = runDsh(config, buildPrompt({
    config,
    question,
    mode: 'proposal',
    transcript,
    pageContext: metadata.pageContext || null,
  }));
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

function commandNotes(args) {
  const config = loadConfig(required(args, 'config'));
  if (args.refresh || args._[1] === 'refresh') {
    const result = refreshContextNotes(config, { dryRun: Boolean(args['dry-run']) });
    if (result.dryRun) {
      process.stdout.write(`${result.prompt}\n`);
      return;
    }
    process.stdout.write(`${result.files.join('\n')}\n`);
    return;
  }
  const notes = loadContextNotes(config);
  if (!notes) {
    process.stdout.write(`(no context notes yet under ${config.notesDir})\n`);
    return;
  }
  process.stdout.write(`${notes}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) usage(0);
  try {
    if (command === 'init') return commandInit(args);
    if (command === 'ask') return commandAsk(args);
    if (command === 'followup') return commandFollowup(args);
    if (command === 'notes') return commandNotes(args);
    if (command === 'propose') return commandPropose(args);
    if (command === 'review') return commandReview(args);
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    process.stderr.write(`readonly-advisor: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
