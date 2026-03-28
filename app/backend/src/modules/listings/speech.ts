import type { ListingDetail, ListingSearchItem } from "./types.js";

const DIGIT_WORDS = [
  "s\u0131f\u0131r",
  "bir",
  "iki",
  "\u00fc\u00e7",
  "d\u00f6rt",
  "be\u015f",
  "alt\u0131",
  "yedi",
  "sekiz",
  "dokuz"
] as const;

const TENS_WORDS = [
  "",
  "on",
  "yirmi",
  "otuz",
  "k\u0131rk",
  "elli",
  "altm\u0131\u015f",
  "yetmi\u015f",
  "seksen",
  "doksan"
] as const;

const PRICE_UNIT_LABELS: Record<string, string> = {
  TRY: "lira",
  USD: "Amerikan dolar\u0131",
  EUR: "euro",
  GBP: "sterlin"
};

export interface ListingSpeechPresentation {
  spokenSummary: string;
  spokenHighlights: string[];
  spokenPrice: string | null;
  spokenDues: string | null;
  spokenNetM2: string | null;
  spokenRoomPlan: string | null;
  spokenReferenceCode: string;
}

function trimSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function appendPeriod(value: string): string {
  const trimmed = trimSentence(value);

  if (trimmed === "") {
    return trimmed;
  }

  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function capitalizeSentence(value: string): string {
  if (value === "") {
    return value;
  }

  return value.charAt(0).toLocaleUpperCase("tr-TR") + value.slice(1);
}

function formatTurkishIntegerUnderThousand(value: number): string {
  if (value === 0) {
    return "";
  }

  const hundreds = Math.trunc(value / 100);
  const tens = Math.trunc((value % 100) / 10);
  const ones = value % 10;
  const parts: string[] = [];

  if (hundreds > 0) {
    if (hundreds === 1) {
      parts.push("y\u00fcz");
    } else {
      parts.push(DIGIT_WORDS[hundreds] ?? "", "y\u00fcz");
    }
  }

  if (tens > 0) {
    parts.push(TENS_WORDS[tens] ?? "");
  }

  if (ones > 0) {
    parts.push(DIGIT_WORDS[ones] ?? "");
  }

  return parts.join(" ");
}

export function formatTurkishNumberForSpeech(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (value === 0) {
    return "s\u0131f\u0131r";
  }

  if (!Number.isInteger(value)) {
    const [wholePart, fractionPart] = value.toString().split(".");
    const whole = formatTurkishNumberForSpeech(Number(wholePart));
    const fraction = (fractionPart ?? "")
      .split("")
      .map((digit) => DIGIT_WORDS[Number(digit)] ?? digit)
      .join(" ");

    return trimSentence(`${whole} virg\u00fcl ${fraction}`);
  }

  const negative = value < 0;
  let remaining = Math.abs(value);
  const groups: Array<{ size: number; label: string }> = [
    { size: 1_000_000_000, label: "milyar" },
    { size: 1_000_000, label: "milyon" },
    { size: 1_000, label: "bin" }
  ];
  const parts: string[] = [];

  for (const group of groups) {
    const current = Math.trunc(remaining / group.size);

    if (current === 0) {
      continue;
    }

    if (group.label === "bin" && current === 1) {
      parts.push("bin");
    } else {
      parts.push(formatTurkishIntegerUnderThousand(current), group.label);
    }

    remaining %= group.size;
  }

  if (remaining > 0) {
    parts.push(formatTurkishIntegerUnderThousand(remaining));
  }

  const result = trimSentence(parts.join(" "));
  return negative ? `eksi ${result}` : result;
}

export function formatPhoneNumberForSpeech(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");

  if (digits.length === 11) {
    return [
      digits.slice(0, 4),
      digits.slice(4, 7),
      digits.slice(7, 9),
      digits.slice(9, 11)
    ]
      .map((group) => group.split("").join(" "))
      .join(" - ");
  }

  if (digits.length === 10) {
    return [
      digits.slice(0, 3),
      digits.slice(3, 6),
      digits.slice(6, 8),
      digits.slice(8, 10)
    ]
      .map((group) => group.split("").join(" "))
      .join(" - ");
  }

  return digits.split("").join(" ");
}

export function formatReferenceCodeForSpeech(referenceCode: string): string {
  return referenceCode
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (/^\d+$/.test(part)) {
        return part.split("").join(" ");
      }

      return part.toUpperCase();
    })
    .join(" - ");
}

function extractRoomPlan(
  title: string | null
): { bedrooms: number; salons: number } | null {
  if (!title) {
    return null;
  }

  const match = title.match(/(\d+)\s*\+\s*(\d+)/);

  if (!match) {
    return null;
  }

  return {
    bedrooms: Number(match[1]),
    salons: Number(match[2])
  };
}

