import type {
  DecomposedListingSearchPlan,
  ListingSearchRouterState,
  SearchAnchorTerm,
  SearchIntentMode,
  SearchListingsFilters,
  SearchNegatedTerm,
  StructuredSearchCriteria
} from "./types.js";

const TURKISH_NORMALIZATION_TABLE: Array<[RegExp, string]> = [
  [/\u00e7/g, "c"],
  [/\u011f/g, "g"],
  [/\u0131/g, "i"],
  [/\u00f6/g, "o"],
  [/\u015f/g, "s"],
  [/\u00fc/g, "u"],
  [/\u00e2/g, "a"],
  [/\u00ee/g, "i"],
  [/\u00fb/g, "u"]
];

const FILLER_TOKENS = new Set([
  "bana",
  "bir",
  "ev",
  "evi",
  "daire",
  "konut",
  "olan",
  "var",
  "mi",
  "m",
  "icin",
  "gore",
  "gibi",
  "de",
  "da"
]);

const PROXIMITY_CUES = [
  "yakin",
  "dibi",
  "dibinde",
  "yani",
  "yaninda",
  "hemen",
  "civar",
  "civarinda",
  "etraf",
  "etrafinda"
] as const;

const NEGATION_CUES = [
  "istemiyorum",
  "istemem",
  "olmasin",
  "olmasinlar",
  "uzak",
  "haric",
  "haricinde",
  "disinda",
  "istemiyoruz"
] as const;

const NEXT_PAGE_PATTERNS = [
  /\bbaska var mi\b/,
  /\bdigerleri\b/,
  /\bsiradaki\b/,
  /\bbaska secenek\b/
] as const;

const RESET_PATTERNS = [
  /\bvazgectim\b/,
  /\bonun yerine\b/,
  /\bbunu bosver\b/,
  /\bbu olmadi\b/,
  /\byeniden bakalim\b/
] as const;

function normalizeSearchText(value: string): string {
  let normalized = value.trim().toLowerCase().normalize("NFD");

  for (const [pattern, replacement] of TURKISH_NORMALIZATION_TABLE) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toStructuredCriteria(
  filters: SearchListingsFilters
): StructuredSearchCriteria {
  return {
    district: filters.district,
    neighborhood: filters.neighborhood,
    listingType: filters.listingType,
    propertyType: filters.propertyType,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minBedrooms: filters.minBedrooms,
    minBathrooms: filters.minBathrooms,
    minNetM2: filters.minNetM2,
    maxNetM2: filters.maxNetM2
  };
}

function canonicalAnchorFromToken(token: string): string | null {
  if (token.startsWith("metro") || token.startsWith("metrobus")) {
    return "metro";
  }

  if (token.startsWith("avm") || token.startsWith("alisveris") || token === "mall") {
    return "avm";
  }

  if (
    token.startsWith("otoyol") ||
    token.startsWith("otoban") ||
    token === "e5" ||
    token === "tem"
  ) {
    return "otoyol";
  }

  if (token.startsWith("marmaray")) {
    return "marmaray";
  }

  if (token.startsWith("tramvay")) {
    return "tramvay";
  }

  if (token.startsWith("park")) {
    return "park";
  }

  if (token.startsWith("deniz") || token.startsWith("sahil") || token.startsWith("kiyi")) {
    return "deniz";
  }

  return null;
}

function hasAnyCue(tokens: string[], cues: readonly string[]): boolean {
  return tokens.some((token) => cues.some((cue) => token.includes(cue)));
}

function dedupeAnchorTerms(
  terms: Array<SearchAnchorTerm | SearchNegatedTerm>
): Array<SearchAnchorTerm | SearchNegatedTerm> {
  const seen = new Set<string>();
  const deduped: Array<SearchAnchorTerm | SearchNegatedTerm> = [];

  for (const term of terms) {
    if (seen.has(term.canonical)) {
      continue;
    }

    seen.add(term.canonical);
    deduped.push(term);
  }

  return deduped;
}

function extractAnchors(input: {
  originalText: string;
  normalizedText: string;
}): {
  mustAnchorTerms: SearchAnchorTerm[];
  negatedTerms: SearchNegatedTerm[];
  strippedSemanticTokens: string[];
} {
  const tokens = input.normalizedText.split(" ").filter((token) => token !== "");
  const mustAnchorTerms: SearchAnchorTerm[] = [];
  const negatedTerms: SearchNegatedTerm[] = [];
  const strippedSemanticTokens = [...tokens];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const canonical = canonicalAnchorFromToken(token);

    if (!canonical) {
      continue;
    }

    const windowStart = Math.max(0, index - 3);
    const windowEnd = Math.min(tokens.length, index + 4);
    const contextWindow = tokens.slice(windowStart, windowEnd);
    const isNegated = hasAnyCue(contextWindow, NEGATION_CUES);
    const hasProximityCue = hasAnyCue(contextWindow, PROXIMITY_CUES);

    if (isNegated) {
      negatedTerms.push({ canonical, raw: token });
      strippedSemanticTokens[index] = "";
      continue;
    }

    if (hasProximityCue) {
      mustAnchorTerms.push({ canonical, raw: token });
      strippedSemanticTokens[index] = "";
      continue;
    }
  }

  const dedupedAnchors = dedupeAnchorTerms(mustAnchorTerms) as SearchAnchorTerm[];
  const dedupedNegated = dedupeAnchorTerms(negatedTerms) as SearchNegatedTerm[];

  return {
    mustAnchorTerms: dedupedAnchors,
    negatedTerms: dedupedNegated,
    strippedSemanticTokens
  };
}

