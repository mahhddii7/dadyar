import "server-only";

import type { SourceFile } from "../storage/types";

export interface RetrievedEvidence {
  id: string;
  sourceId: string;
  file: string;
  sectionNumber: number;
  rowNumber?: number;
  sheet?: string;
  excerpt: string;
  score: number;
}

interface Chunk {
  source: SourceFile;
  sectionNumber: number;
  text: string;
  tokens: string[];
  frequencies: Map<string, number>;
}

const STOP_WORDS = new Set([
  "از", "به", "در", "با", "برای", "که", "را", "و", "یا", "این", "آن", "یک", "چه", "چی", "کدام", "چطور", "چگونه",
  "است", "هست", "بود", "شد", "شود", "کن", "کنند", "می", "های", "ها", "اگر", "هم", "تا", "روی", "درباره", "لطفا", "لطفاً",
]);

function normalize(value: string) {
  return value.normalize("NFKC")
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .replace(/[\u200c\u0640]/g, "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .toLowerCase();
}

function tokenize(value: string) {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function splitIntoChunks(source: SourceFile): Chunk[] {
  const paragraphs = (source.text ?? "").split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let sectionNumber = 0;

  for (const paragraph of paragraphs) {
    let start = 0;
    while (start < paragraph.length) {
      let end = Math.min(start + 1_200, paragraph.length);
      if (end < paragraph.length) {
        const boundary = paragraph.lastIndexOf(" ", end);
        if (boundary > start + 700) end = boundary;
      }
      const text = paragraph.slice(start, end).trim();
      const terms = tokenize(text);
      if (terms.length) {
        sectionNumber += 1;
        const frequencies = new Map<string, number>();
        for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
        chunks.push({ source, sectionNumber, text, tokens: terms, frequencies });
      }
      if (end >= paragraph.length) break;
      start = Math.max(start + 1, end - 160);
    }
  }
  return chunks;
}

export function retrieveDocumentEvidence(question: string, sources: SourceFile[], limit = 8): RetrievedEvidence[] {
  const queryTokens = expandTableQueryTokens([...new Set(tokenize(question))]);
  if (!queryTokens.length) return [];

  const chunks = sources.filter((source) => source.kind === "document" && source.text).flatMap(splitIntoChunks);
  if (!chunks.length) return [];

  const documentFrequency = new Map<string, number>();
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.tokens.length;
    for (const token of new Set(chunk.tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const averageLength = totalLength / chunks.length || 1;
  const k1 = 1.2;
  const b = 0.75;
  const normalizedQuestion = normalize(question).trim();

  const ranked = chunks.map((chunk) => {
    let score = 0;
    let matchedTerms = 0;
    for (const term of queryTokens) {
      const exactFrequency = chunk.frequencies.get(term) ?? 0;
      const termFrequency = exactFrequency || (term.length >= 4
        ? [...chunk.frequencies].reduce((sum, [token, frequency]) => sum + (token.startsWith(term) || term.startsWith(token) && token.length >= 4 ? frequency : 0), 0)
        : 0);
      if (!termFrequency) continue;
      matchedTerms += 1;
      const documentCount = documentFrequency.get(term) ?? 0;
      const inverseFrequency = Math.log(1 + (chunks.length - documentCount + 0.5) / (documentCount + 0.5));
      score += inverseFrequency * (termFrequency * (k1 + 1)) / (termFrequency + k1 * (1 - b + b * chunk.tokens.length / averageLength));
    }
    const normalizedText = normalize(chunk.text);
    const exactPhrase = normalizedQuestion.length >= 8 && normalizedText.includes(normalizedQuestion);
    if (exactPhrase) score += 2;
    return { chunk, score, matchedTerms, exactPhrase };
  }).filter((item) => item.score > 0 && (item.exactPhrase || item.matchedTerms >= (queryTokens.length >= 7 ? 3 : queryTokens.length >= 4 ? 2 : 1)))
    .sort((a, bScore) => bScore.score - a.score || a.chunk.source.name.localeCompare(bScore.chunk.source.name));

  const selected: RetrievedEvidence[] = [];
  const perSource = new Map<string, number>();
  const seen = new Set<string>();
  for (const item of ranked) {
    const sourceId = item.chunk.source.id;
    const count = perSource.get(sourceId) ?? 0;
    const fingerprint = normalize(item.chunk.text).slice(0, 300);
    if (count >= 3 || seen.has(`${sourceId}:${fingerprint}`)) continue;
    perSource.set(sourceId, count + 1);
    seen.add(`${sourceId}:${fingerprint}`);
    selected.push({
      id: `E${selected.length + 1}`,
      sourceId,
      file: item.chunk.source.name,
      sectionNumber: item.chunk.sectionNumber,
      excerpt: item.chunk.text.slice(0, 1_200),
      score: Number(item.score.toFixed(3)),
    });
    if (selected.length >= limit) break;
  }
  return selected;
}

const TABLE_STOP_WORDS = new Set([
  ...STOP_WORDS,
  "من", "میخوام", "میخواهم", "بده", "بدهم", "بدم", "کنم", "کنیم", "شود", "بشه", "بشود", "ترتیب", "همه", "همگی", "رو", "پس", "کدوم", "داشته", "باشن", "باشند",
]);

function tableTokens(value: string) {
  return normalize(value.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !TABLE_STOP_WORDS.has(token));
}

function tableCellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return ""; }
  }
  return String(value);
}

function expandTableQueryTokens(tokens: string[]) {
  const synonyms: Record<string, string[]> = {
    "ساختمان": ["building", "بنا"],
    "طبقه": ["floor", "level"],
    "واحد": ["unit", "office"],
    "سیت": ["seat", "صندلی", "ظرفیت"],
    "صندلی": ["seat", "سیت"],
    "ظرفیت": ["capacity", "seat", "سیت"],
  };
  return [...new Set(tokens.flatMap((token) => {
    const base = token.replace(/(?:های|ها|ان)$/u, "");
    return [token, ...(base && base !== token ? [base] : []), ...(synonyms[token] ?? synonyms[base] ?? [])];
  }))];
}

function tokenMatches(queryToken: string, rowToken: string) {
  return queryToken === rowToken || (queryToken.length >= 4 && rowToken.length >= 4 && (queryToken.startsWith(rowToken) || rowToken.startsWith(queryToken)));
}

export function retrieveTableEvidence(question: string, sources: SourceFile[], limit = 40) {
  const queryTokens = expandTableQueryTokens(tableTokens(question));
  const totalRows = sources.reduce((sum, source) => sum + (source.rows?.length ?? 0), 0);
  if (!queryTokens.length) return { evidence: [] as RetrievedEvidence[], totalRows, candidateRows: 0 };

  const ranked: Array<{ source: SourceFile; row: NonNullable<SourceFile["rows"]>[number]; score: number }> = [];
  for (const source of sources.filter((item) => item.kind === "table")) {
    const columns = (source.columns ?? []).filter((column) => !column.startsWith("__")).slice(0, 80);
    const columnTokens = [...new Set(columns.flatMap(tableTokens))];
    for (const row of source.rows ?? []) {
      const valueText = columns.map((column) => tableCellText(row[column]).slice(0, 400)).join(" ");
      const valueTokens = new Set(tableTokens(valueText));
      let score = 0;
      let matchedTerms = 0;
      for (const queryToken of queryTokens) {
        const valueMatch = [...valueTokens].some((token) => tokenMatches(queryToken, token));
        const columnMatch = columnTokens.some((token) => tokenMatches(queryToken, token));
        if (valueMatch || columnMatch) {
          matchedTerms += 1;
          score += (valueMatch ? 1 : 0) + (columnMatch ? 1.5 : 0);
        }
      }
      if (matchedTerms) ranked.push({ source, row, score: score * (matchedTerms / queryTokens.length) });
    }
  }

  ranked.sort((a, b) => b.score - a.score || Number(a.row.__row ?? 0) - Number(b.row.__row ?? 0));
  const evidence = ranked.slice(0, Math.min(Math.max(limit, 1), 60)).map(({ source, row, score }, index) => {
    const excerpt = (source.columns ?? []).filter((column) => !column.startsWith("__")).slice(0, 40)
      .map((column) => `${column}: ${tableCellText(row[column]) || "—"}`)
      .join(" | ")
      .slice(0, 1_200);
    return {
      id: `E${index + 1}`,
      sourceId: source.id,
      file: source.name,
      sectionNumber: Number(row.__row ?? 0),
      rowNumber: Number(row.__row ?? 0),
      ...(row.__sheet ? { sheet: String(row.__sheet) } : {}),
      excerpt,
      score: Number(score.toFixed(3)),
    };
  });
  return { evidence, totalRows, candidateRows: ranked.length };
}
