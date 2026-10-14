#!/usr/bin/env node
/**
 * 专家已确认唯一运行候选后的对照：允许 code.search/read，测谁能答到 ying-tail。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  loadConfig,
  buildPrompt,
  captureAskContext,
  createSession,
} = require(path.join(root, 'readonly-advisor/lib.js'));
const {
  createWorkingMemory,
  ingestCards,
  runCandidateFromSearch,
  selectRunCandidate,
  decideAllowedOps,
  evaluateStop,
  formatWorkingMemory,
} = require(path.join(root, 'readonly-advisor/working-memory.js'));
const { cardsFromAskContext } = require(path.join(root, 'readonly-advisor/evidence-gateway.js'));
const { runHarness, describeRunner } = require(path.join(root, 'readonly-advisor/runners.js'));

function parseArgs(argv) {
  const out = {
    runners: 'dsh,opencode,cline',
    selected: '/opt/planora/logs/test-deploy-01931424-20261012T1055.log',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) { out[key] = true; continue; }
    out[key] = val;
    i += 1;
  }
  return out;
}

function scoreAnswer(text) {
  const checks = {
    ying_tail: /ying-tail|YING_FALSE_COMPOUND|假合词|假复合/i.test(text),
    code_path: /ying-tail\.ts|bid-text-rules|technical-spec-rewrite/i.test(text),
    separates_versions: /mismatched|bb57ee33|01931424|代码.*部署/i.test(text),
    unfixed_or_unknown: /无法确认|未知|未修复|不能确认/i.test(text),
    wrong_fixed: /已修复/.test(text) && !/无法确认|未知|未修复|不能确认/.test(text),
    still_blocked_on_multiple: /须先确认|两个候选|need_confirmation/i.test(text)
      && !/已确认|专家确认/.test(text),
  };
  const hit = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
  return { checks, hit, hitCount: hit.length, chars: text.length };
}

function seedConfirmedBrief(config, { question, versions, runtimeSearch, selected }) {
  let memory = createWorkingMemory({
    sessionId: 'compare-confirmed',
    question,
    maxTurns: 2,
    maxCards: 12,
  });
  const cards = cardsFromAskContext({ versions, runtimeSearch });
  const ingested = ingestCards(memory, cards);
  memory = ingested.memory;
  memory.runCandidate = runCandidateFromSearch(runtimeSearch);
  memory = selectRunCandidate(memory, selected);
  memory.allowedNextOps = decideAllowedOps(memory);
  memory.stopReason = evaluateStop(memory);
  // 确认后不应再因 multiple 停搜
  if (memory.runCandidate && memory.runCandidate.selected) {
    memory.stopReason = memory.stopReason === 'need_confirmation' ? null : memory.stopReason;
  }
  return formatWorkingMemory(memory, { budget: 4000 });
}

function runCline(config, prompt, outDir) {
  const promptFile = path.join(outDir, 'prompt-sent.md');
  fs.writeFileSync(promptFile, prompt);
  const keyCfg = path.join(process.env.HOME, '.cline/glm-5.3-provider.json');
  const key = JSON.parse(fs.readFileSync(keyCfg, 'utf8'))['glm-5.3'].apiKey;
  const base = 'https://newapiguangzhou.frontis.top/v1';
  // auth quietly
  spawnSync('cline', ['auth', '-p', 'openai', '-k', key, '-b', base, '-m', 'glm-5.3'], {
    encoding: 'utf8',
  });
  const result = spawnSync('cline', [
    '-p', // plan / read oriented
    '-c', config.workspace,
    '-m', 'glm-5.3',
    '-P', 'openai',
    '-t', '300',
    '--retries', '3',
    '--auto-approve', 'true',
    prompt,
  ], {
    cwd: config.workspace,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
  if (result.error) throw result.error;
  let text = (result.stdout || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  // keep from last ## 1. / 结论 if noisy
  const idx = Math.max(text.lastIndexOf('## 1.'), text.lastIndexOf('结论'));
  if (idx > 0 && text.length - idx > 400) text = text.slice(idx);
  if (!text) {
    throw new Error(`Cline empty/fail status=${result.status}: ${(result.stderr || '').slice(-1500)}`);
  }
  return text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config || !args['question-file'] || !args.out) {
    console.error('usage: node scripts/compare-harness-confirmed.mjs --config <cfg> --question-file <q> --out <dir> [--selected <path>]');
    process.exit(2);
  }
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const question = fs.readFileSync(path.resolve(args['question-file']), 'utf8').trim();
  const baseConfig = loadConfig(path.resolve(args.config));
  baseConfig.recordDir = path.join(outDir, 'sessions');
  fs.mkdirSync(baseConfig.recordDir, { recursive: true });

  const selected = args.selected;
  const { versions, runtimeSearch } = captureAskContext(baseConfig, {
    question,
    includeDeploySnapshot: true,
    includeRuntimeCandidates: true,
  });
  const brief = seedConfirmedBrief(baseConfig, {
    question,
    versions,
    runtimeSearch,
    selected,
  });
  const confirmNote = [
    `【专家已确认】唯一运行候选：${selected}`,
    '允许下一步：code.search、code.read、version.bind、run.list、run.summary、run.log_slice。',
    '请优先在代码中定位「适应带宽」误改根因（关注 ying-tail / 假合词 / 情态词「应」）。',
    '区分代码 HEAD 与部署版本；无法确认是否已修复则写未知。不要再追问候选。',
    '',
  ].join('\n');
  const frozenPrompt = `${confirmNote}${buildPrompt({
    config: baseConfig,
    question,
    mode: 'answer',
    workingMemoryBrief: brief,
    versions,
    runtimeSearch,
  })}`;
  fs.writeFileSync(path.join(outDir, 'question.md'), `${question}\n`);
  fs.writeFileSync(path.join(outDir, 'selected-candidate.txt'), `${selected}\n`);
  fs.writeFileSync(path.join(outDir, 'working-memory-brief.md'), `${brief}\n`);
  fs.writeFileSync(path.join(outDir, 'frozen-prompt.md'), `${frozenPrompt}\n`);
  fs.writeFileSync(path.join(outDir, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`);

  const runners = String(args.runners).split(',').map((s) => s.trim()).filter(Boolean);
  const summary = { createdAt: new Date().toISOString(), selected, runners: {} };

  for (const kind of runners) {
    const started = Date.now();
    const runnerDir = path.join(outDir, kind);
    fs.mkdirSync(runnerDir, { recursive: true });
    let answer = '';
    let error = null;
    try {
      if (kind === 'cline') {
        answer = runCline(baseConfig, frozenPrompt, runnerDir);
        fs.writeFileSync(path.join(runnerDir, 'runner.json'), `${JSON.stringify({ kind: 'cline', model: 'glm-5.3' }, null, 2)}\n`);
      } else {
        const cfg = {
          ...baseConfig,
          runner: kind,
          opencodeModel: 'frontis/glm-5.3',
          opencodeAllowTools: true, // 允许搜代码
        };
        fs.writeFileSync(path.join(runnerDir, 'runner.json'), `${JSON.stringify(describeRunner(cfg), null, 2)}\n`);
        answer = runHarness(cfg, frozenPrompt);
        createSession(cfg, question, answer, null, versions, runtimeSearch);
      }
    } catch (err) {
      error = err.message || String(err);
    }
    const elapsedMs = Date.now() - started;
    fs.writeFileSync(path.join(runnerDir, 'answer.md'), `${answer || `(error)\n${error || ''}`}\n`);
    if (error) fs.writeFileSync(path.join(runnerDir, 'error.txt'), `${error}\n`);
    const score = scoreAnswer(answer || '');
    fs.writeFileSync(path.join(runnerDir, 'score.json'), `${JSON.stringify(score, null, 2)}\n`);
    summary.runners[kind] = { elapsedMs, error, score };
    console.error(`[${kind}] ${error ? `FAIL ${error.slice(0, 160)}` : `ok chars=${score.chars} hit=${score.hit.join(',')}`} (${elapsedMs}ms)`);
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    '# Confirmed-candidate harness compare',
    '',
    `- selected: ${selected}`,
    `- createdAt: ${summary.createdAt}`,
    '',
    '| runner | chars | ying_tail | code_path | hit |',
    '|---|---:|:---:|:---:|---|',
    ...runners.map((k) => {
      const r = summary.runners[k];
      const c = r.score.checks || {};
      return `| ${k} | ${r.score.chars} | ${c.ying_tail ? 'Y' : ''} | ${c.code_path ? 'Y' : ''} | ${(r.score.hit || []).join(', ') || '-'} |`;
    }),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  process.stdout.write(`${outDir}\n${md}\n`);
}

main();