function extractSemanticIntent(tokens: string[]): string | null {
  const normalized = tokens
    .map((token) => token.trim())
    .filter(
      (token) =>
        token !== "" &&
        !FILLER_TOKENS.has(token) &&
        !PROXIMITY_CUES.some((cue) => token.includes(cue)) &&
        !NEGATION_CUES.some((cue) => token.includes(cue))
    )
    .join(" ")
    .trim();

  return normalized === "" ? null : normalized;
}

function isNextPageQuery(normalizedText: string): boolean {
  return NEXT_PAGE_PATTERNS.some((pattern) => pattern.test(normalizedText));
}

function hasResetCue(normalizedText: string): boolean {
  return RESET_PATTERNS.some((pattern) => pattern.test(normalizedText));
}

function classifyIntentMode(input: {
  normalizedText: string;
  state: ListingSearchRouterState;
  hasSemanticIntent: boolean;
}): SearchIntentMode {
  if (isNextPageQuery(input.normalizedText)) {
    return "next_page";
  }

  if (hasResetCue(input.normalizedText)) {
    return "new_search";
  }

  if (input.state.lastSearchOutcome === "no_match" && input.hasSemanticIntent) {
    return "replace_failed_free_text";
  }

  return input.state.hasActiveSearch ? "refine_search" : "new_search";
}

export function decomposeListingSearchPlan(
  filters: SearchListingsFilters,
  state?: ListingSearchRouterState
): DecomposedListingSearchPlan {
  const queryText = filters.queryText?.trim() ?? null;
  const normalizedText = queryText ? normalizeSearchText(queryText) : "";
  const structuredFilters = toStructuredCriteria(filters);
  const effectiveState: ListingSearchRouterState = {
    hasActiveSearch: state?.hasActiveSearch ?? false,
    lastSearchOutcome: state?.lastSearchOutcome ?? "none"
  };

  const {
    mustAnchorTerms,
    negatedTerms,
    strippedSemanticTokens
  } = queryText
    ? extractAnchors({
        originalText: queryText,
        normalizedText
      })
    : {
        mustAnchorTerms: [],
        negatedTerms: [],
        strippedSemanticTokens: []
      };

  const semanticIntent = extractSemanticIntent(strippedSemanticTokens);
  const intentMode = classifyIntentMode({
    normalizedText,
    state: effectiveState,
    hasSemanticIntent: semanticIntent !== null
  });

  return {
    structuredFilters,
    semanticIntent,
    mustAnchorTerms,
    negatedTerms,
    intentMode,
    structuredFiltersPatch: { ...structuredFilters },
    structuredFiltersAction: "replace",
    clearSelectedListingContext:
      intentMode === "new_search" || intentMode === "replace_failed_free_text",
    paginationAction: intentMode === "next_page" ? "next_page" : "none",
    appliedQueryText: queryText
  };
}

export function normalizeListingSearchText(value: string): string {
  return normalizeSearchText(value);
}