function buildRoomPlanSentence(
  listing: Pick<ListingSearchItem, "title" | "bedrooms">
): string | null {
  const parsed = extractRoomPlan(listing.title);

  if (parsed) {
    return appendPeriod(
      capitalizeSentence(
      `${formatTurkishNumberForSpeech(parsed.bedrooms)} oda ${formatTurkishNumberForSpeech(parsed.salons)} salon`
      )
    );
  }

  if (listing.bedrooms !== null) {
    return appendPeriod(
      capitalizeSentence(
        `${formatTurkishNumberForSpeech(listing.bedrooms)} yatak odas\u0131 g\u00f6r\u00fcn\u00fcyor`
      )
    );
  }

  return null;
}

function buildPriceSentence(price: number | null, currency: string): string | null {
  if (price === null) {
    return null;
  }

  const currencyLabel = PRICE_UNIT_LABELS[currency] ?? currency;

  return appendPeriod(
    `Fiyat\u0131 ${formatTurkishNumberForSpeech(price)} ${currencyLabel}`
  );
}

function buildNetM2Sentence(netM2: number | null): string | null {
  if (netM2 === null) {
    return null;
  }

  return appendPeriod(
    `Yakla\u015f\u0131k ${formatTurkishNumberForSpeech(netM2)} metrekare`
  );
}

function buildDuesSentence(dues: number | null, currency: string): string | null {
  if (dues === null) {
    return null;
  }

  const currencyLabel = PRICE_UNIT_LABELS[currency] ?? currency;
  return appendPeriod(
    `Aidat\u0131 ${formatTurkishNumberForSpeech(dues)} ${currencyLabel}`
  );
}

function buildDetailOnlySentences(
  listing: ListingSearchItem | ListingDetail
): string[] {
  if (!("buildingAge" in listing)) {
    return [];
  }

  const sentences: string[] = [];

  if (listing.buildingAge !== null) {
    sentences.push(
      appendPeriod(
        `Bina ya\u015f\u0131 ${formatTurkishNumberForSpeech(listing.buildingAge)}`
      )
    );
  }

  if (listing.hasBalcony === true) {
    sentences.push("Balkon var.");
  }

  if (listing.hasElevator === true) {
    sentences.push("Asans\u00f6r var.");
  }

  if (listing.hasParking === true) {
    sentences.push("Otopark var.");
  }

  return sentences;
}

function buildLocationPhrase(
  listing: Pick<ListingSearchItem, "district" | "neighborhood">
): string | null {
  if (listing.district && listing.neighborhood) {
    return `${listing.district} ${listing.neighborhood} taraf\u0131nda`;
  }

  if (listing.neighborhood) {
    return `${listing.neighborhood} taraf\u0131nda`;
  }

  if (listing.district) {
    return `${listing.district} taraf\u0131nda`;
  }

  return null;
}

function buildPropertyKindPhrase(
  listing: Pick<ListingSearchItem, "listingType" | "propertyType">
): string | null {
  const listingType =
    listing.listingType === "rent"
      ? "kiral\u0131k"
      : listing.listingType === "sale"
        ? "sat\u0131l\u0131k"
        : null;

  const propertyType =
    listing.propertyType === "apartment"
      ? "bir daire"
      : listing.propertyType === "villa"
        ? "bir villa"
        : listing.propertyType
          ? `bir ${listing.propertyType}`
          : "bir ilan";

  if (listingType) {
    return `${listingType} ${propertyType}`;
  }

  return propertyType;
}

function buildSummarySentence(listing: ListingSearchItem): string {
  const location = buildLocationPhrase(listing);
  const propertyKind = buildPropertyKindPhrase(listing);

  if (location && propertyKind) {
    return appendPeriod(`${location} ${propertyKind} var`);
  }

  if (location) {
    return appendPeriod(`${location} bir ilan var`);
  }

  return appendPeriod(`${propertyKind ?? "Bir ilan"} var`);
}

export function buildListingSpeechPresentation(
  listing: ListingSearchItem | ListingDetail
): ListingSpeechPresentation {
  const spokenPrice = buildPriceSentence(listing.price, listing.currency);
  const spokenDues =
    "dues" in listing ? buildDuesSentence(listing.dues, listing.currency) : null;
  const spokenNetM2 = buildNetM2Sentence(listing.netM2);
  const spokenRoomPlan = buildRoomPlanSentence(listing);
  const spokenDetailSentences = buildDetailOnlySentences(listing);
  const spokenHighlights = [
    spokenRoomPlan,
    spokenPrice,
    spokenDues,
    spokenNetM2
  ].filter((value): value is string => value !== null);

  return {
    spokenSummary: trimSentence(
      [buildSummarySentence(listing), ...spokenHighlights, ...spokenDetailSentences].join(" ")
    ),
    spokenHighlights,
    spokenPrice,
    spokenDues,
    spokenNetM2,
    spokenRoomPlan,
    spokenReferenceCode: formatReferenceCodeForSpeech(listing.referenceCode)
  };
}
