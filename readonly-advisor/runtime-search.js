'use strict';

const DEFAULT_CANDIDATE_ROOTS = ['logs', 'shared/materials'];

function shouldSearchRuntime(question, pageContext, { force = false } = {}) {
  if (force) return true;
  if (pageContext && typeof pageContext === 'object') {
    if (pageContext.page_url || (Array.isArray(pageContext.ui_elements) && pageContext.ui_elements.length)) {
      return true;
    }
  }
  const text = String(question || '');
  return /运行|日志|这次|当次|job|session|trace|导出|产物|候选|失败|报错|改写结果|AiJob|ReviewSession|deploy|log/i.test(text);
}

function normalizeCandidateRoots(runtime) {
  const roots = Array.isArray(runtime && runtime.candidateRoots) && runtime.candidateRoots.length
    ? runtime.candidateRoots
    : DEFAULT_CANDIDATE_ROOTS;
  return roots.map((value) => String(value).replace(/\\/g, '/').replace(/^\/+/, '')).filter(Boolean);
}

function parseRunCandidatesSection(stdout) {
  const raw = String(stdout || '');
  const start = raw.indexOf('BEGIN_RUN_CANDIDATES');
  const end = raw.indexOf('END_RUN_CANDIDATES');
  if (start < 0 || end < 0 || end <= start) return [];
  const body = raw.slice(start + 'BEGIN_RUN_CANDIDATES'.length, end).trim();
  const candidates = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('|');
    if (parts.length < 4) continue;
    const [mtimeSec, sizeBytes, root, relPath] = parts;
    candidates.push({
      root,
      path: relPath,
      mtimeSec: Number(mtimeSec) || null,
      sizeBytes: Number(sizeBytes) || null,
    });
  }
  return candidates;
}

function classifyCandidates(candidates) {
  if (!candidates.length) {
    return {
      status: 'none',
      detail: 'no runtime candidate files found under configured roots',
      action: 'report_missing',
    };
  }
  if (candidates.length === 1) {
    return {
      status: 'single',
      detail: 'exactly one candidate; still confirm before treating as the run',
      action: 'confirm_then_use',
    };
  }
  return {
    status: 'multiple',
    detail: `${candidates.length} candidates; list them and ask which run/file to use; do not merge`,
    action: 'disambiguate',
  };
}

function formatRuntimeSearch(runtimeSearch) {
  if (!runtimeSearch) return '';
  if (runtimeSearch.status === 'skipped') {
    return `运行候选搜索：skipped — ${runtimeSearch.detail || ''}\n`;
  }
  if (runtimeSearch.status === 'error') {
    return `运行候选搜索：error — ${runtimeSearch.error || runtimeSearch.detail || ''}\n`;
  }
  if (runtimeSearch.status === 'not_applicable') {
    return `运行候选搜索：not_applicable — ${runtimeSearch.detail || ''}\n`;
  }
  const lines = [
    '运行候选搜索（只列候选，禁止把多次运行拼成一次）：',
    `- 状态：${runtimeSearch.classification && runtimeSearch.classification.status}`,
    `- 说明：${runtimeSearch.classification && runtimeSearch.classification.detail}`,
    `- 搜索根：${(runtimeSearch.roots || []).join(', ') || 'n/a'}`,
    `- 候选数：${(runtimeSearch.candidates || []).length}`,
  ];
  (runtimeSearch.candidates || []).slice(0, 12).forEach((item, index) => {
    const when = item.mtimeSec ? new Date(item.mtimeSec * 1000).toISOString() : 'unknown-time';
    lines.push(`  ${index + 1}. ${item.path} (root=${item.root}, mtime=${when}, size=${item.sizeBytes || 0})`);
  });
  if ((runtimeSearch.candidates || []).length > 12) {
    lines.push(`  … 另有 ${(runtimeSearch.candidates.length - 12)} 条未列出`);
  }
  lines.push('若 status=multiple：必须先请专家确认唯一候选，不得混合阅读不同运行材料当作同一证据。');
  lines.push('若 status=none：明确报告缺运行材料，不要编造 run_id。');
  return `${lines.join('\n')}\n`;
}

function searchRunCandidates(config, {
  runSshOpFn,
  auditPath,
  question = '',
  pageContext = null,
  force = false,
} = {}) {
  const runtime = config.runtime || { mode: 'none' };
  if (runtime.mode !== 'ssh') {
    return {
      status: 'not_applicable',
      mode: runtime.mode || 'none',
      detail: 'runtime candidate search requires runtime.mode=ssh',
      candidates: [],
    };
  }
  if (!shouldSearchRuntime(question, pageContext, { force })) {
    return {
      status: 'skipped',
      mode: 'ssh',
      detail: 'question/page context did not look runtime-related; skipped to avoid extra SSH',
      candidates: [],
    };
  }
  const roots = normalizeCandidateRoots(runtime);
  try {
    const result = runSshOpFn(runtime, {
      op: 'run-candidates',
      args: { roots },
      auditPath,
    });
    const candidates = parseRunCandidatesSection(result.stdout);
    const classification = classifyCandidates(candidates);
    return {
      status: 'observed',
      mode: 'ssh',
      host: runtime.host,
      root: runtime.root,
      roots,
      candidates,
      classification,
      ms: result.ms,
      load1: result.beforeHealth && result.beforeHealth.load1,
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      mode: 'ssh',
      host: runtime.host,
      root: runtime.root,
      roots,
      candidates: [],
      error: error.message,
      detail: error.message,
    };
  }
}

module.exports = {
  DEFAULT_CANDIDATE_ROOTS,
  shouldSearchRuntime,
  normalizeCandidateRoots,
  parseRunCandidatesSection,
  classifyCandidates,
  formatRuntimeSearch,
  searchRunCandidates,
};
