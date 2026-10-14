'use strict';

/**
 * Harness runners：只负责「怎么把 prompt 交给模型并拿回文本」。
 * 证据网关 / 工作记忆 / 停搜策略不在这里。
 *
 * 对照实验前提：同一 working-memory brief + 同一题 + 同一模型族，只换 runner。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveRunnerKind(config) {
  const raw = (config && (config.runner || config.harness)) || 'dsh';
  return String(raw).trim().toLowerCase();
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

/**
 * OpenCode 对照入口。
 * 默认：`opencode run <prompt>`；可用 config.opencodeArgs 覆盖前缀参数。
 * 未安装时 dry-run 仍可用；live 会抛清晰错误。
 */
function runOpenCode(config, prompt) {
  if (config.dryRun) {
    return `[dry-run:opencode]\n${prompt}`;
  }
  const bin = config.opencodeBin
    || process.env.OPENCODE_BIN
    || 'opencode';
  const prefix = Array.isArray(config.opencodeArgs) && config.opencodeArgs.length
    ? config.opencodeArgs
    : ['run'];
  const commandArgs = [...prefix, prompt];
  const result = spawnSync(bin, commandArgs, {
    cwd: config.workspace,
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
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
  return (result.stdout || '').trim();
}

function runHarness(config, prompt) {
  const kind = resolveRunnerKind(config);
  if (kind === 'dsh' || kind === 'deepseek-harness') return runDsh(config, prompt);
  if (kind === 'opencode' || kind === 'open-code') return runOpenCode(config, prompt);
  throw new Error(`unsupported runner: ${kind} (supported: dsh, opencode)`);
}

function describeRunner(config) {
  const kind = resolveRunnerKind(config);
  if (kind === 'opencode' || kind === 'open-code') {
    return {
      kind: 'opencode',
      bin: config.opencodeBin || process.env.OPENCODE_BIN || 'opencode',
      note: '同一工作记忆 brief；仅换 harness',
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
  runHarness,
  describeRunner,
};
