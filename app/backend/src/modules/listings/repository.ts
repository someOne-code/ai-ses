import {
  and,
  desc,
  eq,
  gte,
  lte,
  notInArray,
  or,
  sql,
  type SQL
} from "drizzle-orm";

import type { Database } from "../../db/client.js";
import {
  LISTING_SEARCH_EMBEDDING_DIMENSION,
  LISTING_SEARCH_TSVECTOR_CONFIG,
  listingSearchDocuments,
  listings
} from "../../db/schema/index.js";
import type {
  ListingByReferenceParams,
  ListingSearchDocumentRefreshParams,
  ListingSearchRetrievalControls,
  SearchAnchorTerm,
  SearchNegatedTerm,
  SearchListingsFilters,
  ListingSearchMatchInterpretation,
  ListingSearchMatchSource
} from "./types.js";

const MAIN_LISTING_SEARCH_DOCUMENT_TYPE = "main" as const;
const MAX_VECTOR_ACCEPTANCE_COSINE_DISTANCE = 0.42;
const VECTOR_CANDIDATE_POOL_MIN = 10;
const VECTOR_CANDIDATE_POOL_MULTIPLIER = 3;
const HYBRID_RRF_K = 50;
const REFERENCE_CODE_NORMALIZATION_SOURCE =
  "\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00c2\u00ce\u00db -_./!";
const REFERENCE_CODE_NORMALIZATION_TARGET = "CGIOSUAIU";
const SEARCH_NORMALIZATION_SOURCE = "çğıöşüâîû";
const SEARCH_NORMALIZATION_TARGET = "cgiosuaiu";
const SEARCH_ANCHOR_ALIAS_SETS = {
  metro: [
    "metro",
    "metrobus",
    "metrobüs",
    "marmaray",
    "tramvay"
  ],
  avm: ["avm", "alisveris merkezi", "alışveriş merkezi", "alisveris", "mall"],
  otoyol: ["otoyol", "otoban", "e5", "e-5", "tem"],
  marmaray: ["marmaray"],
  tramvay: ["tramvay"],
  park: ["park"],
  deniz: ["deniz", "sahil", "kiyi", "kıyı"]
} as const satisfies Record<string, readonly string[]>;
const SPOKEN_REFERENCE_DIGIT_MAP = new Map<string, string>([
  ["SIFIR", "0"],
  ["BIR", "1"],
  ["IKI", "2"],
  ["UC", "3"],
  ["DORT", "4"],
  ["BES", "5"],
  ["ALTI", "6"],
  ["YEDI", "7"],
  ["SEKIZ", "8"],
  ["DOKUZ", "9"]
]);
const SPOKEN_REFERENCE_TENS_MAP = new Map<string, number>([
  ["ON", 10],
  ["YIRMI", 20],
  ["OTUZ", 30],
  ["KIRK", 40],
  ["ELLI", 50],
  ["ALTMIS", 60],
  ["YETMIS", 70],
  ["SEKSEN", 80],
  ["DOKSAN", 90]
]);
const SPOKEN_REFERENCE_SCALE_MAP = new Map<string, number>([
  ["YUZ", 100],
  ["BIN", 1_000],
  ["MILYON", 1_000_000]
]);

const listingSearchSelection = {
  id: listings.id,
  referenceCode: listings.referenceCode,
  title: listings.title,
  description: listings.description,
  listingType: listings.listingType,
  propertyType: listings.propertyType,
  price: listings.price,
  currency: listings.currency,
  bedrooms: listings.bedrooms,
  bathrooms: listings.bathrooms,
  netM2: listings.netM2,
  buildingAge: listings.buildingAge,
  dues: listings.dues,
  hasBalcony: listings.hasBalcony,
  hasParking: listings.hasParking,
  hasElevator: listings.hasElevator,
  district: listings.district,
  neighborhood: listings.neighborhood,
  status: listings.status,
  createdAt: listings.createdAt
};

interface ListingSearchSelectionRow {
  id: string;
  referenceCode: string;
  title: string;
  description: string | null;
  listingType: string | null;
  propertyType: string | null;
  price: string | null;
  currency: string;
  bedrooms: string | null;
  bathrooms: string | null;
  netM2: string | null;
  buildingAge: string | null;
  dues: string | null;
  hasBalcony: boolean | null;
  hasParking: boolean | null;
  hasElevator: boolean | null;
  district: string | null;
  neighborhood: string | null;
  status: string;
  createdAt: Date;
}

