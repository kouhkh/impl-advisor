'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-advisor-test-'));
const workspace = path.join(root, 'workspace');
const records = path.join(root, 'records');
const advisorHome = path.join(root, 'advisor-home');
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(advisorHome, { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: workspace });
fs.writeFileSync(path.join(workspace, 'README.md'), '# fixture\n');
spawnSync('git', ['add', '.'], { cwd: workspace });
spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'fixture'], { cwd: workspace });

const cli = path.join(__dirname, 'cli.js');

// init must default outside the target workspace
let result = spawnSync(process.execPath, [
  cli, 'init',
  '--project', 'fixture',
  '--task', 'fixture task',
  '--workspace', workspace,
  '--output', path.join(advisorHome, 'project.json'),
  '--recordDir', records,
], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const config = path.join(advisorHome, 'project.json');
assert.ok(fs.existsSync(config));
assert.ok(!fs.existsSync(path.join(workspace, '.dsh-advisor.project.json')));
assert.ok(!config.startsWith(`${workspace}${path.sep}`));

// refusing to put config inside workspace
result = spawnSync(process.execPath, [
  cli, 'init',
  '--project', 'bad',
  '--workspace', workspace,
  '--output', path.join(workspace, 'inside.json'),
], { encoding: 'utf8' });
assert.notEqual(result.status, 0);
assert.match(result.stderr, /refusing to write advisor config inside target workspace/);

// patch dshBin for dry-run without real DSH
const configJson = JSON.parse(fs.readFileSync(config, 'utf8'));
configJson.dshBin = process.execPath;
configJson.dshHome = root;
configJson.retrieval = {
  provider: 'existing-readonly-index',
  commands: {
    search: 'existing-readonly-index search --root {workspace} --json',
  },
};
fs.writeFileSync(config, `${JSON.stringify(configJson, null, 2)}\n`);

result = spawnSync(process.execPath, [cli, 'ask', '--config', config, '--question', '为什么？', '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /existing-readonly-index search --root /);
assert.match(result.stdout, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const sessionDir = result.stdout.split('\n')[0];
assert.ok(fs.existsSync(path.join(sessionDir, 'session.json')));
assert.ok(fs.existsSync(path.join(sessionDir, 'transcript.md')));
assert.ok(sessionDir.startsWith(records));

result = spawnSync(process.execPath, [cli, 'followup', '--session', sessionDir, '--question', '还有什么？', '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /已有专家会话记录/);
assert.match(result.stdout, /为什么？/);
assert.match(result.stdout, /还有什么？/);
const metadata = JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json')));
assert.equal(metadata.turns, 2);

result = spawnSync(process.execPath, [cli, 'propose', '--session', sessionDir, '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.ok(fs.existsSync(path.join(sessionDir, 'change-proposal.md')));
assert.match(result.stdout, /已有专家会话记录/);

result = spawnSync(process.execPath, [cli, 'review', '--session', sessionDir, '--decision', 'needs_changes', '--note', '补充一个回归测试。'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDir, 'review.json'))).decision, 'needs_changes');
assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json'))).status, 'proposal_needs_changes');
console.log('readonly-advisor cli tests passed');
