'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  summarizeDshEvents,
  formatAgentTraceMarkdown,
  captureDshObservation,
  readAgentDefaultModel,
} = require('./dsh-observe');

const sample = [
  JSON.stringify({ type: 'session', id: 'session-test', cwd: '/tmp/ws' }),
  JSON.stringify({ type: 'request/context', seq: 1, data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', contextWindow: 128000 } }),
  JSON.stringify({ type: 'tool/call', seq: 2, data: { name: 'grep', arguments: { pattern: 'foo' } } }),
  JSON.stringify({ type: 'tool/result', seq: 3, data: { name: 'grep' } }),
  JSON.stringify({ type: 'tool/call', seq: 4, data: { name: 'bash', arguments: { command: 'ls' } } }),
  JSON.stringify({ type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: 'done' }] } } }),
  JSON.stringify({ type: 'turn/end', seq: 6, data: { reason: { kind: 'completed' } } }),
].join('\n');

const summary = summarizeDshEvents(sample);
assert.equal(summary.toolCounts.grep, 1);
assert.equal(summary.toolCounts.bash, 1);
assert.equal(summary.assistantMessages, 1);
assert.equal(summary.model, 'deepseek-v4-pro');
assert.equal(summary.bestAssistantText, 'done');
assert.match(formatAgentTraceMarkdown(summary, { sessionId: 'session-test' }), /grep: 1/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-observe-test-'));
const fakeHome = path.join(tmp, 'dsh-home');
const sessRoot = path.join(fakeHome, 'sessions', 'proj', 'session-abc');
fs.mkdirSync(sessRoot, { recursive: true });
const artifact = path.join(sessRoot, 'session.jsonl');
fs.writeFileSync(artifact, `${sample}\n`);
const now = Date.now();
fs.utimesSync(artifact, new Date(now), new Date(now));

const advisorSession = path.join(tmp, 'advisor-session');
fs.mkdirSync(advisorSession, { recursive: true });
const obs = captureDshObservation({
  dshHome: fakeHome,
  cwd: '/tmp/ws',
  startedAtMs: now - 60_000,
  sessionDir: advisorSession,
});
assert.ok(obs.dshSession);
assert.ok(fs.existsSync(path.join(advisorSession, 'agent-trace.md')));
assert.ok(fs.existsSync(path.join(advisorSession, 'dsh-run.json')));
assert.ok(fs.existsSync(path.join(advisorSession, 'dsh-session.jsonl')));

const model = readAgentDefaultModel(path.join(os.homedir(), '.dsh'));
assert.ok(model.settingsPath);

console.log('dsh-observe-test: ok');
