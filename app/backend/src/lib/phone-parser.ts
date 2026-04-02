export type PhoneParseSource = "none" | "digits" | "spoken" | "mixed";
export type PhoneParseConfidence = "none" | "low" | "medium" | "high";

export interface TurkishMobilePhoneParseResult {
  rawInput: string;
  extractedDigits: string;
  local10: string | null;
  e164: string | null;
  digitCount: number;
  source: PhoneParseSource;
  parseConfidence: PhoneParseConfidence;
}

const TURKISH_CHAR_REPLACEMENTS: Record<string, string> = {
  "\u0131": "i",
  i: "i",
  "\u00fc": "u",
  "\u00f6": "o",
  "\u015f": "s",
  "\u00e7": "c",
  "\u011f": "g"
};

const DIGIT_WORDS = new Map<string, string>([
  ["sifir", "0"],
  ["bir", "1"],
  ["iki", "2"],
  ["uc", "3"],
  ["dort", "4"],
  ["bes", "5"],
  ["alti", "6"],
  ["yedi", "7"],
  ["sekiz", "8"],
  ["dokuz", "9"]
]);

const TENS_WORDS = new Map<string, number>([
  ["on", 10],
  ["yirmi", 20],
  ["otuz", 30],
  ["kirk", 40],
  ["elli", 50],
  ["altmis", 60],
  ["yetmis", 70],
  ["seksen", 80],
  ["doksan", 90]
]);

const SCALE_WORDS = new Map<string, number>([
  ["yuz", 100],
  ["bin", 1000]
]);

function normalizeToken(value: string): string {
  const lowered = value.toLocaleLowerCase("tr-TR");
  const replaced = lowered.replace(
    /[\u0131i\u00fc\u00f6\u015f\u00e7\u011f]/g,
    (character) => TURKISH_CHAR_REPLACEMENTS[character] ?? character
  );

  return replaced.normalize("NFKC");
}

function tokenize(value: string): string[] {
  const normalized = normalizeToken(value);

  return normalized.match(/[a-z0-9]+/g) ?? [];
}

function isNumberWord(token: string): boolean {
  return (
    DIGIT_WORDS.has(token) || TENS_WORDS.has(token) || SCALE_WORDS.has(token)
  );
}

function parseCardinalNumber(tokens: string[]): string | null {
  let total = 0;
  let current = 0;
  let sawNumberToken = false;

  for (const token of tokens) {
    const digit = DIGIT_WORDS.get(token);

    if (digit !== undefined) {
      current += Number(digit);
      sawNumberToken = true;
      continue;
    }

    const tens = TENS_WORDS.get(token);

    if (tens !== undefined) {
      current += tens;
      sawNumberToken = true;
      continue;
    }

    const scale = SCALE_WORDS.get(token);

    if (scale === 100) {
      current = (current === 0 ? 1 : current) * 100;
      sawNumberToken = true;
      continue;
    }

    if (scale === 1000) {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      sawNumberToken = true;
      continue;
    }

    return null;
  }

  if (!sawNumberToken) {
    return null;
  }

  return String(total + current);
}

function parseDigitWordSequence(tokens: string[]): string[] | null {
  if (tokens.length === 0) {
    return null;
  }

  if (tokens.every((token) => DIGIT_WORDS.has(token))) {
    return [tokens.map((token) => DIGIT_WORDS.get(token) ?? "").join("")];
  }

  if (tokens.includes("bin")) {
    const cardinal = parseCardinalNumber(tokens);

    return cardinal ? [cardinal] : null;
  }

  const chunks: string[] = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index] ?? "";
    const digit = DIGIT_WORDS.get(token);
    const tens = TENS_WORDS.get(token);
    const scale = SCALE_WORDS.get(token);

    if (digit !== undefined) {
      if (tokens[index + 1] === "yuz") {
        let value = Number(digit) * 100;
        index += 2;

        const maybeTens = TENS_WORDS.get(tokens[index] ?? "");

        if (maybeTens !== undefined) {
          value += maybeTens;
          index += 1;
        }

        const maybeDigit = DIGIT_WORDS.get(tokens[index] ?? "");

        if (maybeDigit !== undefined) {
          value += Number(maybeDigit);
          index += 1;
        }

        chunks.push(String(value));
        continue;
      }

      chunks.push(digit);
      index += 1;
      continue;
    }

    if (scale === 100) {
      let value = 100;
      index += 1;

      const maybeTens = TENS_WORDS.get(tokens[index] ?? "");

      if (maybeTens !== undefined) {
        value += maybeTens;
        index += 1;
      }

      const maybeDigit = DIGIT_WORDS.get(tokens[index] ?? "");

      if (maybeDigit !== undefined) {
        value += Number(maybeDigit);
        index += 1;
      }

      chunks.push(String(value));
      continue;
    }

    if (tens !== undefined) {
      let value = tens;
      index += 1;

      const maybeDigit = DIGIT_WORDS.get(tokens[index] ?? "");

      if (maybeDigit !== undefined) {
        value += Number(maybeDigit);
        index += 1;
      }

      chunks.push(String(value));
      continue;
    }

    return null;
  }

  if (chunks.length === 0) {
    return null;
  }

  return chunks;
}