interface HybridVectorCandidate extends ListingSearchSelectionRow {
  cosineDistance: number;
}

interface ListingSearchCandidate extends ListingSearchSelectionRow {
  matchSource: ListingSearchMatchSource;
  approximate: boolean;
  cosineDistance: number | null;
}

interface SearchIntentHints {
  requiredAnchors: string[];
}

interface NormalizedListingSearchRetrievalControls {
  mustAnchorTerms: SearchAnchorTerm[];
  negatedTerms: SearchNegatedTerm[];
  viewedListingIds: string[];
}

const listingDetailSelection = {
  id: listings.id,
  referenceCode: listings.referenceCode,
  title: listings.title,
  description: listings.description,
  propertyType: listings.propertyType,
  listingType: listings.listingType,
  status: listings.status,
  price: listings.price,
  currency: listings.currency,
  bedrooms: listings.bedrooms,
  bathrooms: listings.bathrooms,
  netM2: listings.netM2,
  grossM2: listings.grossM2,
  floorNumber: listings.floorNumber,
  buildingAge: listings.buildingAge,
  dues: listings.dues,
  district: listings.district,
  neighborhood: listings.neighborhood,
  addressText: listings.addressText,
  hasBalcony: listings.hasBalcony,
  hasParking: listings.hasParking,
  hasElevator: listings.hasElevator
};

export function canonicalizeListingReferenceCode(value: string): string {
  const tokens = tokenizeListingReferenceCode(value);
  const parts: string[] = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index]!;

    if (!isSpokenReferenceNumberToken(token)) {
      parts.push(token);
      index += 1;
      continue;
    }

    let boundary = index + 1;

    while (
      boundary < tokens.length &&
      isSpokenReferenceNumberToken(tokens[boundary]!)
    ) {
      boundary += 1;
    }

    const numericTokens = tokens.slice(index, boundary);
    parts.push(
      parseSpokenReferenceNumericTokens(numericTokens) ??
        numericTokens.join("")
    );
    index = boundary;
  }

  return parts.join("");
}

function tokenizeListingReferenceCode(value: string): string[] {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/\u00c7/g, "C")
    .replace(/\u011e/g, "G")
    .replace(/\u0130/g, "I")
    .replace(/\u00d6/g, "O")
    .replace(/\u015e/g, "S")
    .replace(/\u00dc/g, "U")
    .replace(/\u00c2/g, "A")
    .replace(/\u00ce/g, "I")
    .replace(/\u00db/g, "U");

  return normalized
    .split(/[^A-Z0-9]+/g)
    .filter((part) => part !== "");
}

function isSpokenReferenceNumberToken(token: string): boolean {
  return (
    /^\d+$/.test(token) ||
    SPOKEN_REFERENCE_DIGIT_MAP.has(token) ||
    SPOKEN_REFERENCE_TENS_MAP.has(token) ||
    SPOKEN_REFERENCE_SCALE_MAP.has(token)
  );
}

function collapseSegmentedNumericTokens(tokens: string[]): string[] {
  const collapsed: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const nextToken = tokens[index + 1];

    if (
      /^\d{2}$/.test(token) &&
      nextToken !== undefined &&
      /^\d{2}$/.test(nextToken)
    ) {
      const currentValue = Number(token);
      const nextValue = Number(nextToken);

      if (
        currentValue % 10 === 0 &&
        nextValue >= currentValue &&
        nextValue < currentValue + 10
      ) {
        continue;
      }
    }

    collapsed.push(token);
  }

  return collapsed;
}

