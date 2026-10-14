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
  captureVersions,
  captureAskContext,
  writeJson,
  appendTranscript,
} = require('./lib');
const { runSshOp, defaultAuditPath } = require('./ssh-readonly');

function usage(exitCode = 0) {
  const text = `\nReadonly Advisor (DSH)\n\nCommands:\n  init      create a minimal project config outside the target workspace\n  ask       ask a read-only business/task question and record the session\n  followup  continue a recorded session\n  notes     refresh or show external Context Notes\n  versions  capture code vs deploy version binding\n  runtime-search  list guarded runtime candidate files\n  records   list/get structured runtime records (fixture/sql contract)\n  ssh       guarded readonly SSH ops\n  propose   create a developer-reviewable modification proposal\n  review    record a developer decision on a proposal\n\nExamples:\n  node readonly-advisor/cli.js versions --config ~/.impl-advisor/planora/project.json\n  node readonly-advisor/cli.js runtime-search --config ~/.impl-advisor/planora/project.json --question "这次运行日志在哪"\n  node readonly-advisor/cli.js records --config <cfg> --op list --collection jobs --query "demo"\n  node readonly-advisor/cli.js records --config <cfg> --op get --collection jobs --id job-1\n  node readonly-advisor/cli.js ask --config ~/.impl-advisor/planora/project.json \\\n    --question "这次改写对应哪份运行材料？"\n  # ask：部署快照默认开；运行相关问题会一次 SSH 拉候选。可用 --no-deploy-snapshot / --no-runtime-candidates\n`;
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
    if (key === 'help' || key === 'dry-run' || key === 'no-deploy-snapshot' || key === 'no-runtime-candidates') {
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
      limits: args['max-load-ratio'] || args['command-timeout']
        ? {
          maxLoadRatio: args['max-load-ratio'] ? Number(args['max-load-ratio']) : undefined,
          commandTimeoutSec: args['command-timeout'] ? Number(args['command-timeout']) : undefined,
        }
        : undefined,
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
    includeDeploySnapshot: !args['no-deploy-snapshot'],
    includeRuntimeCandidates: !args['no-runtime-candidates'],
  });
  process.stdout.write(`${result.sessionDir}\n\n${result.answer}\n`);
}

function commandVersions(args) {
  const config = loadConfig(required(args, 'config'));
  const versions = captureVersions(config, {
    includeDeploySnapshot: !args['no-deploy-snapshot'],
  });
  process.stdout.write(`${JSON.stringify(versions, null, 2)}\n`);
}

function commandRuntimeSearch(args) {
  const config = loadConfig(required(args, 'config'));
  const question = args.question || '列出运行候选';
  const pageContext = readPageContextArg(args);
  const { runtimeSearch } = captureAskContext(config, {
    question,
    pageContext,
    includeDeploySnapshot: false,
    includeRuntimeCandidates: true,
    dryRun: false,
  });
  // force path: captureAskContext only searches when heuristic matches; for explicit command, force via searchRunCandidates
  if (runtimeSearch.status === 'skipped') {
    const { searchRunCandidates } = require('./runtime-search');
    const { runSshOp, defaultAuditPath } = require('./ssh-readonly');
    const forced = searchRunCandidates(config, {
      runSshOpFn: runSshOp,
      auditPath: defaultAuditPath(config.project),
      question,
      pageContext,
      force: true,
    });
    process.stdout.write(`${JSON.stringify(forced, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(runtimeSearch, null, 2)}\n`);
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
    versions: metadata.versions || null,
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

function commandRecords(args) {
  const config = loadConfig(required(args, 'config'));
  const { runRecordList, runRecordGet } = require('./evidence-gateway');
  const op = required(args, 'op');
  let card;
  if (op === 'list') {
    let where = null;
    if (args.where) {
      where = typeof args.where === 'string' ? JSON.parse(args.where) : args.where;
    }
    card = runRecordList(config, {
      collection: required(args, 'collection'),
      query: args.query || null,
      where,
      limit: args.limit ? Number(args.limit) : undefined,
    });
  } else if (op === 'get') {
    card = runRecordGet(config, {
      collection: required(args, 'collection'),
      id: required(args, 'id'),
    });
  } else {
    throw new Error('records --op must be list or get');
  }
  process.stdout.write(`${JSON.stringify(card, null, 2)}\n`);
}

function commandSsh(args) {
  const config = loadConfig(required(args, 'config'));
  if (!config.runtime || config.runtime.mode !== 'ssh') {
    throw new Error('config.runtime.mode must be ssh');
  }
  const op = required(args, 'op');
  const result = runSshOp(config.runtime, {
    op,
    args: {
      path: args.path,
      pattern: args.pattern,
      lines: args.lines,
      maxDepth: args['max-depth'],
      maxResults: args['max-results'],
    },
    auditPath: args.audit || defaultAuditPath(config.project),
  });
  const summary = {
    ok: true,
    op,
    host: config.runtime.host,
    root: config.runtime.root,
    ms: result.ms,
    load1Before: result.beforeHealth && result.beforeHealth.load1,
    load1After: (result.afterHealth && result.afterHealth.load1) || (result.beforeHealth && result.beforeHealth.load1),
    memUsedMb: result.beforeHealth && result.beforeHealth.memUsedMb,
    outputBytes: Buffer.byteLength(result.stdout || '', 'utf8'),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n\n${result.stdout}`);
  if (!String(result.stdout || '').endsWith('\n')) process.stdout.write('\n');
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
    if (command === 'versions') return commandVersions(args);
    if (command === 'runtime-search') return commandRuntimeSearch(args);
    if (command === 'records') return commandRecords(args);
    if (command === 'ssh') return commandSsh(args);
    if (command === 'propose') return commandPropose(args);
    if (command === 'review') return commandReview(args);
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    process.stderr.write(`readonly-advisor: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
