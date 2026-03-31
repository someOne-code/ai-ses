import {
  and,
  desc,
  eq,
  gte,
  lte,
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
  SearchListingsFilters,
  ListingSearchMatchInterpretation
} from "./types.js";

const MAIN_LISTING_SEARCH_DOCUMENT_TYPE = "main" as const;
const MAX_VECTOR_COSINE_DISTANCE = 0.3;
const HYBRID_RRF_K = 50;
const REFERENCE_CODE_NORMALIZATION_SOURCE =
  "\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00c2\u00ce\u00db -_./!";
const REFERENCE_CODE_NORMALIZATION_TARGET = "CGIOSUAIU";
const SEARCH_NORMALIZATION_SOURCE = "çğıöşüâîû";
const SEARCH_NORMALIZATION_TARGET = "cgiosuaiu";
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
  listingType: listings.listingType,
  propertyType: listings.propertyType,
  price: listings.price,
  currency: listings.currency,
  bedrooms: listings.bedrooms,
  bathrooms: listings.bathrooms,
  netM2: listings.netM2,
  district: listings.district,
  neighborhood: listings.neighborhood,
  status: listings.status,
  createdAt: listings.createdAt
};

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
  const exactCandidates = [...new Set([transcriptPreserved, canonicalized])]
    .filter((candidate) => candidate !== "");

  return {
    exactCandidates,
    numericSuffix:
      numericReferenceSuffix(canonicalized) ??
      numericReferenceSuffix(transcriptPreserved)
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

function buildStructuredConditions(filters: SearchListingsFilters): SQL[] {
  const conditions: SQL[] = [
    eq(listings.officeId, filters.officeId),
    eq(listings.status, "active")
  ];

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

export function createListingsRepository(db: Database) {
  async function searchStructured(
    conditions: SQL[],
    limit: number
  ) {
    return db
      .select(listingSearchSelection)
      .from(listings)
      .where(and(...conditions))
      .orderBy(desc(listings.createdAt))
      .limit(limit);
  }

  async function searchLexical(
    conditions: SQL[],
    filters: SearchListingsFilters
  ) {
    const tsQuery = sql`websearch_to_tsquery(${LISTING_SEARCH_TSVECTOR_CONFIG}, ${filters.queryText ?? ""})`;
    const lexicalRank = sql<number>`ts_rank_cd(${listingSearchDocuments.contentTsv}, ${tsQuery})`;

    return db
      .select(listingSearchSelection)
      .from(listingSearchDocuments)
      .innerJoin(listings, eq(listingSearchDocuments.listingId, listings.id))
      .where(
        and(
          ...conditions,
          eq(listingSearchDocuments.officeId, filters.officeId),
          eq(
            listingSearchDocuments.documentType,
            MAIN_LISTING_SEARCH_DOCUMENT_TYPE
          ),
          sql`${listingSearchDocuments.contentTsv} @@ ${tsQuery}`
        )
      )
      .orderBy(desc(lexicalRank), desc(listings.createdAt))
      .limit(filters.limit);
  }

  async function searchVector(
    conditions: SQL[],
    filters: SearchListingsFilters,
    queryEmbedding: number[]
  ) {
    const queryEmbeddingVector = sql`${JSON.stringify(queryEmbedding)}::vector(${sql.raw(
      String(LISTING_SEARCH_EMBEDDING_DIMENSION)
    )})`;
    const cosineDistance = sql<number>`${listingSearchDocuments.embedding} <=> ${queryEmbeddingVector}`;

    return db
      .select(listingSearchSelection)
      .from(listingSearchDocuments)
      .innerJoin(listings, eq(listingSearchDocuments.listingId, listings.id))
      .where(
        and(
          ...conditions,
          eq(listingSearchDocuments.officeId, filters.officeId),
          eq(
            listingSearchDocuments.documentType,
            MAIN_LISTING_SEARCH_DOCUMENT_TYPE
          ),
          sql`${listingSearchDocuments.embedding} is not null`,
          sql`${cosineDistance} <= ${MAX_VECTOR_COSINE_DISTANCE}`
        )
      )
      .orderBy(cosineDistance, desc(listings.createdAt))
      .limit(filters.limit);
  }

  function mergeHybridCandidates<
    TResult extends {
      id: string;
      createdAt: Date;
    }
  >(
    lexicalResults: TResult[],
    vectorResults: TResult[],
    limit: number
  ) {
    const merged = new Map<
      string,
      {
        candidate: TResult;
        lexicalRank: number | null;
        vectorRank: number | null;
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
        rrfScore: (existing?.rrfScore ?? 0) + 1 / (HYBRID_RRF_K + rank)
      });
    }

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
      .map((entry) => entry.candidate)
      .slice(0, limit);
  }

  function buildSearchResult<TResult>(input: {
    listings: TResult[];
    matchInterpretation: ListingSearchMatchInterpretation;
  }) {
    return input;
  }

  return {
    async search(
      filters: SearchListingsFilters,
      options?: {
        queryEmbedding?: number[];
      }
    ) {
      const conditions = buildStructuredConditions(filters);

      if (filters.searchMode === "hybrid" && filters.queryText) {
        const lexicalResults = await searchLexical(conditions, filters);
        const vectorResults =
          options?.queryEmbedding && options.queryEmbedding.length > 0
            ? await searchVector(conditions, filters, options.queryEmbedding)
            : [];
        const hybridResults = mergeHybridCandidates(
          lexicalResults,
          vectorResults,
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
