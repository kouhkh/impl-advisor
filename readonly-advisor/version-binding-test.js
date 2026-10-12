'use strict';

const assert = require('node:assert/strict');
const {
  extractReleaseSha,
  parseDeploySnapshotStdout,
  compareVersions,
  bindVersions,
  formatVersionBinding,
} = require('./version-binding');

assert.equal(
  extractReleaseSha('planora-01931424e4336a5bd03697643d7f19a1282b6ce1'),
  '01931424e4336a5bd03697643d7f19a1282b6ce1',
);

const parsed = parseDeploySnapshotStdout(`
hostname=box
load1=0.1
nproc=4
current_exists=yes
current_target=/opt/planora/releases/planora-01931424e4336a5bd03697643d7f19a1282b6ce1
current_basename=planora-01931424e4336a5bd03697643d7f19a1282b6ce1
BEGIN_PACKAGE_JSON
{
  "name": "planora",
  "version": "0.1.0"
}
END_PACKAGE_JSON
`);
assert.equal(parsed.releaseSha, '01931424e4336a5bd03697643d7f19a1282b6ce1');
assert.equal(parsed.packageVersion, '0.1.0');

assert.equal(compareVersions(
  { commit: '0193142', fullCommit: '01931424e4336a5bd03697643d7f19a1282b6ce1' },
  { status: 'observed', releaseSha: '01931424e4336a5bd03697643d7f19a1282b6ce1' },
).status, 'matched');

assert.equal(compareVersions(
  { commit: 'deadbeef' },
  { status: 'observed', releaseSha: '01931424e4336a5bd03697643d7f19a1282b6ce1' },
).status, 'mismatched');

const bound = bindVersions({
  workspace: '/tmp',
  runtime: { mode: 'export-dir', exportDir: '/tmp/exports' },
  project: 'fixture',
}, {
  collectWorkspaceFactsFn: () => ({ root: '/tmp', branch: 'main', commit: 'abc1234', fullCommit: 'abc1234ffff', dirty: false }),
  runSshOpFn: () => { throw new Error('should not ssh'); },
});
assert.equal(bound.comparison.status, 'deploy_not_bound');
assert.match(formatVersionBinding(bound), /版本绑定/);
assert.match(formatVersionBinding(bound), /不得用代码 HEAD 冒充部署版本/);

const sshBound = bindVersions({
  workspace: '/tmp',
  runtime: { mode: 'ssh', host: '123', root: '/opt/planora' },
  project: 'fixture',
}, {
  collectWorkspaceFactsFn: () => ({ root: '/tmp', branch: 'main', commit: '0193142', fullCommit: '01931424e4336a5bd03697643d7f19a1282b6ce1', dirty: false }),
  runSshOpFn: () => ({
    ms: 10,
    stdout: `current_exists=yes\ncurrent_target=/opt/planora/releases/planora-01931424e4336a5bd03697643d7f19a1282b6ce1\ncurrent_basename=planora-01931424e4336a5bd03697643d7f19a1282b6ce1\n`,
  }),
});
assert.equal(sshBound.comparison.status, 'matched');

console.log('version-binding tests passed');