function parseSpokenReferenceNumericTokens(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null;
  }

  if (tokens.every((token) => /^\d+$/.test(token))) {
    return collapseSegmentedNumericTokens(tokens).join("");
  }

  if (tokens.some((token) => SPOKEN_REFERENCE_SCALE_MAP.has(token))) {
    return parseSpokenReferenceCardinal(tokens);
  }

  const parts: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (/^\d+$/.test(token)) {
      parts.push(token);
      continue;
    }

    const digit = SPOKEN_REFERENCE_DIGIT_MAP.get(token);

    if (digit !== undefined) {
      parts.push(digit);
      continue;
    }

    const tens = SPOKEN_REFERENCE_TENS_MAP.get(token);

    if (tens === undefined) {
      return null;
    }

    const nextToken = tokens[index + 1];
    const nextDigit =
      nextToken === undefined
        ? undefined
        : SPOKEN_REFERENCE_DIGIT_MAP.get(nextToken);

    if (nextDigit !== undefined) {
      parts.push(String(tens + Number(nextDigit)));
      index += 1;
      continue;
    }

    parts.push(String(tens));
  }

  return parts.join("");
}

function parseSpokenReferenceCardinal(tokens: string[]): string | null {
  let total = 0;
  let current = 0;
  let sawNumericToken = false;

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      current += Number(token);
      sawNumericToken = true;
      continue;
    }

    const digit = SPOKEN_REFERENCE_DIGIT_MAP.get(token);

    if (digit !== undefined) {
      current += Number(digit);
      sawNumericToken = true;
      continue;
    }

    const tens = SPOKEN_REFERENCE_TENS_MAP.get(token);

    if (tens !== undefined) {
      current += tens;
      sawNumericToken = true;
      continue;
    }

    const scale = SPOKEN_REFERENCE_SCALE_MAP.get(token);

    if (scale === undefined) {
      return null;
    }

    if (scale === 100) {
      current = (current === 0 ? 1 : current) * scale;
      sawNumericToken = true;
      continue;
    }

    total += (current === 0 ? 1 : current) * scale;
    current = 0;
    sawNumericToken = true;
  }

  return sawNumericToken ? String(total + current) : null;
}

function numericReferenceSuffix(value: string): string | null {
  const digitsOnly = value.replace(/\D/g, "");

  return digitsOnly === "" ? null : digitsOnly;
}

function buildReferenceLookupPlan(value: string) {
  const tokens = tokenizeListingReferenceCode(value);
  const transcriptPreserved = tokens.join("");
  const canonicalized = canonicalizeListingReferenceCode(value);
  const suffixFallbackAllowed =
    tokens.length > 0 &&
    tokens.every((token) => isSpokenReferenceNumberToken(token));
  const exactCandidates = [...new Set([transcriptPreserved, canonicalized])]
    .filter((candidate) => candidate !== "");

  return {
    exactCandidates,
    numericSuffix:
      suffixFallbackAllowed
        ? numericReferenceSuffix(canonicalized) ??
          numericReferenceSuffix(transcriptPreserved)
        : null
  };
}

function normalizedReferenceCodeValue(
  column: SQL | typeof listings.referenceCode
) {
  return sql<string>`regexp_replace(translate(upper(${column}), ${REFERENCE_CODE_NORMALIZATION_SOURCE}, ${REFERENCE_CODE_NORMALIZATION_TARGET}), '[^A-Z0-9]+', '', 'g')`;
}

function normalizedTextEquals(
  column: SQL | typeof listings.district | typeof listings.neighborhood,
  value: string
) {
  return sql`translate(lower(${column}), ${SEARCH_NORMALIZATION_SOURCE}, ${SEARCH_NORMALIZATION_TARGET}) = translate(lower(${value}), ${SEARCH_NORMALIZATION_SOURCE}, ${SEARCH_NORMALIZATION_TARGET})`;
}

function buildStructuredConditions(
  filters: SearchListingsFilters,
  viewedListingIds?: string[]
): SQL[] {
  const conditions: SQL[] = [
    eq(listings.officeId, filters.officeId),
    eq(listings.status, "active")
  ];

  if (viewedListingIds && viewedListingIds.length > 0) {
    conditions.push(notInArray(listings.id, viewedListingIds));
  }

  if (filters.district) {
    conditions.push(normalizedTextEquals(listings.district, filters.district));
  }

  if (filters.neighborhood) {
    conditions.push(
      normalizedTextEquals(listings.neighborhood, filters.neighborhood)
    );
  }

  if (filters.listingType) {
    conditions.push(eq(listings.listingType, filters.listingType));
  }

  if (filters.propertyType) {
    conditions.push(eq(listings.propertyType, filters.propertyType));
  }

  if (filters.minPrice !== undefined) {
    conditions.push(gte(listings.price, String(filters.minPrice)));
  }

  if (filters.maxPrice !== undefined) {
    conditions.push(lte(listings.price, String(filters.maxPrice)));
  }

  if (filters.minBedrooms !== undefined) {
    conditions.push(gte(listings.bedrooms, String(filters.minBedrooms)));
  }

  if (filters.minBathrooms !== undefined) {
    conditions.push(gte(listings.bathrooms, String(filters.minBathrooms)));
  }

  if (filters.minNetM2 !== undefined) {
    conditions.push(gte(listings.netM2, String(filters.minNetM2)));
  }

  if (filters.maxNetM2 !== undefined) {
    conditions.push(lte(listings.netM2, String(filters.maxNetM2)));
  }

  return conditions;
}

