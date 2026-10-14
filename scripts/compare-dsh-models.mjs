#!/usr/bin/env node
/**
 * 同 harness（DSH）换模型：v4-pro / frontis glm-5.3 / frontis kimi-k2.7-code。
 * 默认复用 confirmed 完成局的 frozen-prompt，只变 agent-default-model。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadConfig, createSession } = require(path.join(root, 'readonly-advisor/lib.js'));
const { describeRunner } = require(path.join(root, 'readonly-advisor/runners.js'));

const DEFAULT_MODELS = [
  { id: 'dsh-v4-pro', provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'off' },
  { id: 'dsh-glm53', provider: 'frontis', model: 'glm-5.3' },
  { id: 'dsh-kimi27', provider: 'frontis', model: 'kimi-k2.7-code' },
];

function parseArgs(argv) {
  const out = {
    prompt: path.join(os.homedir(), '.impl-advisor/planora/ablation/harness-confirmed-20261014T085107Z/frozen-prompt.md'),
    config: path.join(os.homedir(), '.impl-advisor/planora/project.json'),
    models: DEFAULT_MODELS.map((m) => m.id).join(','),
    // 默认 12min；GLM 空转时可再加长，但对照默认要有硬顶
    timeoutMs: String(12 * 60 * 1000),
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

function prepareDshHome(baseSettingsPath, credPath, provider, model, reasoningEffort) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-model-ab-${model.replace(/[^a-z0-9.-]/gi, '_')}-`));
  fs.copyFileSync(credPath, path.join(home, '.credentials.yaml'));
  let settings = fs.readFileSync(baseSettingsPath, 'utf8');
  settings = settings.replace(
    /agent-default-model:\n  provider: [^\n]+\n  model: [^\n]+(?:\n  reasoningEffort: [^\n]+)?/,
    [
      'agent-default-model:',
      `  provider: ${provider}`,
      `  model: ${model}`,
      ...(reasoningEffort ? [`  reasoningEffort: ${reasoningEffort}`] : []),
    ].join('\n'),
  );
  fs.writeFileSync(path.join(home, 'settings.yaml'), settings);
  return home;
}

function runDshTimed(config, prompt, timeoutMs) {
  const dshBin = config.dshBin
    || process.env.DSH_BIN
    || '/Users/ltc/DshProject/deepseek-harness/apps/cli/lib/bin.js';
  const isJs = dshBin.endsWith('.js');
  const command = isJs ? process.execPath : dshBin;
  const args = isJs
    ? [dshBin, '--profile', 'headless', prompt]
    : ['--profile', 'headless', prompt];
  const result = spawnSync(command, args, {
    cwd: config.workspace,
    env: { ...process.env, DSH_HOME: config.dshHome },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  if (result.error && result.error.code === 'ETIMEDOUT') {
    const partial = (result.stdout || '').trim();
    const err = new Error(`DSH timeout after ${timeoutMs}ms`);
    err.partial = partial;
    err.timedOut = true;
    throw err;
  }
  if (result.error) throw result.error;
  if (result.status !== 0 && result.signal) {
    const partial = (result.stdout || '').trim();
    const err = new Error(`DSH killed signal=${result.signal}`);
    err.partial = partial;
    err.timedOut = true;
    throw err;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-4000);
    throw new Error(`DSH failed with status ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('usage: node scripts/compare-dsh-models.mjs --out <dir> [--prompt <frozen.md>] [--config <cfg>] [--models id,id] [--timeoutMs N]');
    process.exit(2);
  }
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const frozenPrompt = fs.readFileSync(path.resolve(args.prompt), 'utf8');
  fs.writeFileSync(path.join(outDir, 'frozen-prompt.md'), frozenPrompt);
  fs.writeFileSync(path.join(outDir, 'prompt-source.txt'), `${path.resolve(args.prompt)}\n`);

  const baseConfig = loadConfig(path.resolve(args.config));
  baseConfig.recordDir = path.join(outDir, 'sessions');
  fs.mkdirSync(baseConfig.recordDir, { recursive: true });
  const timeoutMs = Number(args.timeoutMs) || (12 * 60 * 1000);

  const wanted = new Set(String(args.models).split(',').map((s) => s.trim()).filter(Boolean));
  const models = DEFAULT_MODELS.filter((m) => wanted.has(m.id));
  if (!models.length) {
    console.error(`no models matched: ${args.models}`);
    process.exit(2);
  }

  const baseSettings = path.join(os.homedir(), '.dsh/settings.yaml');
  const credPath = path.join(os.homedir(), '.dsh/.credentials.yaml');
  const summary = {
    createdAt: new Date().toISOString(),
    promptSource: path.resolve(args.prompt),
    timeoutMs,
    models: {},
  };

  for (const spec of models) {
    const started = Date.now();
    const runnerDir = path.join(outDir, spec.id);
    fs.mkdirSync(runnerDir, { recursive: true });
    const dshHome = prepareDshHome(baseSettings, credPath, spec.provider, spec.model, spec.reasoningEffort);
    fs.writeFileSync(path.join(runnerDir, 'dsh-home.txt'), `${dshHome}\n`);
    fs.copyFileSync(path.join(dshHome, 'settings.yaml'), path.join(runnerDir, 'settings.yaml'));

    let answer = '';
    let error = null;
    let timedOut = false;
    try {
      const cfg = {
        ...baseConfig,
        runner: 'dsh',
        dshHome,
        dshBin: baseConfig.dshBin || process.env.DSH_BIN || '/Users/ltc/DshProject/deepseek-harness/apps/cli/lib/bin.js',
      };
      fs.writeFileSync(path.join(runnerDir, 'runner.json'), `${JSON.stringify({
        ...describeRunner(cfg),
        provider: spec.provider,
        model: spec.model,
        timeoutMs,
      }, null, 2)}\n`);
      answer = runDshTimed(cfg, frozenPrompt, timeoutMs);
      createSession(cfg, `Q3 confirmed model-ab ${spec.id}`, answer, null, null, null);
    } catch (err) {
      timedOut = Boolean(err.timedOut);
      if (err.partial) answer = err.partial;
      error = err.message || String(err);
    }
    const elapsedMs = Date.now() - started;
    fs.writeFileSync(path.join(runnerDir, 'answer.md'), `${answer || `(error)\n${error || ''}`}\n`);
    if (error) fs.writeFileSync(path.join(runnerDir, 'error.txt'), `${error}\n`);
    const score = scoreAnswer(answer || '');
    fs.writeFileSync(path.join(runnerDir, 'score.json'), `${JSON.stringify({ ...score, elapsedMs, timedOut }, null, 2)}\n`);
    summary.models[spec.id] = {
      provider: spec.provider,
      model: spec.model,
      elapsedMs,
      timedOut,
      error,
      score,
    };
    const tag = error ? (timedOut ? `TIMEOUT ${error.slice(0, 120)}` : `FAIL ${error.slice(0, 200)}`) : `ok chars=${score.chars} hit=${score.hit.join(',')}`;
    console.error(`[${spec.id}] ${tag} (${elapsedMs}ms)`);
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const rows = models.map((m) => {
    const r = summary.models[m.id];
    const c = r.score.checks || {};
    const sec = (r.elapsedMs / 1000).toFixed(1);
    const status = r.timedOut ? 'timeout' : (r.error ? 'FAIL' : 'ok');
    return `| ${m.id} | ${r.provider}/${r.model} | ${status} | ${sec}s | ${r.score.chars} | ${c.ying_tail ? 'Y' : ''} | ${c.code_path ? 'Y' : ''} | ${(r.score.hit || []).join(', ') || '-'} |`;
  });
  const md = [
    '# DSH model A/B（同 frozen prompt）',
    '',
    `- createdAt: ${summary.createdAt}`,
    `- prompt: ${summary.promptSource}`,
    `- timeoutMs: ${summary.timeoutMs}`,
    '',
    '| id | provider/model | status | elapsed | chars | ying_tail | code_path | hit |',
    '|---|---|---|---:|---:|:---:|:---:|---|',
    ...rows,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  process.stdout.write(`${outDir}\n${md}\n`);
}

main();
