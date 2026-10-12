'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-advisor-test-'));
const workspace = path.join(root, 'workspace');
const records = path.join(root, 'records');
fs.mkdirSync(workspace, { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: workspace });
fs.writeFileSync(path.join(workspace, 'README.md'), '# fixture\n');
spawnSync('git', ['add', '.'], { cwd: workspace });
spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'fixture'], { cwd: workspace });
const config = path.join(root, 'project.json');
fs.writeFileSync(config, JSON.stringify({
  schemaVersion: 'readonly-advisor-project/1',
  project: 'fixture',
  task: 'fixture task',
  workspace,
  readOnly: true,
  recordDir: records,
  dshBin: process.execPath,
  dshHome: root,
  retrieval: {
    provider: 'existing-readonly-index',
    commands: {
      search: 'existing-readonly-index search --root {workspace} --json',
    },
  },
}, null, 2));
const cli = path.join(__dirname, 'cli.js');
let result = spawnSync(process.execPath, [cli, 'ask', '--config', config, '--question', '为什么？', '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /existing-readonly-index search --root /);
assert.match(result.stdout, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const sessionDir = result.stdout.split('\n')[0];
assert.ok(fs.existsSync(path.join(sessionDir, 'session.json')));
assert.ok(fs.existsSync(path.join(sessionDir, 'transcript.md')));
result = spawnSync(process.execPath, [cli, 'followup', '--session', sessionDir, '--question', '还有什么？', '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const metadata = JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json')));
assert.equal(metadata.turns, 2);
result = spawnSync(process.execPath, [cli, 'propose', '--session', sessionDir, '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.ok(fs.existsSync(path.join(sessionDir, 'change-proposal.md')));
result = spawnSync(process.execPath, [cli, 'review', '--session', sessionDir, '--decision', 'needs_changes', '--note', '补充一个回归测试。'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDir, 'review.json'))).decision, 'needs_changes');
assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json'))).status, 'proposal_needs_changes');
console.log('readonly-advisor cli tests passed');
