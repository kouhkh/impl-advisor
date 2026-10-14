'use strict';

/**
 * Harness runners：只负责「怎么把 prompt 交给模型并拿回文本」。
 * 证据网关 / 工作记忆 / 停搜策略不在这里。
 *
 * 对照实验前提：同一 working-memory brief + 同一题 + 同一模型族，只换 runner。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveRunnerKind(config) {
  const raw = (config && (config.runner || config.harness)) || 'dsh';
  return String(raw).trim().toLowerCase();
}

function runSpawn(command, args, { cwd, env } = {}) {
  return spawnSync(command, args, {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function runDsh(config, prompt) {
  const dshBin = config.dshBin;
  const isJsLauncher = typeof dshBin === 'string' && dshBin.endsWith('.js');
  if (isJsLauncher && !fs.existsSync(dshBin)) throw new Error(`DSH binary does not exist: ${dshBin}`);
  if (config.dryRun) return `[dry-run]\n${prompt}`;
  const env = { ...process.env, DSH_HOME: config.dshHome };
  const command = isJsLauncher ? process.execPath : dshBin;
  const commandArgs = isJsLauncher
    ? [dshBin, '--profile', 'headless', prompt]
    : ['--profile', 'headless', prompt];
  const result = runSpawn(command, commandArgs, { cwd: config.workspace, env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-4000);
    throw new Error(`DSH failed with status ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

/**
 * OpenCode 对照入口。
 * 默认：`opencode run --dir <ws> -m <model> --auto <prompt>`。
 * 顾问对照时默认加「禁止工具、只信工作记忆」前缀，避免 build agent 工具空转；
 * 设 config.opencodeAllowTools=true 可关闭该前缀。
 */
function runOpenCode(config, prompt) {
  if (config.dryRun) {
    return `[dry-run:opencode]\n${prompt}`;
  }
  const bin = config.opencodeBin
    || process.env.OPENCODE_BIN
    || 'opencode';
  const model = config.opencodeModel
    || process.env.OPENCODE_MODEL
    || 'opencode/mimo-v2.6-flash-free';
  const allowTools = config.opencodeAllowTools === true
    || process.env.OPENCODE_ALLOW_TOOLS === '1';
  const effectivePrompt = allowTools
    ? prompt
    : [
      '【顾问对照约束】禁止调用任何工具（bash/read/grep/edit）。',
      '只根据下方已注入的「顾问工作记忆」与问题作答。',
      '若运行候选为 multiple / 停搜原因为 need_confirmation：必须先追问确认，不得继续搜索。',
      '不得把代码 HEAD 冒充部署版本。',
      '',
      prompt,
    ].join('\n');
  let commandArgs;
  if (Array.isArray(config.opencodeArgs) && config.opencodeArgs.length) {
    commandArgs = [...config.opencodeArgs, effectivePrompt];
  } else {
    commandArgs = [
      'run',
      '--dir', config.workspace,
      '-m', model,
      '--auto',
      '--title', 'impl-advisor',
      effectivePrompt,
    ];
  }
  const result = runSpawn(bin, commandArgs, { cwd: config.workspace });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        `OpenCode binary not found (${bin}). Install OpenCode or set config.opencodeBin / OPENCODE_BIN. `
        + '对照时请与 DSH 共用同一 working-memory brief。',
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-4000);
    throw new Error(`OpenCode failed with status ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  const text = (result.stdout || '').trim();
  if (!text) {
    throw new Error('OpenCode returned empty stdout (often tool-loop without final answer); retry with default no-tools prefix or set opencodeAllowTools');
  }
  return text;
}

/**
 * Cursor Agent 参照入口（只读 ask 模式）。
 * 默认：`cursor-agent --mode ask --print --trust --workspace <ws> <prompt>`
 */
function runCursor(config, prompt) {
  if (config.dryRun) {
    return `[dry-run:cursor]\n${prompt}`;
  }
  const bin = config.cursorBin
    || process.env.CURSOR_AGENT_BIN
    || 'cursor-agent';
  const prefix = Array.isArray(config.cursorArgs) && config.cursorArgs.length
    ? config.cursorArgs
    : ['--mode', 'ask', '--print', '--trust', '--workspace', config.workspace];
  // 超长 prompt 走临时文件，避免 argv 边界问题
  const tmp = path.join(os.tmpdir(), `impl-advisor-cursor-${Date.now()}.md`);
  fs.writeFileSync(tmp, prompt, 'utf8');
  try {
    const commandArgs = [...prefix, fs.readFileSync(tmp, 'utf8')];
    const result = runSpawn(bin, commandArgs, { cwd: config.workspace });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(
          `cursor-agent not found (${bin}). Install Cursor CLI or set CURSOR_AGENT_BIN.`,
        );
      }
      throw result.error;
    }
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim().slice(-4000);
      throw new Error(`cursor-agent failed with status ${result.status}${detail ? `: ${detail}` : ''}`);
    }
    return (result.stdout || '').trim();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function runHarness(config, prompt) {
  const kind = resolveRunnerKind(config);
  if (kind === 'dsh' || kind === 'deepseek-harness') return runDsh(config, prompt);
  if (kind === 'opencode' || kind === 'open-code') return runOpenCode(config, prompt);
  if (kind === 'cursor' || kind === 'cursor-agent') return runCursor(config, prompt);
  throw new Error(`unsupported runner: ${kind} (supported: dsh, opencode, cursor)`);
}

function describeRunner(config) {
  const kind = resolveRunnerKind(config);
  if (kind === 'opencode' || kind === 'open-code') {
    return {
      kind: 'opencode',
      bin: config.opencodeBin || process.env.OPENCODE_BIN || 'opencode',
      model: config.opencodeModel || process.env.OPENCODE_MODEL || 'opencode/mimo-v2.6-flash-free',
      note: '同一工作记忆 brief；仅换 harness',
    };
  }
  if (kind === 'cursor' || kind === 'cursor-agent') {
    return {
      kind: 'cursor',
      bin: config.cursorBin || process.env.CURSOR_AGENT_BIN || 'cursor-agent',
      note: '参照 runner（ask 只读）',
    };
  }
  return {
    kind: 'dsh',
    bin: config.dshBin,
    dshHome: config.dshHome,
    note: '默认 runner',
  };
}

module.exports = {
  resolveRunnerKind,
  runDsh,
  runOpenCode,
  runCursor,
  runHarness,
  describeRunner,
};
