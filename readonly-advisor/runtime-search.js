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
  if (runtimeSearch.snippetSkipped) {
    lines.push(`- 未自动读取日志正文：${runtimeSearch.snippetSkipped}`);
  }
  if (Array.isArray(runtimeSearch.snippets) && runtimeSearch.snippets.length) {
    lines.push('- 已读取的候选片段（仅单一候选时；仍可能不是专家要的那次运行）：');
    runtimeSearch.snippets.forEach((snip) => {
      lines.push(`  ### ${snip.path}`);
      lines.push(String(snip.text || '').trim().slice(0, 4000));
    });
  }
  if (runtimeSearch.snippetError) {
    lines.push(`- 片段读取失败：${runtimeSearch.snippetError}`);
  }
  lines.push('若 status=multiple：必须先请专家确认唯一候选，不得读取或混合不同运行材料。');
  lines.push('若 status=none：明确报告缺运行材料，不要编造 run_id。');
  lines.push('若 status=single：仍应口头确认后再深入；默认仅附带名片，单一候选时可附短 head。');
  return `${lines.join('\n')}\n`;
}

function toJailRelPath(absOrRel, root) {
  const value = String(absOrRel || '');
  const normalizedRoot = String(root || '').replace(/\/$/, '');
  if (!value) return null;
  if (!value.startsWith('/')) return value.replace(/^\/+/, '');
  if (value === normalizedRoot) return '.';
  if (value.startsWith(`${normalizedRoot}/`)) return value.slice(normalizedRoot.length + 1);
  return null;
}

function attachNewestLogSnippet(runtimeSearch, {
  runtime,
  runSshOpFn,
  auditPath,
  lines = 40,
  force = false,
} = {}) {
  if (!runtimeSearch || runtimeSearch.status !== 'observed') return runtimeSearch;
  const classification = runtimeSearch.classification || classifyCandidates(runtimeSearch.candidates || []);
  // Never auto-read log bodies when multiple/none — only a single candidate (or force) may attach a snippet.
  if (!force && classification.status !== 'single') {
    return {
      ...runtimeSearch,
      classification,
      snippets: [],
      snippetSkipped: `classification=${classification.status}; list candidates only`,
    };
  }
  const log = (runtimeSearch.candidates || []).find((item) => /\.log$/i.test(item.path || ''));
  if (!log) return { ...runtimeSearch, classification };
  const rel = toJailRelPath(log.path, runtime.root);
  if (!rel) {
    return { ...runtimeSearch, classification, snippetError: `cannot map path into jail: ${log.path}` };
  }
  try {
    const result = runSshOpFn(runtime, {
      op: 'head',
      args: { path: rel, lines },
      auditPath,
    });
    return {
      ...runtimeSearch,
      classification,
      snippets: [{
        path: log.path,
        rel,
        text: String(result.stdout || '').slice(0, 4000),
        ms: result.ms,
      }],
    };
  } catch (error) {
    return { ...runtimeSearch, classification, snippetError: error.message };
  }
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
    let payload = {
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
    payload = attachNewestLogSnippet(payload, {
      runtime,
      runSshOpFn,
      auditPath,
    });
    return payload;
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
  attachNewestLogSnippet,
  toJailRelPath,
};
