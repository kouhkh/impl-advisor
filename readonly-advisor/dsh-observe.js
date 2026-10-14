'use strict';

/**
 * Capture DSH headless observation that stdout alone does not provide.
 * Headless only prints the final assistant text; durable events live under
 * $DSH_HOME/sessions/<project>/session-<id>/session.jsonl.zstd
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function readAgentDefaultModel(dshHome) {
  const file = path.join(dshHome || path.join(os.homedir(), '.dsh'), 'settings.yaml');
  if (!fs.existsSync(file)) {
    return { provider: null, model: null, reasoningEffort: null, settingsPath: file };
  }
  const text = fs.readFileSync(file, 'utf8');
  const block = text.match(/agent-default-model:\s*\n([\s\S]*?)(?=\n[^\s]|$)/);
  const section = block ? block[1] : text;
  const provider = (section.match(/^\s*provider:\s*(\S+)/m) || [])[1] || null;
  const model = (section.match(/^\s*model:\s*(\S+)/m) || [])[1] || null;
  const reasoningEffort = (section.match(/^\s*reasoningEffort:\s*(\S+)/m) || [])[1] || null;
  return { provider, model, reasoningEffort, settingsPath: file };
}

function decompressSessionJsonl(artifactPath) {
  if (!artifactPath || !fs.existsSync(artifactPath)) return null;
  if (artifactPath.endsWith('.jsonl') && !artifactPath.endsWith('.zstd')) {
    return fs.readFileSync(artifactPath, 'utf8');
  }
  const result = spawnSync('zstd', ['-dc', artifactPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout || '';
}

function parseSessionHeader(jsonlText) {
  if (!jsonlText) return null;
  const first = jsonlText.split('\n').find((line) => line.trim());
  if (!first) return null;
  try {
    return JSON.parse(first);
  } catch {
    return null;
  }
}

/**
 * Find the newest DSH durable session for cwd created at/after startedAtMs.
 */
