import { canonicalJuliusBrainJson, juliusBrainSha256, type JuliusBrainBody } from './julius-brain-contracts';
import { juliusBrainReadable, type JuliusBrainReadGrant } from './julius-brain-policy';
import type { JuliusBrainEntityState } from './julius-brain-projection';
import { renderJuliusBrainEntity } from './julius-brain-query';

/**
 * SEMANTIC RETRIEVAL: A FUZZY MODULE THAT MUST EARN ITS PLACE.
 *
 * Structured retrieval (`julius-brain-query.ts`) is the default and stays the
 * default: when the state a worker needs has a known type and scope, it is
 * fetched by type and scope. Fuzzy retrieval exists for the other case — a
 * free-text question whose answer's type nobody knows ("what did we conclude
 * about isolation?") — and only as the lowest context tier.
 *
 * So it has a TYPED INTERFACE, a BASELINE, CANDIDATES and an EVAL that measures
 * MARGINAL VALUE over the baseline on labelled queries. `decideJuliusBrainRetriever`
 * adopts a candidate only when it beats the baseline by a declared margin on
 * MRR without losing recall; otherwise the baseline stands. No provider, no
 * embedding service, no network: every retriever here is deterministic, so an
 * eval result is reproducible from its inputs' hashes.
 */

export interface JuliusBrainRetrievalHit { readonly entityId: string; readonly score: number }

export interface JuliusBrainRetriever {
  readonly retrieverId: string;
  readonly version: string;
  rank(input: { readonly query: string; readonly candidates: readonly JuliusBrainEntityState[]; readonly limit: number }): readonly JuliusBrainRetrievalHit[];
}

/* -------------------------------------------------------------- tokenising */

const STOPWORDS = new Set(('a an and are as at be by did do does for from has have how in is it its of on or that the this to was we were what when where which who why will with about into than then there these those our you your')
  .split(' '));

/** A deliberately small suffix stripper: enough to meet "regressed" and "regression", nothing clever. */
export function stemJuliusToken(token: string): string {
  let word = token;
  for (const suffix of ['ational', 'ization', 'ations', 'ation', 'ness', 'ment', 'ions', 'ion', 'ings', 'ing', 'ies', 'ied', 'ers', 'er', 'ed', 'es', 'ly', 's']) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      word = word.slice(0, word.length - suffix.length);
      break;
    }
  }
  return word;
}

export function tokenizeJuliusText(text: string, stem = true): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !STOPWORDS.has(token)).map((token) => (stem ? stemJuliusToken(token) : token));
}

/** The text a retriever indexes: the entity's rendering without its id noise. */
export const juliusBrainRetrievalText = (state: JuliusBrainEntityState): string =>
  renderJuliusBrainEntity(state).replace(/^\[[^\]]*\]\s*/, `${state.kind.toLowerCase().replace(/_/g, ' ')} `);

const sortHits = (hits: JuliusBrainRetrievalHit[], limit: number): JuliusBrainRetrievalHit[] =>
  hits.filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0))
    .slice(0, limit);

/* ---------------------------------------------------------------- baseline */

/** BASELINE: exact (unstemmed) token overlap, normalised by query length. */
export function createJuliusBrainKeywordRetriever(): JuliusBrainRetriever {
  return {
    retrieverId: 'keyword-overlap', version: '1',
    rank({ query, candidates, limit }) {
      const terms = new Set(tokenizeJuliusText(query, false));
      if (terms.size === 0) return [];
      return sortHits(candidates.map((state) => {
        const tokens = new Set(tokenizeJuliusText(juliusBrainRetrievalText(state), false));
        let overlap = 0;
        for (const term of terms) if (tokens.has(term)) overlap += 1;
        return { entityId: state.entityId, score: overlap / terms.size };
      }), limit);
    },
  };
}

/* -------------------------------------------------------------- candidates */

/** CANDIDATE: Okapi BM25 over stemmed tokens. */
export function createJuliusBrainBm25Retriever(options: { readonly k1?: number; readonly b?: number } = {}): JuliusBrainRetriever {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  return {
    retrieverId: 'bm25-stemmed', version: '1',
    rank({ query, candidates, limit }) {
      const docs = candidates.map((state) => ({ id: state.entityId, tokens: tokenizeJuliusText(juliusBrainRetrievalText(state)) }));
      const terms = [...new Set(tokenizeJuliusText(query))];
      if (terms.length === 0 || docs.length === 0) return [];
      const average = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length || 1;
      const frequency = new Map<string, number>();
      for (const doc of docs) for (const term of new Set(doc.tokens)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
      return sortHits(docs.map((doc) => {
        let score = 0;
        for (const term of terms) {
          const tf = doc.tokens.filter((token) => token === term).length;
          if (tf === 0) continue;
          const df = frequency.get(term) ?? 0;
          const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.tokens.length) / average)));
        }
        return { entityId: doc.id, score };
      }), limit);
    },
  };
}

