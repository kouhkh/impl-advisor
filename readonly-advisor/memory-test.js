'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  generateProjectMemory,
  generateTaskMemory,
  generateRunMemory,
  confirmMemoryFact,
  loadMemoryForPrompt,
  formatNotesWithBudget,
  buildFollowupBrief,
  truncateText,
} = require('./memory');
const { pickBestAssistantText, resolveAnswerFromObservation, summarizeDshEvents } = require('./dsh-observe');

assert.equal(pickBestAssistantText(['short', 'a'.repeat(100), 'mid']), 'a'.repeat(100));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-memory-'));
const workspace = path.join(tmp, 'ws');
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"demo-app"}\n');
fs.writeFileSync(path.join(workspace, 'README.md'), '# demo\n');
const notesDir = path.join(tmp, 'notes');
fs.mkdirSync(notesDir);
fs.writeFileSync(path.join(notesDir, 'map.md'), `${'入口目录说明\n'.repeat(40)}`);
fs.writeFileSync(path.join(notesDir, 'task.md'), '语气改写任务路径 technical-spec-rewrite\n');
fs.writeFileSync(path.join(notesDir, 'runtime-reading.md'), 'logs 与 shared/materials\n');

const config = {
  project: 'demo',
  workspace,
  notesDir,
  memoryDir: path.join(tmp, 'memory'),
  task: 'tone-rewrite',
  terms: { 适应带宽: 'false compound' },
  importantPaths: { rewrite: 'lib/technical-spec-rewrite' },
  runtime: { mode: 'none' },
};

const project = generateProjectMemory(config, { revision: 'abc1234' });
assert.ok(fs.existsSync(project.md));
const task = generateTaskMemory(config, {
  revision: 'abc1234',
  question: '适应带宽被改成确保适带宽？',
});
assert.ok(fs.existsSync(task.md));
confirmMemoryFact(config, { text: '假合词「适应」不可拆应', sourceSession: 's1', revision: 'abc1234' });

const runMem = generateRunMemory(config, {
  runKey: 'test-deploy-01931424',
  sessionId: 's-run-1',
  question: '乐乐0920 适应带宽 改写记录',
  versions: {
    code: { commit: 'bb57ee33' },
    deploy: { releaseSha: '01931424e433' },
    comparison: { status: 'mismatched', detail: 'code != deploy' },
  },
  runtimeSearch: {
    status: 'observed',
    roots: ['logs'],
    candidates: [{ path: '/opt/planora/logs/test-deploy-01931424.log' }],
    classification: { status: 'multiple', detail: '2 candidates' },
  },
});
assert.ok(fs.existsSync(runMem.md));
assert.ok(fs.existsSync(path.join(config.memoryDir, 'run-memory', 'test-deploy-01931424', 'latest.json')));
assert.match(fs.readFileSync(runMem.md, 'utf8'), /单次运行记忆/);

const loaded = loadMemoryForPrompt(config, { question: '适应带宽 改写 运行日志', budget: 2000 });
assert.match(loaded.text, /外置记忆/);
assert.ok(loaded.files.length >= 1);
assert.ok(loaded.text.includes('run-memory') || loaded.files.some((f) => f.includes('run-memory')));

const notes = formatNotesWithBudget(config, { question: '适应带宽 改写根因', budget: 800 });
assert.match(notes, /按问题挑选/);
assert.ok(!notes.includes('logs 与 shared/materials') || notes.length <= 900);

const sessionDir = path.join(tmp, 'session');
fs.mkdirSync(sessionDir);
fs.writeFileSync(path.join(sessionDir, 'question.md'), 'Q1\n');
fs.writeFileSync(path.join(sessionDir, 'answer.md'), `${'长答案。'.repeat(200)}\n`);
fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({ sessionId: 'advisor-x', turns: 1 }));
fs.writeFileSync(path.join(sessionDir, 'agent-trace.md'), '# trace\n');
const brief = buildFollowupBrief(sessionDir, { budget: 1500 });
assert.match(brief, /上一轮会话摘要/);
assert.match(brief, /…\(truncated\)/);
assert.ok(brief.length <= 1500);
assert.ok(!fs.readFileSync(path.join(sessionDir, 'answer.md'), 'utf8').includes('上一轮'));

const summary = summarizeDshEvents([
  JSON.stringify({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'AAAA'.repeat(50) }] } } }),
  JSON.stringify({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }),
].join('\n'));
assert.equal(summary.bestAssistantText, 'AAAA'.repeat(50));
const resolved = resolveAnswerFromObservation('done', {
  summary: { bestAssistantText: summary.bestAssistantText },
});
assert.equal(resolved.source, 'dsh-session-events');
assert.equal(resolved.answer, summary.bestAssistantText);
assert.equal(truncateText('abcdef', 5).includes('…'), true);

console.log('memory-test: ok');