function findLatestDshSession({ dshHome, cwd, startedAtMs = 0 }) {
  const root = path.join(dshHome || path.join(os.homedir(), '.dsh'), 'sessions');
  if (!fs.existsSync(root)) return null;
  const absCwd = path.resolve(cwd || process.cwd());
  const candidates = [];
  for (const projectDir of fs.readdirSync(root)) {
    const projectPath = path.join(root, projectDir);
    let st;
    try {
      st = fs.statSync(projectPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const name of fs.readdirSync(projectPath)) {
      if (!name.startsWith('session-')) continue;
      const artifact = path.join(projectPath, name, 'session.jsonl.zstd');
      const artifactRaw = path.join(projectPath, name, 'session.jsonl');
      const file = fs.existsSync(artifact) ? artifact : (fs.existsSync(artifactRaw) ? artifactRaw : null);
      if (!file) continue;
      const mtimeMs = fs.statSync(file).mtimeMs;
      if (startedAtMs && mtimeMs + 1000 < startedAtMs) continue;
      candidates.push({ file, mtimeMs, sessionId: name, projectDir });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const item of candidates.slice(0, 12)) {
    const text = decompressSessionJsonl(item.file);
    const header = parseSessionHeader(text);
    if (!header) continue;
    const headerCwd = header.cwd ? path.resolve(header.cwd) : null;
    if (headerCwd && headerCwd !== absCwd) continue;
    return {
      ...item,
      header,
      jsonlText: text,
    };
  }
  // Fallback: newest under any project if cwd match failed (empty ablation workspaces).
  if (candidates[0]) {
    const text = decompressSessionJsonl(candidates[0].file);
    return {
      ...candidates[0],
      header: parseSessionHeader(text),
      jsonlText: text,
      cwdMatched: false,
    };
  }
  return null;
}

function extractAssistantText(event) {
  const content = event && event.data && event.data.message && event.data.message.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/** Prefer the longest non-empty assistant message (matches DSH headless fix). */
function pickBestAssistantText(texts) {
  let best = '';
  for (const text of texts || []) {
    if (!text) continue;
    if (String(text).length > best.length) best = String(text);
  }
  return best;
}

function summarizeDshEvents(jsonlText) {
  const toolCounts = Object.create(null);
  const toolTrail = [];
  const typeCounts = Object.create(null);
  const assistantTexts = [];
  let assistantMessages = 0;
  let turnEnds = 0;
  let model = null;
  let provider = null;

  for (const line of String(jsonlText || '').split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const type = event.type || '(unknown)';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    if ((type === 'request/context' || type === 'request/header') && event.data) {
      const header = event.data.header && typeof event.data.header === 'object'
        ? event.data.header
        : null;
      provider = event.data.provider || (header && header.provider) || provider;
      model = event.data.model || (header && header.model) || model;
    }
    if (type === 'assistant/message') {
      assistantMessages += 1;
      const joined = extractAssistantText(event);
      if (joined) assistantTexts.push(joined);
    }
    if (type === 'turn/end') turnEnds += 1;
    if (type === 'tool/call') {
      const name = (event.data && (event.data.name || event.data.tool)) || 'unknown';
      toolCounts[name] = (toolCounts[name] || 0) + 1;
      let detail = '';
      const args = event.data && event.data.arguments;
      if (args && typeof args === 'object') {
        detail = args.command || args.path || args.pattern || args.file_path || args.glob || '';
        if (typeof detail !== 'string') detail = JSON.stringify(detail).slice(0, 160);
        else detail = detail.slice(0, 160);
      } else if (typeof args === 'string') {
        detail = args.slice(0, 160);
      }
      toolTrail.push({
        seq: event.seq,
        name,
        detail,
      });
    }
  }

  const bestAssistantText = pickBestAssistantText(assistantTexts);
  return {
    typeCounts,
    toolCounts,
    toolTrail,
    assistantMessages,
    assistantTexts,
    bestAssistantText,
    turnEnds,
    provider,
    model,
    eventLines: Object.values(typeCounts).reduce((a, b) => a + b, 0),
  };
}

/**
 * If durable session text has a longer substantive answer than stdout, prefer it.
 */
function resolveAnswerFromObservation(stdoutAnswer, observation) {
  const fromStdout = String(stdoutAnswer || '').trim();
  const fromEvents = observation
    && observation.summary
    && observation.summary.bestAssistantText
      ? String(observation.summary.bestAssistantText).trim()
      : '';
  // summary may not carry bestAssistantText if older capture — fall back to re-parse
  let best = fromEvents;
  if (!best && observation && observation.dshSession && observation.dshSession.copiedTo) {
    try {
      const text = decompressSessionJsonl(observation.dshSession.copiedTo);
      best = (summarizeDshEvents(text).bestAssistantText) || '';
    } catch {
      best = '';
    }
  }
  if (best && best.length > fromStdout.length) {
    return { answer: best, source: 'dsh-session-events', stdoutChars: fromStdout.length, eventChars: best.length };
  }
  return { answer: fromStdout, source: 'dsh-stdout', stdoutChars: fromStdout.length, eventChars: best.length };
}

function formatAgentTraceMarkdown(summary, meta = {}) {
  const lines = [
    '# DSH agent trace',
    '',
    `- dshSessionId: ${meta.sessionId || 'unknown'}`,
    `- artifact: ${meta.artifactPath || 'unknown'}`,
    `- cwdMatched: ${meta.cwdMatched !== false}`,
    `- provider/model (from events): ${summary.provider || '?'} / ${summary.model || '?'}`,
    `- settings default: ${meta.settingsModel || '?'}`,
    `- eventLines: ${summary.eventLines}`,
    `- assistant/message count: ${summary.assistantMessages}`,
    `- turn/end count: ${summary.turnEnds}`,
    '',
    '## Tool call counts',
    '',
  ];
  const tools = Object.entries(summary.toolCounts || {}).sort((a, b) => b[1] - a[1]);
  if (!tools.length) lines.push('_no tool/call events_');
  else {
    for (const [name, count] of tools) lines.push(`- ${name}: ${count}`);
  }
  lines.push('', '## Tool trail (truncated)', '');
  const trail = summary.toolTrail || [];
  if (!trail.length) lines.push('_empty_');
  else {
    trail.slice(0, 200).forEach((row, index) => {
      lines.push(`${index + 1}. \`seq=${row.seq}\` **${row.name}** ${row.detail ? `— ${row.detail}` : ''}`);
    });
    if (trail.length > 200) lines.push(`… +${trail.length - 200} more`);
  }
  lines.push('', '## Event type counts', '');
  for (const [type, count] of Object.entries(summary.typeCounts || {}).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${type}: ${count}`);
  }
  lines.push('');
  return lines.join('\n');
}

function captureDshObservation({
  dshHome,
  cwd,
  startedAtMs,
  sessionDir,
}) {
  const settings = readAgentDefaultModel(dshHome);
  const found = findLatestDshSession({ dshHome, cwd, startedAtMs });
  const observation = {
    capturedAt: new Date().toISOString(),
    settingsModel: settings,
    dshSession: null,
    summary: null,
  };
  if (!found) {
    writeObservationFiles(sessionDir, observation, null);
    return observation;
  }
  const destName = found.file.endsWith('.zstd') ? 'dsh-session.jsonl.zstd' : 'dsh-session.jsonl';
  const dest = path.join(sessionDir, destName);
  fs.copyFileSync(found.file, dest);
  const summary = summarizeDshEvents(found.jsonlText);
  observation.dshSession = {
    sessionId: found.sessionId || (found.header && found.header.id) || null,
    artifactPath: found.file,
    copiedTo: dest,
    mtimeMs: found.mtimeMs,
    cwdMatched: found.cwdMatched !== false,
    header: found.header || null,
  };
  observation.summary = {
    toolCounts: summary.toolCounts,
    assistantMessages: summary.assistantMessages,
    turnEnds: summary.turnEnds,
    eventLines: summary.eventLines,
    provider: summary.provider,
    model: summary.model,
    bestAssistantTextChars: summary.bestAssistantText ? summary.bestAssistantText.length : 0,
    bestAssistantText: summary.bestAssistantText || '',
  };
  writeObservationFiles(sessionDir, observation, summary);
  return observation;
}

function writeObservationFiles(sessionDir, observation, summary) {
  if (!sessionDir) return;
  const forDisk = {
    ...observation,
    summary: observation.summary
      ? {
        ...observation.summary,
        // Keep length only on disk; full text stays in-memory for answer recovery.
        bestAssistantText: undefined,
      }
      : null,
  };
  fs.writeFileSync(
    path.join(sessionDir, 'dsh-run.json'),
    `${JSON.stringify(forDisk, null, 2)}\n`,
  );
  if (summary) {
    fs.writeFileSync(
      path.join(sessionDir, 'agent-trace.md'),
      formatAgentTraceMarkdown(summary, {
        sessionId: observation.dshSession && observation.dshSession.sessionId,
        artifactPath: observation.dshSession && observation.dshSession.artifactPath,
        cwdMatched: observation.dshSession && observation.dshSession.cwdMatched,
        settingsModel: observation.settingsModel
          && `${observation.settingsModel.provider}/${observation.settingsModel.model}`,
      }),
    );
  }
}

module.exports = {
  readAgentDefaultModel,
  findLatestDshSession,
  summarizeDshEvents,
  pickBestAssistantText,
  extractAssistantText,
  resolveAnswerFromObservation,
  formatAgentTraceMarkdown,
  captureDshObservation,
  decompressSessionJsonl,
};