function normalizeLocalTurkishMobileDigits(digits: string): string | null {
  if (/^5\d{9}$/.test(digits)) {
    return digits;
  }

  if (/^05\d{9}$/.test(digits)) {
    return digits.slice(1);
  }

  const withCountryCode = digits.match(/^90(5\d{9})$/);

  if (withCountryCode) {
    return withCountryCode[1] ?? null;
  }

  const withDoubleZeroPrefix = digits.match(/^0090(5\d{9})$/);

  if (withDoubleZeroPrefix) {
    return withDoubleZeroPrefix[1] ?? null;
  }

  return null;
}

export function parseTurkishMobilePhoneCandidate(
  value: string | null | undefined
): TurkishMobilePhoneParseResult {
  const rawInput = typeof value === "string" ? value : "";
  const trimmed = rawInput.trim();

  if (trimmed === "") {
    return {
      rawInput,
      extractedDigits: "",
      local10: null,
      e164: null,
      digitCount: 0,
      source: "none",
      parseConfidence: "none"
    };
  }

  const tokens = tokenize(trimmed);
  const digitParts: string[] = [];
  let sawDigitToken = false;
  let sawNumberWordToken = false;
  let skippedWordTokenCount = 0;

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index] ?? "";
    const directDigits = token.replace(/[^\d]/g, "");

    if (directDigits !== "") {
      sawDigitToken = true;
      digitParts.push(directDigits);
      index += 1;
      continue;
    }

    if (isNumberWord(token)) {
      let end = index + 1;

      while (end < tokens.length && isNumberWord(tokens[end] ?? "")) {
        end += 1;
      }

      const parsedWordChunks = parseDigitWordSequence(tokens.slice(index, end));

      if (parsedWordChunks !== null) {
        sawNumberWordToken = true;
        digitParts.push(...parsedWordChunks);
      } else {
        skippedWordTokenCount += end - index;
      }

      index = end;
      continue;
    }

    if (/[a-z]/.test(token)) {
      skippedWordTokenCount += 1;
    }

    index += 1;
  }

  const extractedDigits = digitParts.join("");
  const local10 = normalizeLocalTurkishMobileDigits(extractedDigits);
  const source: PhoneParseSource = !sawDigitToken && !sawNumberWordToken
    ? "none"
    : sawDigitToken && sawNumberWordToken
      ? "mixed"
      : sawDigitToken
        ? "digits"
        : "spoken";

  let parseConfidence: PhoneParseConfidence = "none";

  if (local10) {
    parseConfidence =
      skippedWordTokenCount === 0 && source !== "mixed" ? "high" : "medium";
  } else if (extractedDigits.length > 0) {
    parseConfidence = extractedDigits.length >= 8 ? "low" : "none";
  }

  return {
    rawInput,
    extractedDigits,
    local10,
    e164: local10 ? `+90${local10}` : null,
    digitCount: extractedDigits.length,
    source,
    parseConfidence
  };
}

export function normalizeTurkishMobilePhone(
  value: string | null | undefined
): string | null {
  return parseTurkishMobilePhoneCandidate(value).e164;
}
