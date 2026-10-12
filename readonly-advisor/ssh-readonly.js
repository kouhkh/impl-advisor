'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_LIMITS = {
  connectTimeoutSec: 8,
  commandTimeoutSec: 15,
  maxCommandTimeoutSec: 30,
  maxOutputBytes: 64 * 1024,
  maxConcurrent: 1,
  minIntervalMs: 800,
  maxLoadRatio: 0.75, // refuse if load1 > nproc * ratio
  maxMemUsedRatio: 0.90,
  lsMaxEntries: 80,
  headMaxLines: 80,
  findMaxDepth: 2,
  findMaxResults: 40,
};

const hostLocks = new Map();
const hostLastRunAt = new Map();

function deepMergeLimits(raw) {
  return { ...DEFAULT_LIMITS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendAudit(auditPath, entry) {
  if (!auditPath) return;
  ensureDir(path.dirname(auditPath));
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function assertSafeRelPath(relPath, root) {
  const input = String(relPath || '.').trim() || '.';
  if (input.includes('\0') || input.includes('\n') || input.includes('\r')) {
    throw new Error('path contains illegal characters');
  }
  if (path.isAbsolute(input)) {
    throw new Error(`path must be relative to runtime.root: ${input}`);
  }
  const rootResolved = path.posix.resolve('/', String(root || '/').replace(/\\/g, '/'));
  const joined = path.posix.resolve(rootResolved, input.replace(/\\/g, '/'));
  if (joined !== rootResolved && !joined.startsWith(`${rootResolved}/`)) {
    throw new Error(`path escapes runtime.root: ${input}`);
  }
  return { rel: input.replace(/\\/g, '/'), abs: joined };
}

function acquireHostLock(host, maxConcurrent) {
  const key = String(host);
  const state = hostLocks.get(key) || { active: 0 };
  if (state.active >= maxConcurrent) {
    throw new Error(`ssh host busy: ${host} (maxConcurrent=${maxConcurrent})`);
  }
  state.active += 1;
  hostLocks.set(key, state);
  return () => {
    state.active = Math.max(0, state.active - 1);
    hostLocks.set(key, state);
  };
}

function enforceInterval(host, minIntervalMs) {
  const key = String(host);
  const last = hostLastRunAt.get(key) || 0;
  const wait = last + minIntervalMs - Date.now();
  if (wait > 0) {
    spawnSync('sleep', [String(wait / 1000)], { encoding: 'utf8' });
  }
}

function runRemote(runtime, remoteScript, limits, label) {
  const host = runtime.host;
  const release = acquireHostLock(host, limits.maxConcurrent);
  const started = Date.now();
  try {
    enforceInterval(host, limits.minIntervalMs);
    const target = runtime.user ? `${runtime.user}@${host}` : host;
    const args = [
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${limits.connectTimeoutSec}`,
      '-o', 'StrictHostKeyChecking=accept-new',
    ];
    if (runtime.port && Number(runtime.port) !== 22) {
      args.push('-p', String(runtime.port));
    }
    args.push(target, remoteScript);
    const timeoutMs = Math.min(limits.commandTimeoutSec, limits.maxCommandTimeoutSec) * 1000;
    const result = spawnSync('ssh', args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: limits.maxOutputBytes,
    });
    hostLastRunAt.set(host, Date.now());
    const stdout = (result.stdout || '').slice(0, limits.maxOutputBytes);
    const stderr = (result.stderr || '').slice(0, 4000);
    if (result.error) {
      throw new Error(`ssh ${label} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`ssh ${label} exit ${result.status}: ${stderr || stdout}`.trim());
    }
    return {
      ok: true,
      label,
      ms: Date.now() - started,
      stdout,
      stderr,
    };
  } finally {
    release();
  }
}

function parseHealth(stdout) {
  const lines = String(stdout || '').split('\n');
  const map = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx > 0) map[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  const load1 = Number(map.load1 || 'NaN');
  const nproc = Number(map.nproc || 'NaN');
  const memUsed = Number(map.mem_used_mb || 'NaN');
  const memTotal = Number(map.mem_total_mb || 'NaN');
  return {
    hostname: map.hostname || null,
    load1: Number.isFinite(load1) ? load1 : null,
    nproc: Number.isFinite(nproc) ? nproc : null,
    memUsedMb: Number.isFinite(memUsed) ? memUsed : null,
    memTotalMb: Number.isFinite(memTotal) ? memTotal : null,
    diskUsed: map.disk_used || null,
    raw: stdout,
  };
}

function assertHostHealthy(health, limits) {
  if (health.load1 != null && health.nproc != null && health.nproc > 0) {
    const maxLoad = health.nproc * limits.maxLoadRatio;
    if (health.load1 > maxLoad) {
      throw new Error(`refusing ssh ops: load1=${health.load1} exceeds ${maxLoad.toFixed(2)} (nproc=${health.nproc} * ${limits.maxLoadRatio})`);
    }
  }
  if (health.memUsedMb != null && health.memTotalMb != null && health.memTotalMb > 0) {
    const ratio = health.memUsedMb / health.memTotalMb;
    if (ratio > limits.maxMemUsedRatio) {
      throw new Error(`refusing ssh ops: mem used ratio=${ratio.toFixed(2)} exceeds ${limits.maxMemUsedRatio}`);
    }
  }
}

function healthCheck(runtime, limits = DEFAULT_LIMITS) {
  const script = [
    'hostname',
    'echo hostname=$(hostname)',
    "echo load1=$(awk '{print $1}' /proc/loadavg)",
    'echo nproc=$(nproc)',
    "echo mem_used_mb=$(free -m | awk '/Mem:/{print $3}')",
    "echo mem_total_mb=$(free -m | awk '/Mem:/{print $2}')",
    "echo disk_used=$(df -h / | awk 'NR==2{print $3\"/\"$2\"(\"$5\")\"}')",
  ].join('; ');
  const result = runRemote(runtime, script, limits, 'health');
  const health = parseHealth(result.stdout);
  return { ...result, health };
}

function buildOpScript(op, runtime, args, limits) {
  const root = runtime.root || '/';
  if (op === 'health') return null;
  if (op === 'ls') {
    const { abs } = assertSafeRelPath(args.path || '.', root);
    return [
      `target=${shellQuote(abs)}`,
      'test -d "$target" || { echo "not a directory: $target" >&2; exit 2; }',
      `ls -la "$target" | head -n ${Number(limits.lsMaxEntries) + 1}`,
    ].join('\n');
  }
  if (op === 'head') {
    const { abs } = assertSafeRelPath(args.path, root);
    const lines = Math.min(Number(args.lines || limits.headMaxLines), limits.headMaxLines);
    return [
      `target=${shellQuote(abs)}`,
      'test -f "$target" || { echo "not a file: $target" >&2; exit 2; }',
      // avoid reading huge binaries: size cap 1MB
      'size=$(wc -c < "$target")',
      'if [ "$size" -gt 1048576 ]; then echo "file too large for head: $size bytes" >&2; exit 3; fi',
      `head -n ${lines} "$target"`,
    ].join('\n');
  }
  if (op === 'find-names') {
    const { abs } = assertSafeRelPath(args.path || '.', root);
    const pattern = String(args.pattern || '*');
    if (!/^[\w.*?\[\]\-]+$/.test(pattern)) {
      throw new Error('find-names pattern may only contain alnum, _ - . * ? [ ]');
    }
    const depth = Math.min(Number(args.maxDepth || limits.findMaxDepth), limits.findMaxDepth);
    const maxResults = Math.min(Number(args.maxResults || limits.findMaxResults), limits.findMaxResults);
    return [
      `target=${shellQuote(abs)}`,
      'test -d "$target" || { echo "not a directory: $target" >&2; exit 2; }',
      // -H: follow command-line symlink (e.g. /opt/planora/current) but not deeper links
      `find -H "$target" -maxdepth ${depth} -type f -name ${shellQuote(pattern)} 2>/dev/null | head -n ${maxResults}`,
    ].join('\n');
  }
  if (op === 'deploy-snapshot' || op === 'run-candidates' || op === 'ask-preflight') {
    // Single SSH round-trip variants. No free shell.
    const rootQ = shellQuote(root);
    const ratio = Number(limits.maxLoadRatio);
    const memRatio = Number(limits.maxMemUsedRatio);
    const maxResults = Math.min(Number(args.maxResults || limits.findMaxResults), limits.findMaxResults);
    const maxDepth = Math.min(Number(args.maxDepth || limits.findMaxDepth), limits.findMaxDepth);
    const roots = Array.isArray(args.roots) && args.roots.length ? args.roots : ['logs', 'shared/materials'];
    for (const rel of roots) {
      assertSafeRelPath(rel, root);
    }
    const healthPrefix = [
      `cd ${rootQ} || { echo "cannot enter jail root" >&2; exit 2; }`,
      'echo "hostname=$(hostname)"',
      "echo \"load1=$(awk '{print $1}' /proc/loadavg)\"",
      'echo "nproc=$(nproc)"',
      "echo \"mem_used_mb=$(free -m | awk '/Mem:/{print $3}')\"",
      "echo \"mem_total_mb=$(free -m | awk '/Mem:/{print $2}')\"",
      `awk -v l="$(awk '{print $1}' /proc/loadavg)" -v n="$(nproc)" -v r="${ratio}" 'BEGIN{ if (n+0>0 && l+0 > n*r) { print "refusing: load too high" > "/dev/stderr"; exit 9 } }'`,
      `awk -v u="$(free -m | awk '/Mem:/{print $3}')" -v t="$(free -m | awk '/Mem:/{print $2}')" -v r="${memRatio}" 'BEGIN{ if (t+0>0 && u/t > r) { print "refusing: memory too high" > "/dev/stderr"; exit 9 } }'`,
    ];
    const deployPart = [
      'if [ -e current ]; then echo "current_exists=yes"; else echo "current_exists=no"; fi',
      'echo "current_target=$(readlink -f current 2>/dev/null || readlink current 2>/dev/null || true)"',
      'echo "current_basename=$(basename "$(readlink -f current 2>/dev/null || echo)")"',
      'if [ -e previous ]; then echo "previous_target=$(readlink -f previous 2>/dev/null || readlink previous 2>/dev/null || true)"; fi',
      'if [ -f current/package.json ]; then echo "BEGIN_PACKAGE_JSON"; head -n 40 current/package.json; echo "END_PACKAGE_JSON"; fi',
    ];
    const candidateLoops = roots.map((rel) => {
      const abs = assertSafeRelPath(rel, root).abs;
      return [
        `croot=${shellQuote(abs)}`,
        `cname=${shellQuote(rel)}`,
        'if [ -d "$croot" ]; then',
        `  find -H "$croot" -maxdepth ${maxDepth} -type f -printf '%T@|%s|'"$cname"'|%p\\n' 2>/dev/null`,
        'fi',
      ].join('\n');
    });
    const candidatesPart = [
      'echo "BEGIN_RUN_CANDIDATES"',
      '(',
      ...candidateLoops,
      `) | sort -t'|' -k1,1nr | head -n ${maxResults}`,
      'echo "END_RUN_CANDIDATES"',
    ];
    if (op === 'deploy-snapshot') return [...healthPrefix, ...deployPart].join('\n');
    if (op === 'run-candidates') return [...healthPrefix, ...candidatesPart].join('\n');
    return [...healthPrefix, ...deployPart, ...candidatesPart].join('\n');
  }
  throw new Error(`unsupported ssh op: ${op} (allowed: health, ls, head, find-names, deploy-snapshot, run-candidates, ask-preflight)`);
}

function runSshOp(runtime, { op, args = {}, limits: limitsRaw, auditPath } = {}) {
  if (!runtime || runtime.mode !== 'ssh') {
    throw new Error('runSshOp requires runtime.mode=ssh');
  }
  if (!runtime.host) throw new Error('runtime.host missing');
  if (!runtime.root) throw new Error('runtime.root required for jail');

  const limits = deepMergeLimits({ ...runtime.limits, ...limitsRaw });
  const started = new Date().toISOString();

  let result;
  let beforeHealth;
  if (op === 'health') {
    result = healthCheck(runtime, limits);
    beforeHealth = result.health;
    assertHostHealthy(beforeHealth, limits);
  } else if (op === 'deploy-snapshot' || op === 'run-candidates' || op === 'ask-preflight') {
    // One SSH call only — includes remote load/mem gate inside the script.
    const script = buildOpScript(op, runtime, args, limits);
    result = runRemote(runtime, script, limits, op);
    beforeHealth = parseHealth(result.stdout);
    assertHostHealthy(beforeHealth, limits);
    result.health = beforeHealth;
  } else {
    const before = healthCheck(runtime, limits);
    beforeHealth = before.health;
    assertHostHealthy(beforeHealth, limits);
    const script = buildOpScript(op, runtime, args, limits);
    result = runRemote(runtime, script, limits, op);
    const after = healthCheck(runtime, limits);
    result.afterHealth = after.health;
    assertHostHealthy(after.health, limits);
  }

  const entry = {
    at: started,
    host: runtime.host,
    root: runtime.root,
    op,
    args,
    ms: result.ms,
    ok: true,
    load1Before: beforeHealth && beforeHealth.load1,
    load1After: (result.afterHealth && result.afterHealth.load1) || (beforeHealth && beforeHealth.load1),
    outputBytes: Buffer.byteLength(result.stdout || '', 'utf8'),
  };
  appendAudit(auditPath, entry);
  return {
    ...result,
    beforeHealth,
    audit: entry,
    limits,
  };
}

function formatSshOpsHelp(runtime) {
  const who = runtime.user ? `${runtime.user}@${runtime.host}` : runtime.host;
  return [
    `SSH 只读入口（受资源护栏约束）：${who}`,
    `jail root: ${runtime.root}`,
    '允许操作：health | ls | head | find-names | deploy-snapshot | run-candidates | ask-preflight',
    '本地调用：node readonly-advisor/cli.js ssh --config <cfg> --op <op> [--path rel] [--pattern "*.log"]',
    '护栏：单 host 串行、命令超时、输出截断、load/mem 过高拒绝、路径不得逃出 root、禁止自由 shell。',
  ].join('\n');
}

function defaultAuditPath(project) {
  return path.join(os.homedir(), '.impl-advisor', project || 'project', 'ssh-audit.jsonl');
}

module.exports = {
  DEFAULT_LIMITS,
  deepMergeLimits,
  runSshOp,
  healthCheck,
  assertSafeRelPath,
  formatSshOpsHelp,
  defaultAuditPath,
  parseHealth,
};
