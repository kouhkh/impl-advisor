'use strict';

function extractReleaseSha(basename) {
  if (!basename) return null;
  const name = String(basename);
  // planora-<40hex> or similar project-<sha>
  const m = name.match(/(?:^|[-_])([0-9a-f]{7,40})$/i) || name.match(/^([0-9a-f]{7,40})$/i);
  return m ? m[1].toLowerCase() : null;
}

function parsePackageJsonHead(stdout) {
  const raw = String(stdout || '');
  const start = raw.indexOf('BEGIN_PACKAGE_JSON');
  const end = raw.indexOf('END_PACKAGE_JSON');
  if (start < 0 || end < 0 || end <= start) return { name: null, version: null };
  const body = raw.slice(start + 'BEGIN_PACKAGE_JSON'.length, end).trim();
  try {
    const parsed = JSON.parse(body);
    return {
      name: typeof parsed.name === 'string' ? parsed.name : null,
      version: typeof parsed.version === 'string' ? parsed.version : null,
    };
  } catch {
    const name = (body.match(/"name"\s*:\s*"([^"]+)"/) || [])[1] || null;
    const version = (body.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || null;
    return { name, version };
  }
}

function parseDeploySnapshotStdout(stdout) {
  const map = {};
  for (const line of String(stdout || '').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0 && !line.startsWith('BEGIN_') && !line.startsWith('END_') && !line.startsWith('{')) {
      map[line.slice(0, idx)] = line.slice(idx + 1).trim();
    }
  }
  const basename = map.current_basename || null;
  const pkg = parsePackageJsonHead(stdout);
  return {
    currentExists: map.current_exists === 'yes',
    currentTarget: map.current_target || null,
    currentBasename: basename,
    previousTarget: map.previous_target || null,
    releaseSha: extractReleaseSha(basename),
    packageName: pkg.name,
    packageVersion: pkg.version,
    hostname: map.hostname || null,
    load1: map.load1 ? Number(map.load1) : null,
    raw: stdout,
  };
}

function compareVersions(code, deploy) {
  const codeCommit = code && code.commit ? String(code.commit).toLowerCase() : null;
  const deploySha = deploy && deploy.releaseSha ? String(deploy.releaseSha).toLowerCase() : null;
  if (!codeCommit) {
    return { status: 'unknown_code', detail: 'local git commit unavailable' };
  }
  if (!deploy || deploy.status === 'not_applicable' || deploy.status === 'skipped') {
    return { status: 'deploy_not_bound', detail: deploy && deploy.detail ? deploy.detail : 'no deploy snapshot' };
  }
  if (deploy.status === 'error') {
    return { status: 'deploy_error', detail: deploy.error || 'deploy snapshot failed' };
  }
  if (!deploySha) {
    return { status: 'unknown_deploy', detail: 'deploy release sha not parsed from current basename' };
  }
  if (deploySha.startsWith(codeCommit) || codeCommit.startsWith(deploySha.slice(0, codeCommit.length))) {
    return { status: 'matched', detail: `code ${codeCommit} aligns with deploy ${deploySha.slice(0, 12)}` };
  }
  // also try full sha prefix on code if we only have short
  if (code.fullCommit && (code.fullCommit.startsWith(deploySha) || deploySha.startsWith(code.fullCommit.slice(0, 12)))) {
    return { status: 'matched', detail: `code ${code.fullCommit.slice(0, 12)} aligns with deploy ${deploySha.slice(0, 12)}` };
  }
  return {
    status: 'mismatched',
    detail: `code ${codeCommit} != deploy ${deploySha.slice(0, 12)}; do not treat local HEAD as the running deploy`,
  };
}

function collectCodeVersion(workspace, gitFn) {
  const facts = gitFn(workspace);
  return {
    root: facts.root,
    branch: facts.branch,
    commit: facts.commit,
    fullCommit: facts.fullCommit || null,
    dirty: facts.dirty,
  };
}

function bindVersions(config, {
  collectWorkspaceFactsFn,
  runSshOpFn,
  auditPath,
  includeDeploySnapshot = true,
} = {}) {
  const capturedAt = new Date().toISOString();
  const code = collectCodeVersion(config.workspace, collectWorkspaceFactsFn);
  let deploy = {
    status: 'not_applicable',
    mode: (config.runtime && config.runtime.mode) || 'none',
    detail: 'runtime has no live deploy binding',
  };

  if (!includeDeploySnapshot) {
    deploy = { status: 'skipped', mode: deploy.mode, detail: 'deploy snapshot disabled for this ask' };
  } else if (config.runtime && config.runtime.mode === 'export-dir') {
    deploy = {
      status: 'not_applicable',
      mode: 'export-dir',
      exportDir: config.runtime.exportDir,
      detail: 'export-dir materials are offline traces; not a live deploy version',
    };
  } else if (config.runtime && config.runtime.mode === 'ssh') {
    try {
      const result = runSshOpFn(config.runtime, {
        op: 'deploy-snapshot',
        auditPath,
      });
      const parsed = parseDeploySnapshotStdout(result.stdout);
      deploy = {
        status: parsed.currentExists ? 'observed' : 'missing_current',
        mode: 'ssh',
        host: config.runtime.host,
        root: config.runtime.root,
        ...parsed,
        ms: result.ms,
        load1: parsed.load1,
      };
    } catch (error) {
      deploy = {
        status: 'error',
        mode: 'ssh',
        host: config.runtime.host,
        root: config.runtime.root,
        error: error.message,
        detail: error.message,
      };
    }
  }

  const comparison = compareVersions(code, deploy);
  return {
    capturedAt,
    code,
    deploy,
    comparison,
  };
}

function formatVersionBinding(versions) {
  if (!versions) return '';
  const code = versions.code || {};
  const deploy = versions.deploy || {};
  const comparison = versions.comparison || {};
  const lines = [
    '版本绑定（必须区分，禁止混用）：',
    `- 采集时间：${versions.capturedAt || 'unknown'}`,
    `- 代码工作区 commit：${code.commit || 'unknown'}${code.dirty ? '（工作区有未提交改动）' : ''}`,
    `- 代码分支：${code.branch || 'unknown'}`,
    `- 部署绑定状态：${deploy.status || 'unknown'}（mode=${deploy.mode || 'none'}）`,
  ];
  if (deploy.mode === 'ssh') {
    lines.push(`- 部署 host/root：${deploy.host || '?'}:${deploy.root || '?'}`);
    lines.push(`- current → ${deploy.currentTarget || 'unknown'}`);
    lines.push(`- current basename：${deploy.currentBasename || 'unknown'}`);
    lines.push(`- 解析到的部署 release sha：${deploy.releaseSha || 'unknown'}`);
    if (deploy.packageVersion) lines.push(`- package.json version：${deploy.packageVersion}`);
  }
  if (deploy.mode === 'export-dir') {
    lines.push(`- 离线导出目录：${deploy.exportDir || 'unknown'}（不能当作线上部署版本）`);
  }
  if (deploy.status === 'error' || deploy.status === 'skipped') {
    lines.push(`- 部署快照说明：${deploy.detail || deploy.error || ''}`);
  }
  lines.push(`- 代码 vs 部署：${comparison.status} — ${comparison.detail || ''}`);
  lines.push('回答要求：分别写「代码事实（工作区 commit）」和「部署/运行事实（current/release）」；不一致或未知时不得用代码 HEAD 冒充部署版本。');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  extractReleaseSha,
  parseDeploySnapshotStdout,
  parsePackageJsonHead,
  compareVersions,
  bindVersions,
  formatVersionBinding,
};
