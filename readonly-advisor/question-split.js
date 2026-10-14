'use strict';

/**
 * Detect multi-theme expert questions and split into single-theme atoms.
 * Heuristic only — no LLM call.
 */

const TOPIC_HINTS = [
  { id: 'outline-source', re: /投标施组|正文分别|目录以及正文|兜底模板|chapter\.generate|bid-outline|outline-agent/i },
  { id: 'parse-limit', re: /DOCUMENT_RESOURCE_LIMIT|页数过多|上限|maxMedia|解析技术规格|docx 失败/i },
  { id: 'rewrite-ying', re: /适应带宽|确保适|改写记录|ying-tail|假合词|历史AI/i },
  { id: 'deploy-version', re: /部署|release|current|是否与之一致|mismatched/i },
  { id: 'runtime-log', re: /运行日志|这次运行|运行候选|AiJob|trace/i },
];

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function topicIdsFor(text) {
  return TOPIC_HINTS.filter((t) => t.re.test(text)).map((t) => t.id);
}

/**
 * Split on explicit numbered question markers.
 * Supports: "1." "1、" "1)" "（1）" "问题 1" "Q1："
 */
function splitNumberedBlocks(text) {
  const raw = normalizeNewlines(text);
  const markerRe = /(?:^|\n)[ \t]*(?:(?:问题|Q)[ \t]*)?(\d{1,2})[ \t]*[\.．、:：\)][ \t]+/g;
  const hits = [];
  let match;
  while ((match = markerRe.exec(raw))) {
    const full = match[0];
    const leadingNl = full.startsWith('\n') ? 1 : 0;
    hits.push({
      n: Number(match[1]),
      markerStart: match.index + leadingNl,
      contentStart: match.index + full.length,
    });
  }
  if (hits.length < 2) return null;
  if (hits[0].n > 2) return null;

  const preamble = raw.slice(0, hits[0].markerStart).trim();
  const parts = [];
  for (let i = 0; i < hits.length; i += 1) {
    const end = i + 1 < hits.length ? hits[i + 1].markerStart : raw.length;
    const body = raw.slice(hits[i].contentStart, end).trim();
    if (body) parts.push({ index: hits[i].n, text: body });
  }
  return parts.length >= 2 ? { preamble, parts } : null;
}

function sharedConstraintsFromPreamble(preamble) {
  const lines = [];
  if (/严格区分|代码事实|部署|运行材料/.test(preamble)) {
    lines.push('请严格区分代码事实与部署/运行材料事实；若有多个运行候选先列出再选用。');
  }
  if (/无法验证|未知|证据来源/.test(preamble)) {
    lines.push('对每个结论标注证据来源；无法验证的明确写未知。');
  }
  return lines.join('');
}

function distinctPrimaryTopics(parts) {
  const primaries = parts.map((p) => {
    const topics = topicIdsFor(p.text);
    return topics[0] || `part-${p.index}`;
  });
  return new Set(primaries).size;
}

/**
 * @returns {{
 *   multiTheme: boolean,
 *   reason: string,
 *   preamble: string,
 *   unsplittable?: boolean,
 *   parts: Array<{ index: number, text: string, topics: string[] }>,
 * }}
 */
function analyzeQuestionThemes(question) {
  const raw = normalizeNewlines(question);
  if (!raw) {
    return { multiTheme: false, reason: 'empty', preamble: '', parts: [] };
  }

  const numbered = splitNumberedBlocks(raw);
  if (numbered) {
    const constraint = sharedConstraintsFromPreamble(numbered.preamble);
    const parts = numbered.parts.map((p) => {
      const topics = topicIdsFor(p.text);
      return {
        index: p.index,
        topics,
        text: constraint ? `${constraint}\n\n${p.text}` : p.text,
      };
    });
    const topicCount = distinctPrimaryTopics(parts);
    // Numbered 2+ questions from an expert batch → always treat as multi-theme sessions.
    // Same-topic multi-part still benefits from separate evidence budgets.
    const multiTheme = parts.length >= 2;
    return {
      multiTheme,
      reason: multiTheme
        ? `numbered-list:${parts.length}-parts,primary-topics:${topicCount}`
        : 'numbered-single',
      preamble: numbered.preamble,
      parts,
    };
  }

  // Fallback: multiple blank-separated question-like paragraphs with different topics
  const chunks = raw.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const questionLike = chunks.filter((c) => /[?？]/.test(c) || /^(请|定位|解释|为什么|是否|哪里|哪个)/.test(c));
  if (questionLike.length >= 2) {
    const parts = questionLike.map((text, i) => ({
      index: i + 1,
      text,
      topics: topicIdsFor(text),
    }));
    const topicCount = distinctPrimaryTopics(parts);
    if (topicCount >= 2) {
      return {
        multiTheme: true,
        reason: `blank-blocks:${parts.length},primary-topics:${topicCount}`,
        preamble: '',
        parts,
      };
    }
  }

  const topics = topicIdsFor(raw);
  const qmarks = (raw.match(/[?？]/g) || []).length;
  if (topics.length >= 3 && qmarks >= 2) {
    return {
      multiTheme: true,
      unsplittable: true,
      reason: `dense-topics:${topics.join(',')},qmarks:${qmarks}`,
      preamble: '',
      parts: [{ index: 1, text: raw, topics }],
    };
  }

  return {
    multiTheme: false,
    reason: 'single-theme-or-unstructured',
    preamble: '',
    parts: [{ index: 1, text: raw, topics }],
  };
}

function formatSplitPlan(analysis) {
  if (!analysis.multiTheme) {
    return `主题分析：单主题（${analysis.reason}）。保持同一会话。\n`;
  }
  if (analysis.unsplittable) {
    return `主题分析：疑似多主题但无法可靠切分（${analysis.reason}）。建议专家改成逐条提问。\n`;
  }
  const lines = [
    `主题分析：多主题 — ${analysis.reason}`,
    `将拆成 ${analysis.parts.length} 个独立会话：`,
  ];
  analysis.parts.forEach((p) => {
    const preview = p.text.replace(/\n/g, ' ').slice(0, 120);
    lines.push(`  ${p.index}. topics=[${(p.topics || []).join('|') || 'general'}] ${preview}`);
  });
  return `${lines.join('\n')}\n`;
}

module.exports = {
  TOPIC_HINTS,
  analyzeQuestionThemes,
  formatSplitPlan,
  splitNumberedBlocks,
  topicIdsFor,
};
