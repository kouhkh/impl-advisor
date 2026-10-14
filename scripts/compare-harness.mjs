#!/usr/bin/env node
/**
 * 同一工作记忆 brief 上对照 harness（比 runner，不比谁更能扛脏上下文）。
 *
 * 用法：
 *   node scripts/compare-harness.mjs \
 *     --config ~/.impl-advisor/planora/.../project.json \
 *     --question-file question.md \
 *     --runners dsh,opencode,cursor \
 *     --out ~/.impl-advisor/planora/ablation/harness-compare-...
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  loadConfig,
  buildPrompt,
  captureAskContext,
  seedWorkingMemoryBrief,
  createSession,
} = require(path.join(root, 'readonly-advisor/lib.js'));
const { runHarness, describeRunner } = require(path.join(root, 'readonly-advisor/runners.js'));

function parseArgs(argv) {
  const out = { runners: 'dsh,opencode,cursor' };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = val;
    i += 1;
  }
  return out;
}

function scoreAnswer(text) {
  const checks = {
    q3_artifact: /确保适带宽/i.test(text),
    q3_ensure_ying: /ying-tail|YING_FALSE_COMPOUND|假合词|ensure/i.test(text),
    q3_unfixed: /未修复|仍可复现|不能确认已修复|无法确认.*修复|unknown.*fix|当前无法确认|部署版本.*未知|无法确认部署/i.test(text)
      && !(/已修复/.test(text) && !/未修复|无法确认|不能确认|当前无法确认|部署/.test(text)),
    q3_wrong_fixed: /已修复/.test(text)
      && !/未修复|仍可复现|不能确认已修复|无法确认|当前无法确认|部署版本/.test(text),
    respects_multiple: /多个|候选|请确认|须先|追问|need_confirmation|disambiguate/i.test(text),
    separates_versions: /mismatched|不等|≠|代码.*部署|HEAD.*部署|deploy|版本比较/i.test(text),
  };
  const hit = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
  return { checks, hit, hitCount: hit.length, chars: text.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config || !args['question-file'] || !args.out) {
    console.error('usage: node scripts/compare-harness.mjs --config <cfg> --question-file <q> --out <dir> [--runners dsh,opencode,cursor]');
    process.exit(2);
  }
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const question = fs.readFileSync(path.resolve(args['question-file']), 'utf8').trim();
  const baseConfig = loadConfig(path.resolve(args.config));
  baseConfig.memoryDir = baseConfig.memoryDir || path.join(outDir, 'memory');
  baseConfig.recordDir = path.join(outDir, 'sessions');
  fs.mkdirSync(baseConfig.recordDir, { recursive: true });

  // 只捕获一次上下文 → 冻结 brief + prompt（各 runner 共用）
  const { versions, runtimeSearch } = captureAskContext(baseConfig, {
    question,
    includeDeploySnapshot: true,
    includeRuntimeCandidates: true,
    dryRun: false,
  });
  const workingMemoryBrief = seedWorkingMemoryBrief(baseConfig, {
    question,
    versions,
    runtimeSearch,
  });
  const frozenPrompt = buildPrompt({
    config: baseConfig,
    question,
    mode: 'answer',
    workingMemoryBrief,
    versions,
    runtimeSearch,
  });
  fs.writeFileSync(path.join(outDir, 'question.md'), `${question}\n`);
  fs.writeFileSync(path.join(outDir, 'frozen-prompt.md'), `${frozenPrompt}\n`);
  fs.writeFileSync(path.join(outDir, 'working-memory-brief.md'), `${workingMemoryBrief || '(empty)'}\n`);
  fs.writeFileSync(path.join(outDir, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'runtime-search.json'), `${JSON.stringify(runtimeSearch, null, 2)}\n`);

  const runners = String(args.runners).split(',').map((s) => s.trim()).filter(Boolean);
  const summary = {
    createdAt: new Date().toISOString(),
    questionChars: question.length,
    promptChars: frozenPrompt.length,
    briefChars: (workingMemoryBrief || '').length,
    runners: {},
  };

  for (const kind of runners) {
    const started = Date.now();
    const cfg = {
      ...baseConfig,
      runner: kind,
      opencodeModel: args['opencode-model'] || baseConfig.opencodeModel || process.env.OPENCODE_MODEL,
      cursorBin: args['cursor-bin'] || process.env.CURSOR_AGENT_BIN || 'cursor-agent',
    };
    const meta = describeRunner(cfg);
    const runnerDir = path.join(outDir, kind);
    fs.mkdirSync(runnerDir, { recursive: true });
    fs.writeFileSync(path.join(runnerDir, 'runner.json'), `${JSON.stringify(meta, null, 2)}\n`);
    let answer = '';
    let error = null;
    try {
      answer = runHarness(cfg, frozenPrompt);
      const session = createSession(cfg, question, answer, null, versions, runtimeSearch);
      // 把会话指针也记下来
      fs.writeFileSync(path.join(runnerDir, 'session-path.txt'), `${session.sessionDir}\n`);
    } catch (err) {
      error = err.message || String(err);
      answer = '';
    }
    const elapsedMs = Date.now() - started;
    fs.writeFileSync(path.join(runnerDir, 'answer.md'), `${answer || `(error)\n${error || ''}`}\n`);
    if (error) fs.writeFileSync(path.join(runnerDir, 'error.txt'), `${error}\n`);
    const score = scoreAnswer(answer || '');
    fs.writeFileSync(path.join(runnerDir, 'score.json'), `${JSON.stringify(score, null, 2)}\n`);
    summary.runners[kind] = {
      ...meta,
      elapsedMs,
      error,
      score,
    };
    console.error(`[${kind}] ${error ? `FAIL ${error.slice(0, 120)}` : `ok ${score.chars} chars ${elapsedMs}ms hit=${score.hit.join(',')}`}`);
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    '# Harness compare（同一工作记忆）',
    '',
    `- createdAt: ${summary.createdAt}`,
    `- promptChars: ${summary.promptChars}`,
    `- briefChars: ${summary.briefChars}`,
    '',
    '| runner | chars | elapsedMs | hit | error |',
    '|---|---:|---:|---|---|',
    ...runners.map((kind) => {
      const row = summary.runners[kind];
      return `| ${kind} | ${row.score.chars} | ${row.elapsedMs} | ${(row.score.hit || []).join(', ') || '-'} | ${row.error ? 'yes' : ''} |`;
    }),
    '',
    '评分看的是：是否尊重 multiple 候选停问、是否区分代码/部署版本、是否命中 ying-tail / 未确认修复。',
    '**不是**比谁更能在脏 transcript 里硬撑。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  process.stdout.write(`${outDir}\n`);
  process.stdout.write(md);
}

main();
