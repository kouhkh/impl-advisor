'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { createHandler } = require('../runner/server');
const { loadConfig } = require('./lib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-advisor-test-'));
const workspace = path.join(root, 'workspace');
const records = path.join(root, 'records');
const notes = path.join(root, 'notes');
const advisorHome = path.join(root, 'advisor-home');
const exportDir = path.join(root, 'exports');
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(advisorHome, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });
fs.writeFileSync(path.join(exportDir, 'run-a.txt'), 'export fixture\n');
spawnSync('git', ['init', '-q'], { cwd: workspace });
fs.writeFileSync(path.join(workspace, 'README.md'), '# fixture\n');
spawnSync('git', ['add', '.'], { cwd: workspace });
spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'fixture'], { cwd: workspace });

const cli = path.join(__dirname, 'cli.js');

let result = spawnSync(process.execPath, [
  cli, 'init',
  '--project', 'fixture',
  '--task', 'fixture task',
  '--workspace', workspace,
  '--output', path.join(advisorHome, 'project.json'),
  '--recordDir', records,
  '--notesDir', notes,
  '--environment', 'local-test',
  '--runtime-mode', 'export-dir',
  '--export-dir', exportDir,
], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const config = path.join(advisorHome, 'project.json');
assert.ok(fs.existsSync(config));
assert.ok(fs.existsSync(path.join(notes, 'README.md')));
assert.ok(!fs.existsSync(path.join(workspace, '.dsh-advisor.project.json')));
assert.ok(!config.startsWith(`${workspace}${path.sep}`));

const loaded = JSON.parse(fs.readFileSync(config, 'utf8'));
assert.equal(loaded.runtime.mode, 'export-dir');
assert.equal(loaded.runtime.exportDir, exportDir);
assert.equal(loaded.environment, 'local-test');

result = spawnSync(process.execPath, [
  cli, 'init',
  '--project', 'bad',
  '--workspace', workspace,
  '--output', path.join(workspace, 'inside.json'),
], { encoding: 'utf8' });
assert.notEqual(result.status, 0);
assert.match(result.stderr, /refusing to write advisor config inside target workspace/);

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

const pageContextPath = path.join(root, 'page-context.json');
fs.writeFileSync(pageContextPath, JSON.stringify({
  page_url: 'https://example.test/job/1',
  captured_at: '2026-10-12T12:00:00+08:00',
  ui_target: { selector: '#result', visible_text: '改写结果' },
}, null, 2));

result = spawnSync(process.execPath, [
  cli, 'ask',
  '--config', config,
  '--question', '为什么？',
  '--page-context', pageContextPath,
  '--dry-run',
], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /existing-readonly-index search --root /);
assert.match(result.stdout, /运行材料（只读，export-dir）/);
assert.match(result.stdout, new RegExp(exportDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(result.stdout, /页面事实/);
assert.match(result.stdout, /https:\/\/example\.test\/job\/1/);
assert.match(result.stdout, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const sessionDir = result.stdout.split('\n')[0];
assert.ok(fs.existsSync(path.join(sessionDir, 'session.json')));
assert.ok(fs.existsSync(path.join(sessionDir, 'page-context.json')));
assert.ok(sessionDir.startsWith(records));

result = spawnSync(process.execPath, [cli, 'followup', '--session', sessionDir, '--question', '还有什么？', '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /已有专家会话记录/);
assert.match(result.stdout, /为什么？/);
assert.match(result.stdout, /还有什么？/);
assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json'))).turns, 2);

result = spawnSync(process.execPath, [cli, 'propose', '--session', sessionDir, '--dry-run'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.ok(fs.existsSync(path.join(sessionDir, 'change-proposal.md')));
assert.match(result.stdout, /已有专家会话记录/);

result = spawnSync(process.execPath, [cli, 'review', '--session', sessionDir, '--decision', 'needs_changes', '--note', '补充一个回归测试。'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDir, 'review.json'))).decision, 'needs_changes');

function testRunner() {
  return new Promise((resolve, reject) => {
    const runtimeConfig = loadConfig(config);
    const server = http.createServer(createHandler({ config: runtimeConfig, dryRun: true }));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const payload = JSON.stringify({
        question: '页面上这次改写依据是什么？',
        created_at: '2026-10-12T12:30:00+08:00',
        source: 'pinask-test',
        scene: { url: 'https://example.test/rewrite/9' },
        ui_elements: [{ selector: '.answer', text: '语气偏硬' }],
        selection_groups: [],
      });
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/pinask',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            assert.equal(res.statusCode, 200, body);
            const json = JSON.parse(body);
            assert.equal(json.ok, true);
            assert.ok(json.id);
            assert.ok(json.session);
            assert.match(json.answer, /页面事实/);
            assert.match(json.answer, /https:\/\/example\.test\/rewrite\/9/);
            assert.match(json.answer, /运行材料（只读，export-dir）/);
            server.close();
            resolve();
          } catch (error) {
            server.close();
            reject(error);
          }
        });
      });
      req.on('error', (error) => {
        server.close();
        reject(error);
      });
      req.write(payload);
      req.end();
    });
  });
}

testRunner()
  .then(() => {
    console.log('readonly-advisor cli tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
