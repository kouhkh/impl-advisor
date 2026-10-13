'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  WORKING_MEMORY_SCHEMA,
  workingMemoryPath,
  loadWorkingMemory,
  updateWorkingMemory,
  buildWorkingMemoryBrief,
  selectRunCandidate,
  decideAllowedOps,
  evaluateStop,
  createWorkingMemory,
  ingestCards,
} = require('./working-memory');
const { makeCard } = require('./evidence-gateway');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-working-memory-'));
const sessionDir = path.join(root, 'session');

const runtimeMultiple = {
  status: 'observed',
  roots: ['logs'],
  classification: { status: 'multiple', detail: 'two candidates' },
  candidates: [{ path: 'logs/a.log' }, { path: 'logs/b.log' }],
};

updateWorkingMemory(sessionDir, {
  sessionId: 'advisor-test',
  question: '第一轮问题：这次运行是哪份日志？',
  answer: '看到两个候选；待确认运行候选。无法验证唯一来源。',
  versions: {
    code: { root: '/workspace/demo', fullCommit: 'abc123' },
    deploy: { releaseSha: 'def456' },
    comparison: { status: 'mismatched', detail: 'code != deploy' },
  },
  runtimeSearch: runtimeMultiple,
});

updateWorkingMemory(sessionDir, {
  sessionId: 'advisor-test',
  question: '第二轮问题：确认用 a.log',
  answer: '第二轮回答；仍缺部署对齐证据。',
  versions: {
    code: { fullCommit: 'abc123' },
    deploy: { releaseSha: 'def456' },
    comparison: { status: 'mismatched', detail: 'code != deploy' },
  },
  runtimeSearch: runtimeMultiple,
});

updateWorkingMemory(sessionDir, {
  sessionId: 'advisor-test',
  question: '第三轮问题',
  answer: '第三轮回答。',
  runtimeSearch: {
    status: 'observed',
    classification: { status: 'single', detail: 'one candidate' },
    candidates: [{ path: 'logs/a.log' }],
    roots: ['logs'],
  },
});

assert.ok(fs.existsSync(workingMemoryPath(sessionDir)));
const memory = loadWorkingMemory(sessionDir);
assert.equal(memory.schemaVersion, WORKING_MEMORY_SCHEMA);
assert.equal(memory.turns.length, 2);
assert.deepEqual(memory.turns.map((item) => item.turn), [2, 3]);
assert.ok(memory.evidenceCards.some((card) => card.op === 'version.bind'));
assert.ok(memory.evidenceCards.some((card) => card.op === 'run.list'));
assert.equal(memory.runCandidate.status, 'single');
assert.ok(memory.unresolved.length >= 0);
assert.ok(memory.allowedNextOps.includes('run.log_slice'));

const brief = buildWorkingMemoryBrief(sessionDir, { budget: 1600 });
assert.match(brief, /顾问工作记忆/);
assert.match(brief, /第二轮问题/);
assert.match(brief, /第三轮问题/);
assert.doesNotMatch(brief, /第一轮问题：这次运行/);
assert.match(brief, /证据卡片/);
assert.ok(brief.length <= 1600);

let selected = selectRunCandidate(memory, 'logs/a.log');
assert.equal(selected.runCandidate.selected, 'logs/a.log');
assert.ok(decideAllowedOps(selected).includes('run.log_slice'));

const empty = createWorkingMemory({ sessionId: 'x' });
const stopped = evaluateStop({
  ...empty,
  counters: { toolCalls: 0, consecutiveNoNewEvidence: 2 },
  policy: empty.policy,
}, { addedCardCount: 0 });
assert.equal(stopped, 'no_new_evidence');

const { memory: afterIngest, added } = ingestCards(empty, [
  makeCard({
    op: 'code.search',
    title: 'search demo',
    status: 'observed',
    pointers: ['a.js:1'],
    summary: 'hit',
  }),
]);
assert.equal(added, 1);
assert.equal(afterIngest.evidenceCards.length, 1);

console.log('working-memory-test: ok');