function buildRetrievalControls(
  input?: ListingSearchRetrievalControls
): NormalizedListingSearchRetrievalControls {
  return {
    mustAnchorTerms: input?.mustAnchorTerms ?? [],
    negatedTerms: input?.negatedTerms ?? [],
    viewedListingIds: input?.viewedListingIds ?? []
  };
}

function dedupeAnchorCanonicalTerms(
  input: Array<SearchAnchorTerm | SearchNegatedTerm>
): string[] {
  const canonicals = new Set<string>();

  for (const term of input) {
    const canonical = normalizeSearchText(term.canonical);

    if (canonical !== "") {
      canonicals.add(canonical);
    }
  }

  return [...canonicals];
}

function resolveAnchorAliases(canonical: string): string[] {
  const aliasSet = SEARCH_ANCHOR_ALIAS_SETS[canonical as keyof typeof SEARCH_ANCHOR_ALIAS_SETS];

  if (!aliasSet) {
    return [canonical];
  }

  return [...new Set(aliasSet.map((alias) => alias.trim()).filter((alias) => alias !== ""))];
}

function toAnchorTsqueryClause(alias: string): string | null {
  const tokens = alias
    .toLowerCase()
    .replace(/[':&|!()<>]/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token !== "");

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}:*`).join(" <-> ");
}

function buildAnchorTsqueryText(aliases: string[]): string | null {
  const clauses = aliases
    .map((alias) => toAnchorTsqueryClause(alias))
    .filter((clause): clause is string => clause !== null);

  if (clauses.length === 0) {
    return null;
  }

  return clauses.join(" | ");
}

function buildAnchorContentMatchCondition(aliases: string[]): SQL {
  const queryText = buildAnchorTsqueryText(aliases);

  if (!queryText) {
    return sql`false`;
  }

  const tsQuery = sql`to_tsquery(${LISTING_SEARCH_TSVECTOR_CONFIG}, ${queryText})`;

  return sql`${listingSearchDocuments.contentTsv} @@ ${tsQuery}`;
}

function buildDocumentRetrievalConditions(input: {
  officeId: string;
  retrievalControls: NormalizedListingSearchRetrievalControls;
}): SQL[] {
  const conditions: SQL[] = [
    eq(listingSearchDocuments.officeId, input.officeId),
    eq(listingSearchDocuments.documentType, MAIN_LISTING_SEARCH_DOCUMENT_TYPE)
  ];
  const positiveCanonicals = dedupeAnchorCanonicalTerms(
    input.retrievalControls.mustAnchorTerms
  );
  const negativeCanonicals = dedupeAnchorCanonicalTerms(
    input.retrievalControls.negatedTerms
  );

  for (const canonical of positiveCanonicals) {
    const aliases = resolveAnchorAliases(canonical);

    if (aliases.length === 0) {
      continue;
    }

    conditions.push(buildAnchorContentMatchCondition(aliases));
  }

  for (const canonical of negativeCanonicals) {
    const aliases = resolveAnchorAliases(canonical);

    if (aliases.length === 0) {
      continue;
    }

    conditions.push(sql`not (${buildAnchorContentMatchCondition(aliases)})`);
  }

  return conditions;
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (character) => {
      const index = SEARCH_NORMALIZATION_SOURCE.indexOf(character);
      return index >= 0 ? SEARCH_NORMALIZATION_TARGET[index]! : character;
    })
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function analyzeSearchIntent(queryText: string): SearchIntentHints {
  const normalized = normalizeSearchText(queryText);
  const tokens = normalized.split(/\s+/g).filter((token) => token !== "");
  const anchors = new Set<string>();
  const patternTokens = new Set([
    "yakin",
    "uygun",
    "icin",
    "gore",
    "gibi",
    "bana",
    "ev",
    "evi",
    "daire",
    "konut",
    "olan",
    "var",
    "mi",
    "mı",
    "mu",
    "mü"
  ]);

  for (const token of tokens) {
    if (token === "yakin" || token === "uygun") {
      continue;
    }

    if (normalized.includes(`${token} yakin`) || normalized.includes(`${token} uygun`)) {
      const anchor = token
        .replace(/(ye|ya|e|a|de|da|te|ta)$/u, "")
        .trim();

      if (anchor !== "" && !patternTokens.has(anchor)) {
        anchors.add(anchor);
      }
    }
  }

  return {
    requiredAnchors: [...anchors]
  };
}

function buildCandidateSearchText(candidate: ListingSearchSelectionRow): string {
  return normalizeSearchText(
    [
      candidate.title,
      candidate.description,
      candidate.district,
      candidate.neighborhood
    ]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(" ")
  );
}

function candidateSupportsIntent(
  candidate: ListingSearchSelectionRow,
  lexicalRank: number | null,
  hints: SearchIntentHints
): boolean {
  if (hints.requiredAnchors.length === 0) {
    return true;
  }

  if (lexicalRank !== null) {
    return true;
  }

  const candidateText = buildCandidateSearchText(candidate);
  const anchorAliases = new Map<string, string[]>([
    ["aile", ["aile", "family"]],
    ["metro", ["metro", "metrobus"]]
  ]);

  return hints.requiredAnchors.some((anchor) => {
    const aliases = anchorAliases.get(anchor) ?? [anchor];
    return aliases.some((alias) => candidateText.includes(alias));
  });
}

export function createListingsRepository(db: Database) {
  function toStructuredCandidate(
    listing: ListingSearchSelectionRow
  ): ListingSearchCandidate {
    return {
      ...listing,
      matchSource: "structured",
      approximate: false,
      cosineDistance: null
    };
  }

  function toLexicalCandidate(
    listing: ListingSearchSelectionRow
  ): ListingSearchSelectionRow {
    return listing;
  }

  function buildVectorCandidateLimit(limit: number): number {
    return Math.max(limit * VECTOR_CANDIDATE_POOL_MULTIPLIER, VECTOR_CANDIDATE_POOL_MIN);
  }

  async function searchStructured(
    conditions: SQL[],
    limit: number
  ): Promise<ListingSearchCandidate[]> {
    const rows = await db
      .select(listingSearchSelection)
      .from(listings)
      .where(and(...conditions))
      .orderBy(desc(listings.createdAt))
      .limit(limit);

    return rows.map((row) => toStructuredCandidate(row as ListingSearchSelectionRow));
  }

  async function searchLexical(
    conditions: SQL[],
    documentConditions: SQL[],
    filters: SearchListingsFilters
  ): Promise<ListingSearchSelectionRow[]> {
    const tsQuery = sql`websearch_to_tsquery(${LISTING_SEARCH_TSVECTOR_CONFIG}, ${filters.queryText ?? ""})`;
    const lexicalRank = sql<number>`ts_rank_cd(${listingSearchDocuments.contentTsv}, ${tsQuery})`;

    const rows = await db
      .select(listingSearchSelection)
      .from(listingSearchDocuments)
      .innerJoin(listings, eq(listingSearchDocuments.listingId, listings.id))
      .where(
        and(
          ...conditions,
          ...documentConditions,
          sql`${listingSearchDocuments.contentTsv} @@ ${tsQuery}`
        )
      )
      .orderBy(desc(lexicalRank), desc(listings.createdAt))
      .limit(filters.limit);

    return rows.map((row) => toLexicalCandidate(row as ListingSearchSelectionRow));
  }

  async function searchVector(
    conditions: SQL[],
    documentConditions: SQL[],
    filters: SearchListingsFilters,
    queryEmbedding: number[]
  ): Promise<HybridVectorCandidate[]> {
    const queryEmbeddingVector = sql`${JSON.stringify(queryEmbedding)}::vector(${sql.raw(
      String(LISTING_SEARCH_EMBEDDING_DIMENSION)
    )})`;
    const cosineDistance = sql<number>`${listingSearchDocuments.embedding} <=> ${queryEmbeddingVector}`;
    const vectorCandidateLimit = buildVectorCandidateLimit(filters.limit);

    const rows = await db
      .select({
        ...listingSearchSelection,
        cosineDistance
      })
      .from(listingSearchDocuments)
      .innerJoin(listings, eq(listingSearchDocuments.listingId, listings.id))
      .where(
        and(
          ...conditions,
          ...documentConditions,
          sql`${listingSearchDocuments.embedding} is not null`
        )
      )
      .orderBy(cosineDistance, desc(listings.createdAt))
      .limit(vectorCandidateLimit);

    return rows.map((row) => ({
      ...(row as ListingSearchSelectionRow),
      cosineDistance: Number(row.cosineDistance)
    }));
  }

  function mergeHybridCandidates<
    TResult extends ListingSearchSelectionRow
  >(
    lexicalResults: TResult[],
    vectorResults: Array<TResult & { cosineDistance: number }>,
    queryText: string,
    limit: number
  ): ListingSearchCandidate[] {
    const intentHints = analyzeSearchIntent(queryText);
    const merged = new Map<
      string,
      {
        candidate: TResult;
        lexicalRank: number | null;
        vectorRank: number | null;
        bestCosineDistance: number | null;
        rrfScore: number;
      }
    >();

    for (const [index, candidate] of lexicalResults.entries()) {
      const existing = merged.get(candidate.id);
      const rank = index + 1;

      merged.set(candidate.id, {
        candidate: existing?.candidate ?? candidate,
        lexicalRank: rank,
        vectorRank: existing?.vectorRank ?? null,
        bestCosineDistance: existing?.bestCosineDistance ?? null,
        rrfScore: (existing?.rrfScore ?? 0) + 1 / (HYBRID_RRF_K + rank)
      });
    }

    for (const [index, candidate] of vectorResults.entries()) {
      const existing = merged.get(candidate.id);
      const rank = index + 1;

      merged.set(candidate.id, {
        candidate: existing?.candidate ?? candidate,
        lexicalRank: existing?.lexicalRank ?? null,
        vectorRank: rank,
        bestCosineDistance:
          existing?.bestCosineDistance === null ||
          existing?.bestCosineDistance === undefined
            ? candidate.cosineDistance
            : Math.min(existing.bestCosineDistance, candidate.cosineDistance),
        rrfScore: (existing?.rrfScore ?? 0) + 1 / (HYBRID_RRF_K + rank)
      });
    }

    const toMatchSource = (
      lexicalRank: number | null,
      vectorRank: number | null
    ): ListingSearchMatchSource => {
      if (lexicalRank !== null && vectorRank !== null) {
        return "hybrid";
      }

      if (lexicalRank !== null) {
        return "lexical";
      }

      return "vector";
    };

    return [...merged.values()]
      .sort((left, right) => {
        if (right.rrfScore !== left.rrfScore) {
          return right.rrfScore - left.rrfScore;
        }

        const leftBestRank = Math.min(
          left.lexicalRank ?? Number.POSITIVE_INFINITY,
          left.vectorRank ?? Number.POSITIVE_INFINITY
        );
        const rightBestRank = Math.min(
          right.lexicalRank ?? Number.POSITIVE_INFINITY,
          right.vectorRank ?? Number.POSITIVE_INFINITY
        );

        if (leftBestRank !== rightBestRank) {
          return leftBestRank - rightBestRank;
        }

        return (
          right.candidate.createdAt.getTime() - left.candidate.createdAt.getTime()
        );
      })
      .filter((entry) => {
        if (entry.lexicalRank !== null) {
          return candidateSupportsIntent(
            entry.candidate,
            entry.lexicalRank,
            intentHints
          );
        }

        return (
          candidateSupportsIntent(entry.candidate, entry.lexicalRank, intentHints) &&
          entry.bestCosineDistance !== null &&
          entry.bestCosineDistance <= MAX_VECTOR_ACCEPTANCE_COSINE_DISTANCE
        );
      })
      .map((entry) => ({
        ...entry.candidate,
        matchSource: toMatchSource(entry.lexicalRank, entry.vectorRank),
        approximate: true,
        cosineDistance: entry.bestCosineDistance
      }))
      .slice(0, limit);
  }

  function buildSearchResult(input: {
    listings: ListingSearchCandidate[];
    matchInterpretation: ListingSearchMatchInterpretation;
  }) {
    return input;
  }

  return {
    async search(
      filters: SearchListingsFilters,
      options?: {
        queryEmbedding?: number[];
        retrievalControls?: ListingSearchRetrievalControls;
      }
    ) {
      const retrievalControls = buildRetrievalControls(options?.retrievalControls);
      const conditions = buildStructuredConditions(
        filters,
        retrievalControls.viewedListingIds
      );

      if (filters.searchMode === "hybrid" && filters.queryText) {
        const documentConditions = buildDocumentRetrievalConditions({
          officeId: filters.officeId,
          retrievalControls
        });
        const lexicalResults = await searchLexical(
          conditions,
          documentConditions,
          filters
        );
        const vectorResults =
          options?.queryEmbedding && options.queryEmbedding.length > 0
            ? await searchVector(
                conditions,
                documentConditions,
                filters,
                options.queryEmbedding
              )
            : [];
        const hybridResults = mergeHybridCandidates(
          lexicalResults,
          vectorResults,
          filters.queryText,
          filters.limit
        );

        if (hybridResults.length > 0) {
          return buildSearchResult({
            listings: hybridResults,
            matchInterpretation: "hybrid_candidate"
          });
        }

        return buildSearchResult({
          listings: [],
          matchInterpretation: "no_match"
        });
      }

      return buildSearchResult({
        listings: await searchStructured(conditions, filters.limit),
        matchInterpretation: "verified_structured_match"
      });
    },

    async findByReference(params: ListingByReferenceParams) {
      const [exactMatch] = await db
        .select({
          ...listingDetailSelection
        })
        .from(listings)
        .where(
          and(
            eq(listings.officeId, params.officeId),
            eq(listings.referenceCode, params.referenceCode),
            eq(listings.status, "active")
          )
        )
        .limit(1);

      if (exactMatch) {
        return {
          kind: "found" as const,
          listing: exactMatch
        };
      }

      const lookupPlan = buildReferenceLookupPlan(params.referenceCode);

      if (lookupPlan.exactCandidates.length === 0) {
        return { kind: "not_found" as const };
      }

      for (const exactCandidate of lookupPlan.exactCandidates) {
        const normalizedMatches = await db
          .select({
            ...listingDetailSelection
          })
          .from(listings)
          .where(
            and(
              eq(listings.officeId, params.officeId),
              eq(listings.status, "active"),
              sql`${normalizedReferenceCodeValue(listings.referenceCode)} = ${exactCandidate}`
            )
          )
          .limit(2);

        if (normalizedMatches.length > 1) {
          return { kind: "ambiguous" as const };
        }

        if (normalizedMatches.length === 1) {
          return {
            kind: "found" as const,
            listing: normalizedMatches[0]!
          };
        }
      }

      if (lookupPlan.numericSuffix === null) {
        return { kind: "not_found" as const };
      }

      const suffixMatches = await db
        .select({
          ...listingDetailSelection
        })
        .from(listings)
        .where(
          and(
            eq(listings.officeId, params.officeId),
            eq(listings.status, "active"),
            sql`${normalizedReferenceCodeValue(listings.referenceCode)} like ${`%${lookupPlan.numericSuffix}`}`
          )
        )
        .limit(2);

      if (suffixMatches.length === 0) {
        return { kind: "not_found" as const };
      }

      if (suffixMatches.length > 1) {
        return { kind: "ambiguous" as const };
      }

      return {
        kind: "found" as const,
        listing: suffixMatches[0]!
      };
    },

    async findActiveById(params: ListingSearchDocumentRefreshParams) {
      const [listing] = await db
        .select({
          id: listings.id
        })
        .from(listings)
        .where(
          and(
            eq(listings.id, params.listingId),
            eq(listings.officeId, params.officeId),
            eq(listings.status, "active")
          )
        )
        .limit(1);

      return listing ?? null;
    }
  };
}

export type ListingsRepository = ReturnType<typeof createListingsRepository>;
