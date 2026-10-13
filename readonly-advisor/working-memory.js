'use strict';

/**
 * 顾问工作记忆：每轮只把「当前问题 + 结论摘要 + 证据卡 + 运行候选 + 未决 + 允许下一步」
 * 交给模型。完整 transcript / 工具轨迹只落盘。
 *
 * 状态约定：
 * - observed：网关实际读到的
 * - derived：模型或规则推导的（不可当部署事实）
 * - confirmed：专家/研发确认后
 * - stale：代码 commit / 部署 / 运行环境变化后
 */
const fs = require('node:fs');
const path = require('node:path');

const WORKING_MEMORY_SCHEMA = 'readonly-advisor-working-memory/1';
const DEFAULT_MAX_TURNS = 2;
const DEFAULT_MAX_CARDS = 12;
const DEFAULT_BRIEF_BUDGET = 4000;
const DEFAULT_CONCLUSION_BUDGET = 1200;
const DEFAULT_QUESTION_BUDGET = 800;
const DEFAULT_NO_NEW_EVIDENCE_LIMIT = 2;
const DEFAULT_TOOL_CALL_LIMIT = 24;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function workingMemoryPath(sessionDir) {
  return path.join(sessionDir, 'working-memory.json');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function trimText(value, budget) {
  const raw = String(value || '').trim();
  const limit = Math.max(0, Number(budget) || 0);
  if (raw.length <= limit) return raw;
  if (limit <= 24) return raw.slice(0, limit);
  const marker = '\n…(working-memory truncated)…\n';
  const room = limit - marker.length;
  const head = Math.ceil(room * 0.62);
  const tail = Math.max(0, room - head);
  return `${raw.slice(0, head).trimEnd()}${marker}${raw.slice(-tail).trimStart()}`;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map((value) => String(value)))];
}

function emptyRunCandidate() {
  return {
    status: 'unknown',
    selected: null,
    roots: [],
    candidateCount: 0,
    detail: '',
  };
}

function createWorkingMemory({
  sessionId,
  question = '',
  maxTurns = DEFAULT_MAX_TURNS,
  maxCards = DEFAULT_MAX_CARDS,
} = {}) {
  return {
    schemaVersion: WORKING_MEMORY_SCHEMA,
    sessionId: sessionId || null,
    question: trimText(question, DEFAULT_QUESTION_BUDGET),
    conclusion: '',
    evidenceCards: [],
    runCandidate: emptyRunCandidate(),
    unresolved: [],
    allowedNextOps: ['code.search', 'code.read', 'run.list', 'version.bind'],
    stopReason: null,
    turns: [],
    counters: {
      toolCalls: 0,
      consecutiveNoNewEvidence: 0,
    },
    policy: {
      maxTurns: Math.max(1, Math.min(4, Number(maxTurns) || DEFAULT_MAX_TURNS)),
      maxCards: Math.max(4, Math.min(24, Number(maxCards) || DEFAULT_MAX_CARDS)),
      briefBudget: DEFAULT_BRIEF_BUDGET,
      noNewEvidenceLimit: DEFAULT_NO_NEW_EVIDENCE_LIMIT,
      toolCallLimit: DEFAULT_TOOL_CALL_LIMIT,
      fullTranscript: 'disk-only',
      evidencePromotion: 'requires-confirmation',
    },
    updatedAt: new Date().toISOString(),
  };
}