const trigrams = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of tokenizeJuliusText(text, false)) {
    const padded = ` ${token} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      const gram = padded.slice(i, i + 3);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return counts;
};

/** CANDIDATE: character-trigram TF-IDF cosine — robust to morphology the stemmer misses. */
export function createJuliusBrainTrigramRetriever(): JuliusBrainRetriever {
  return {
    retrieverId: 'trigram-tfidf', version: '1',
    rank({ query, candidates, limit }) {
      const docs = candidates.map((state) => ({ id: state.entityId, grams: trigrams(juliusBrainRetrievalText(state)) }));
      const q = trigrams(query);
      if (q.size === 0 || docs.length === 0) return [];
      const df = new Map<string, number>();
      for (const doc of docs) for (const gram of doc.grams.keys()) df.set(gram, (df.get(gram) ?? 0) + 1);
      const idf = (gram: string) => Math.log((1 + docs.length) / (1 + (df.get(gram) ?? 0))) + 1;
      const weigh = (grams: Map<string, number>) => {
        const vector = new Map<string, number>();
        let norm = 0;
        for (const [gram, count] of grams) { const weight = count * idf(gram); vector.set(gram, weight); norm += weight * weight; }
        return { vector, norm: Math.sqrt(norm) || 1 };
      };
      const query_ = weigh(q);
      return sortHits(docs.map((doc) => {
        const weighted = weigh(doc.grams);
        let dot = 0;
        for (const [gram, weight] of query_.vector) dot += weight * (weighted.vector.get(gram) ?? 0);
        return { entityId: doc.id, score: dot / (query_.norm * weighted.norm) };
      }), limit);
    },
  };
}

/** CANDIDATE: reciprocal-rank fusion of the other two. */
export function createJuliusBrainHybridRetriever(parts: readonly JuliusBrainRetriever[] = [createJuliusBrainBm25Retriever(), createJuliusBrainTrigramRetriever()]): JuliusBrainRetriever {
  return {
    retrieverId: `rrf(${parts.map((part) => part.retrieverId).join('+')})`, version: '1',
    rank({ query, candidates, limit }) {
      const fused = new Map<string, number>();
      for (const part of parts) {
        part.rank({ query, candidates, limit: candidates.length }).forEach((hit, index) => fused.set(hit.entityId, (fused.get(hit.entityId) ?? 0) + 1 / (60 + index + 1)));
      }
      return sortHits([...fused].map(([entityId, score]) => ({ entityId, score })), limit);
    },
  };
}

/** The candidates a fuzzy tier may consider: readable, live, in the mission. */
export function juliusBrainSemanticCandidates(input: {
  readonly retriever: JuliusBrainRetriever;
  readonly query: string;
  readonly entities: readonly JuliusBrainEntityState[];
  readonly grant: JuliusBrainReadGrant;
  readonly missionId: string;
  readonly limit: number;
}): readonly string[] {
  const candidates = input.entities.filter((state) => state.lifecycle === 'ACTIVE'
    && (state.scope.missionId === null || state.scope.missionId === input.missionId)
    && !['TRACE', 'CHECKPOINT', 'PYTHON_EXECUTION'].includes(state.kind)
    && juliusBrainReadable({ grant: input.grant, kind: state.kind, scope: state.scope, sensitivity: state.sensitivity }));
  return input.retriever.rank({ query: input.query, candidates, limit: input.limit }).map((hit) => hit.entityId);
}

/* -------------------------------------------------------------------- eval */

export interface JuliusBrainRetrievalQuery {
  readonly queryId: string;
  readonly query: string;
  /** Entity ids a correct retriever returns. At least one. */
  readonly relevant: readonly string[];
}

export interface JuliusBrainRetrieverScore {
  readonly retrieverId: string;
  readonly version: string;
  readonly recallAtK: number;
  readonly mrr: number;
  readonly ndcgAtK: number;
  readonly perQuery: readonly { readonly queryId: string; readonly firstRelevantRank: number | null; readonly recall: number }[];
}

export interface JuliusBrainRetrievalEval {
  readonly format: 'julius-brain-retrieval-eval.v1';
  readonly k: number;
  readonly corpusHash: string;
  readonly queriesHash: string;
  readonly baseline: JuliusBrainRetrieverScore;
  readonly candidates: readonly (JuliusBrainRetrieverScore & { readonly marginal: { readonly recallAtK: number; readonly mrr: number; readonly ndcgAtK: number } })[];
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

function score(retriever: JuliusBrainRetriever, corpus: readonly JuliusBrainEntityState[], queries: readonly JuliusBrainRetrievalQuery[], k: number): JuliusBrainRetrieverScore {
  const perQuery = queries.map((item) => {
    const ranked = retriever.rank({ query: item.query, candidates: corpus, limit: k }).map((hit) => hit.entityId);
    const relevant = new Set(item.relevant);
    const hits = ranked.filter((id) => relevant.has(id)).length;
    const first = ranked.findIndex((id) => relevant.has(id));
    const dcg = ranked.reduce((sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
    const ideal = [...Array(Math.min(relevant.size, k)).keys()].reduce((sum, index) => sum + 1 / Math.log2(index + 2), 0);
    return { queryId: item.queryId, firstRelevantRank: first < 0 ? null : first + 1, recall: hits / relevant.size, ndcg: ideal === 0 ? 0 : dcg / ideal };
  });
  const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
  return {
    retrieverId: retriever.retrieverId, version: retriever.version,
    recallAtK: round(mean(perQuery.map((row) => row.recall))),
    mrr: round(mean(perQuery.map((row) => (row.firstRelevantRank === null ? 0 : 1 / row.firstRelevantRank)))),
    ndcgAtK: round(mean(perQuery.map((row) => row.ndcg))),
    perQuery: perQuery.map(({ queryId, firstRelevantRank, recall }) => ({ queryId, firstRelevantRank, recall: round(recall) })),
  };
}

export function evaluateJuliusBrainRetrievers(input: {
  readonly corpus: readonly JuliusBrainEntityState[];
  readonly queries: readonly JuliusBrainRetrievalQuery[];
  readonly baseline: JuliusBrainRetriever;
  readonly candidates: readonly JuliusBrainRetriever[];
  readonly k: number;
}): JuliusBrainRetrievalEval {
  if (input.queries.length === 0 || input.queries.some((item) => item.relevant.length === 0)) throw new Error('julius_brain_retrieval_eval_needs_labelled_queries');
  const known = new Set(input.corpus.map((state) => state.entityId));
  for (const item of input.queries) for (const id of item.relevant) if (!known.has(id)) throw new Error(`julius_brain_retrieval_eval_unknown_relevant:${id}`);
  const baseline = score(input.baseline, input.corpus, input.queries, input.k);
  return {
    format: 'julius-brain-retrieval-eval.v1', k: input.k,
    corpusHash: juliusBrainSha256(canonicalJuliusBrainJson(input.corpus.map((state) => [state.entityId, state.version]).sort())),
    queriesHash: juliusBrainSha256(canonicalJuliusBrainJson(input.queries)),
    baseline,
    candidates: input.candidates.map((retriever) => {
      const candidate = score(retriever, input.corpus, input.queries, input.k);
      return { ...candidate, marginal: { recallAtK: round(candidate.recallAtK - baseline.recallAtK), mrr: round(candidate.mrr - baseline.mrr), ndcgAtK: round(candidate.ndcgAtK - baseline.ndcgAtK) } };
    }),
  };
}

export interface JuliusBrainRetrieverDecision {
  readonly adopted: string;
  readonly reason: string;
}

/**
 * ADOPT ONLY MEASURED VALUE. The best candidate by MRR is adopted if its MRR
 * gain meets `minimumMrrGain` and it loses no recall; otherwise the baseline.
 */
export function decideJuliusBrainRetriever(result: JuliusBrainRetrievalEval, minimumMrrGain = 0.05): JuliusBrainRetrieverDecision {
  const best = [...result.candidates].sort((a, b) => b.mrr - a.mrr || b.recallAtK - a.recallAtK)[0];
  if (best === undefined) return { adopted: result.baseline.retrieverId, reason: 'no candidate was evaluated' };
  if (best.marginal.mrr < minimumMrrGain) return { adopted: result.baseline.retrieverId, reason: `best candidate ${best.retrieverId} gains ${best.marginal.mrr} MRR, below the ${minimumMrrGain} bar` };
  if (best.marginal.recallAtK < 0) return { adopted: result.baseline.retrieverId, reason: `best candidate ${best.retrieverId} loses ${-best.marginal.recallAtK} recall@${result.k}` };
  return { adopted: best.retrieverId, reason: `+${best.marginal.mrr} MRR, ${best.marginal.recallAtK >= 0 ? '+' : ''}${best.marginal.recallAtK} recall@${result.k} over ${result.baseline.retrieverId}` };
}

/** The eval as a Brain EVAL body, so the decision to use a fuzzy module is itself evidence. */
export function juliusBrainRetrievalEvalBody(result: JuliusBrainRetrievalEval, decision: JuliusBrainRetrieverDecision, evaluator: string): JuliusBrainBody {
  const metrics = [result.baseline, ...result.candidates].flatMap((row) => [
    { name: `${row.retrieverId}.recall@${result.k}`, value: row.recallAtK, unit: null },
    { name: `${row.retrieverId}.mrr`, value: row.mrr, unit: null },
    { name: `${row.retrieverId}.ndcg@${result.k}`, value: row.ndcgAtK, unit: null },
  ]);
  return {
    evaluationName: 'brain-semantic-retrieval',
    target: { targetKind: 'OTHER', reference: `retriever:${decision.adopted}` },
    inputs: [{ name: 'corpus', reference: 'brain-entities', contentHash: result.corpusHash }, { name: 'queries', reference: 'labelled-queries', contentHash: result.queriesHash }],
    outcome: decision.adopted === result.baseline.retrieverId ? 'INCONCLUSIVE' : 'PASS',
    score: null, maxScore: null,
    metrics,
    evaluator,
    reproducibility: { seed: null, codeHash: null, inputsHash: juliusBrainSha256(`${result.corpusHash}\n${result.queriesHash}`), environmentHash: null, commit: null, command: null, environmentRunId: null },
  };
}
