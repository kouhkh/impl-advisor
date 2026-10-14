'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  GATEWAY_OPS,
  makeCard,
  codeSearch,
  codeRead,
  runSummary,
  runLogSlice,
  cardsFromAskContext,
  executeOp,
} = require('./evidence-gateway');

assert.deepEqual(GATEWAY_OPS, [
  'code.search',
  'code.read',
  'run.list',
  'run.summary',
  'run.log_slice',
  'run.record_list',
  'run.record_get',
  'version.bind',
]);

const card = makeCard({
  op: 'code.read',
  title: 'demo',
  status: 'observed',
  pointers: ['a.js:1'],
  summary: 'ok',
});
assert.equal(card.op, 'code.read');
assert.equal(card.status, 'observed');
assert.throws(() => makeCard({ op: 'hack.all', title: 'x' }), /unknown evidence gateway op/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-evidence-gw-'));
const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace);
spawnSync('git', ['init', '-q'], { cwd: workspace });
fs.writeFileSync(path.join(workspace, 'hello.js'), 'const YING_FALSE_COMPOUND = 1;\nexport function demo() { return 42; }\n');
spawnSync('git', ['add', '.'], { cwd: workspace });
spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'fixture'], { cwd: workspace });

const config = { project: 'fixture', workspace, runtime: { mode: 'none' } };

const search = codeSearch(config, { query: 'YING_FALSE_COMPOUND' });
assert.equal(search.op, 'code.search');
assert.ok(search.pointers.some((p) => p.includes('hello.js')));

const read = codeRead(config, { file: path.join(workspace, 'hello.js'), maxChars: 200 });
assert.equal(read.op, 'code.read');
assert.match(read.payload.text, /YING_FALSE_COMPOUND/);

assert.throws(
  () => codeRead(config, { file: path.join(root, 'outside.txt') }),
  /escapes workspace/,
);

const summary = runSummary({
  status: 'observed',
  classification: { status: 'multiple', detail: 'two files' },
  candidates: [{ path: 'a.log' }, { path: 'b.log' }],
});
assert.equal(summary.status, 'derived');
assert.match(summary.summary, /须先确认/);

const refused = runLogSlice(config, {
  candidatePath: 'logs/a.log',
  classification: { status: 'multiple' },
  confirmed: false,
});
assert.equal(refused.payload.refused, true);
assert.equal(refused.payload.reason, 'multiple_unconfirmed');

const fromCtx = cardsFromAskContext({
  versions: {
    code: { fullCommit: 'aaa' },
    deploy: { releaseSha: 'bbb' },
    comparison: { status: 'mismatched', detail: 'diff' },
  },
  runtimeSearch: {
    status: 'observed',
    classification: { status: 'single', detail: 'one' },
    candidates: [{ path: 'logs/a.log' }],
    roots: ['logs'],
  },
});
assert.ok(fromCtx.some((c) => c.op === 'version.bind'));
assert.ok(fromCtx.some((c) => c.op === 'run.list'));
assert.ok(fromCtx.some((c) => c.op === 'run.summary'));

const viaExecute = executeOp('code.read', config, { file: 'hello.js' });
assert.equal(viaExecute.op, 'code.read');

console.log('evidence-gateway-test: ok');