function loadWorkingMemory(sessionDir) {
  const file = workingMemoryPath(sessionDir);
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function saveWorkingMemory(sessionDir, memory) {
  writeJson(workingMemoryPath(sessionDir), memory);
  return memory;
}

function cardKey(card) {
  if (!card) return '';
  const pointers = (card.pointers || []).join('|');
  return `${card.op}|${card.title}|${pointers}`;
}

function pruneCards(cards, maxCards) {
  const list = Array.isArray(cards) ? [...cards] : [];
  // 确认 > 观测 > 推导；同级保留较新
  const rank = { confirmed: 3, observed: 2, derived: 1, stale: 0 };
  list.sort((a, b) => {
    const ra = rank[a.status] || 0;
    const rb = rank[b.status] || 0;
    if (ra !== rb) return rb - ra;
    return String(b.observedAt || '').localeCompare(String(a.observedAt || ''));
  });
  return list.slice(0, maxCards);
}

function extractUnresolved(answer, runCandidate) {
  const lines = String(answer || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hits = lines.filter((line) => /未知|缺失|待确认|需要确认|无法验证|证据不足|未读取|未找到|不确定|无法还原|无法确认/.test(line));
  if (runCandidate && runCandidate.status === 'multiple') {
    hits.unshift('运行候选为 multiple：须先确认唯一候选，再读日志正文。');
  }
  if (runCandidate && runCandidate.status === 'none') {
    hits.unshift('运行候选缺失：缺运行材料，不得编造 run_id。');
  }
  return unique(hits).slice(0, 6).map((line) => trimText(line, 360));
}

function runCandidateFromSearch(runtimeSearch) {
  if (!runtimeSearch) return emptyRunCandidate();
  const classification = runtimeSearch.classification || {};
  const status = classification.status
    || (runtimeSearch.status === 'skipped' || runtimeSearch.status === 'not_applicable'
      ? runtimeSearch.status
      : runtimeSearch.status === 'error' ? 'error' : 'unknown');
  return {
    status,
    selected: null,
    roots: runtimeSearch.roots || [],
    candidateCount: (runtimeSearch.candidates || []).length,
    detail: classification.detail || runtimeSearch.detail || runtimeSearch.error || '',
  };
}

function decideAllowedOps(memory) {
  const ops = new Set(['code.search', 'code.read', 'version.bind']);
  const run = memory.runCandidate || emptyRunCandidate();
  if (run.status === 'multiple') {
    ops.add('run.list');
    ops.add('run.summary');
    // 未确认前禁止 log_slice
  } else if (run.status === 'single' || run.selected) {
    ops.add('run.list');
    ops.add('run.summary');
    ops.add('run.log_slice');
  } else if (run.status === 'none' || run.status === 'skipped' || run.status === 'not_applicable') {
    ops.add('run.list');
    ops.add('run.summary');
  } else {
    ops.add('run.list');
    ops.add('run.summary');
  }
  return [...ops];
}

function evaluateStop(memory, { addedCardCount = 0 } = {}) {
  const policy = memory.policy || {};
  const counters = memory.counters || { toolCalls: 0, consecutiveNoNewEvidence: 0 };
  if (counters.toolCalls >= (policy.toolCallLimit || DEFAULT_TOOL_CALL_LIMIT)) {
    return 'tool_budget';
  }
  if ((counters.consecutiveNoNewEvidence || 0) >= (policy.noNewEvidenceLimit || DEFAULT_NO_NEW_EVIDENCE_LIMIT)
    && addedCardCount === 0) {
    return 'no_new_evidence';
  }
  if (memory.runCandidate && memory.runCandidate.status === 'multiple') {
    return 'need_confirmation';
  }
  return null;
}

function ingestCards(memory, cards = []) {
  const previousKeys = new Set((memory.evidenceCards || []).map(cardKey));
  const incoming = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const fresh = [];
  for (const card of incoming) {
    const key = cardKey(card);
    if (!key || previousKeys.has(key)) continue;
    previousKeys.add(key);
    fresh.push(card);
  }
  const nextCards = pruneCards([...(memory.evidenceCards || []), ...fresh], memory.policy.maxCards);
  const counters = {
    toolCalls: (memory.counters && memory.counters.toolCalls || 0) + incoming.length,
    consecutiveNoNewEvidence: fresh.length
      ? 0
      : (memory.counters && memory.counters.consecutiveNoNewEvidence || 0) + (incoming.length ? 1 : 0),
  };
  const next = {
    ...memory,
    evidenceCards: nextCards,
    counters,
    updatedAt: new Date().toISOString(),
  };
  next.allowedNextOps = decideAllowedOps(next);
  next.stopReason = evaluateStop(next, { addedCardCount: fresh.length });
  return { memory: next, added: fresh.length };
}

function confirmCard(memory, cardId) {
  const evidenceCards = (memory.evidenceCards || []).map((card) => (
    card.id === cardId ? { ...card, status: 'confirmed' } : card
  ));
  return {
    ...memory,
    evidenceCards,
    updatedAt: new Date().toISOString(),
  };
}

function markStale(memory, { reason = 'environment_changed' } = {}) {
  const evidenceCards = (memory.evidenceCards || []).map((card) => (
    card.status === 'stale' ? card : { ...card, status: 'stale', staleReason: reason }
  ));
  return {
    ...memory,
    evidenceCards,
    conclusion: memory.conclusion
      ? `${memory.conclusion}\n（注意：证据已因 ${reason} 标记 stale，需回源）`
      : '',
    updatedAt: new Date().toISOString(),
  };
}

function selectRunCandidate(memory, selectedPath) {
  const next = {
    ...memory,
    runCandidate: {
      ...(memory.runCandidate || emptyRunCandidate()),
      status: 'single',
      selected: selectedPath,
      detail: `专家确认候选：${selectedPath}`,
    },
    updatedAt: new Date().toISOString(),
  };
  next.allowedNextOps = decideAllowedOps(next);
  next.stopReason = next.stopReason === 'need_confirmation' ? null : next.stopReason;
  return next;
}

function updateWorkingMemory(sessionDir, {
  sessionId = null,
  question = '',
  answer = '',
  versions = null,
  runtimeSearch = null,
  cards = null,
  maxTurns = null,
  maxCards = null,
} = {}) {
  ensureDir(sessionDir);
  const previous = loadWorkingMemory(sessionDir) || createWorkingMemory({
    sessionId,
    question,
    maxTurns: maxTurns || DEFAULT_MAX_TURNS,
    maxCards: maxCards || DEFAULT_MAX_CARDS,
  });
  if (maxTurns) previous.policy.maxTurns = Math.max(1, Math.min(4, Number(maxTurns)));
  if (maxCards) previous.policy.maxCards = Math.max(4, Math.min(24, Number(maxCards)));

  const { cardsFromAskContext } = require('./evidence-gateway');
  const autoCards = cards || cardsFromAskContext({ versions, runtimeSearch });
  const ingested = ingestCards({
    ...previous,
    sessionId: sessionId || previous.sessionId || path.basename(sessionDir),
    question: trimText(question || previous.question, DEFAULT_QUESTION_BUDGET),
    conclusion: trimText(answer, DEFAULT_CONCLUSION_BUDGET),
    runCandidate: runtimeSearch ? runCandidateFromSearch(runtimeSearch) : previous.runCandidate,
  }, autoCards);

  let memory = ingested.memory;
  memory.unresolved = extractUnresolved(answer, memory.runCandidate);
  memory.allowedNextOps = decideAllowedOps(memory);
  if (!memory.stopReason) {
    memory.stopReason = evaluateStop(memory, { addedCardCount: ingested.added });
  }

  const turnNo = previous.turns && previous.turns.length
    ? previous.turns[previous.turns.length - 1].turn + 1
    : 1;
  const turnEntry = {
    turn: turnNo,
    question: memory.question,
    conclusion: memory.conclusion,
    runStatus: memory.runCandidate.status,
    unresolved: memory.unresolved,
    evidenceIds: (memory.evidenceCards || []).slice(0, 8).map((c) => c.id),
    stopReason: memory.stopReason,
    recordedAt: new Date().toISOString(),
  };
  memory.turns = [...(Array.isArray(previous.turns) ? previous.turns : []), turnEntry]
    .slice(-(memory.policy.maxTurns || DEFAULT_MAX_TURNS));
  memory.updatedAt = new Date().toISOString();
  return saveWorkingMemory(sessionDir, memory);
}

function formatWorkingMemory(memory, { budget = DEFAULT_BRIEF_BUDGET } = {}) {
  if (!memory) return '';
  const parts = [
    '顾问工作记忆（滚动摘要；完整 transcript 仅落盘，默认不回灌）：',
    `- session: ${memory.sessionId || 'unknown'}`,
    `- 当前问题：${memory.question || '（空）'}`,
    `- 当前结论：${memory.conclusion || '（尚无）'}`,
    `- 运行候选：${memory.runCandidate && memory.runCandidate.status}${memory.runCandidate && memory.runCandidate.selected ? ` → ${memory.runCandidate.selected}` : ''}${memory.runCandidate && memory.runCandidate.detail ? `（${trimText(memory.runCandidate.detail, 160)}）` : ''}`,
    `- 允许下一步：${(memory.allowedNextOps || []).join(', ') || '无'}`,
    `- 停搜原因：${memory.stopReason || '无'}`,
  ];
  if (memory.unresolved && memory.unresolved.length) {
    parts.push(`- 未决：${memory.unresolved.join('；')}`);
  }
  const cards = memory.evidenceCards || [];
  if (cards.length) {
    parts.push('', '## 证据卡片');
    for (const card of cards.slice(0, 8)) {
      parts.push(
        `- [${card.status}] ${card.op} · ${card.title}`
        + (card.summary ? ` — ${trimText(card.summary, 180)}` : '')
        + (card.pointers && card.pointers.length ? ` | ${card.pointers.slice(0, 4).join(', ')}` : ''),
      );
    }
  }
  if (memory.turns && memory.turns.length) {
    parts.push('', '## 最近轮次摘要');
    for (const turn of memory.turns.slice(-2)) {
      parts.push(
        `### 第 ${turn.turn} 轮`,
        `问题：${turn.question || '（空）'}`,
        `结论：${turn.conclusion || '（空）'}`,
        `运行：${turn.runStatus || 'unknown'}`,
      );
      if (turn.unresolved && turn.unresolved.length) {
        parts.push(`未决：${turn.unresolved.join('；')}`);
      }
    }
  }
  parts.push('', '使用规则：只把上述内容当线索；回答前须回源读证据卡指针；无证据则明确“当前无法确认”。');
  if (memory.stopReason === 'need_confirmation') {
    parts.push('当前必须先确认唯一运行候选，禁止混读多份运行材料。');
  }
  if (memory.stopReason === 'no_new_evidence' || memory.stopReason === 'tool_budget') {
    parts.push(`已触发停搜（${memory.stopReason}）：列出仍缺什么，不要继续盲搜。`);
  }
  return trimText(parts.join('\n'), budget);
}

function buildWorkingMemoryBrief(sessionDir, { budget = DEFAULT_BRIEF_BUDGET } = {}) {
  return formatWorkingMemory(loadWorkingMemory(sessionDir), { budget });
}

module.exports = {
  WORKING_MEMORY_SCHEMA,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_CARDS,
  DEFAULT_BRIEF_BUDGET,
  DEFAULT_NO_NEW_EVIDENCE_LIMIT,
  DEFAULT_TOOL_CALL_LIMIT,
  workingMemoryPath,
  createWorkingMemory,
  loadWorkingMemory,
  saveWorkingMemory,
  updateWorkingMemory,
  ingestCards,
  confirmCard,
  markStale,
  selectRunCandidate,
  decideAllowedOps,
  evaluateStop,
  formatWorkingMemory,
  buildWorkingMemoryBrief,
  runCandidateFromSearch,
  extractUnresolved,
  trimText,
};
