import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTurkishMobilePhone,
  parseTurkishMobilePhoneCandidate
} from "../src/lib/phone-parser.js";

test("deterministic phone parser normalizes spoken Turkish blocks into E.164", () => {
  const parsed = parseTurkishMobilePhoneCandidate(
    "beş yüz beş altı yüz doksan iki kırk yetmiş bir"
  );

  assert.equal(parsed.extractedDigits, "5056924071");
  assert.equal(parsed.local10, "5056924071");
  assert.equal(parsed.e164, "+905056924071");
  assert.equal(parsed.parseConfidence, "high");
  assert.equal(parsed.source, "spoken");
});

test("deterministic phone parser handles noisy mixed utterances", () => {
  const parsed = parseTurkishMobilePhoneCandidate(
    "telefon numaram 0 505 altı yüz doksan iki 40 71"
  );

  assert.equal(parsed.extractedDigits, "05056924071");
  assert.equal(parsed.local10, "5056924071");
  assert.equal(parsed.e164, "+905056924071");
  assert.equal(parsed.source, "mixed");
});

test("deterministic phone parser returns null normalization for incomplete numbers", () => {
  const parsed = parseTurkishMobilePhoneCandidate(
    "beş yüz beş altı yüz doksan iki kırk yedi"
  );

  assert.equal(parsed.extractedDigits, "50569247");
  assert.equal(parsed.e164, null);
  assert.equal(parsed.parseConfidence, "low");
});

test("normalizeTurkishMobilePhone helper returns null for non-phone content", () => {
  assert.equal(
    normalizeTurkishMobilePhone("bu metinde kullanılabilir telefon yok"),
    null
  );
});
