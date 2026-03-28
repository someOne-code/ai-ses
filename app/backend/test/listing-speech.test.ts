import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingSpeechPresentation,
  formatPhoneNumberForSpeech,
  formatReferenceCodeForSpeech,
  formatTurkishNumberForSpeech
} from "../src/modules/listings/speech.js";
import type { ListingDetail } from "../src/modules/listings/types.js";

const LISTING_FIXTURE: ListingDetail = {
  id: "33333333-3333-4333-8333-333333333333",
  referenceCode: "DEMO-IST-3401",
  title: "Kadikoy Moda 2+1 Renovated Apartment Near the Coast",
  listingType: "rent",
  propertyType: "apartment",
  price: 65000,
  currency: "TRY",
  bedrooms: 2,
  bathrooms: 1,
  netM2: 95,
  district: "Kadikoy",
  neighborhood: "Moda",
  status: "active",
  description: "Recently renovated apartment.",
  grossM2: 110,
  floorNumber: 3,
  buildingAge: 12,
  dues: 2500,
  addressText: "Moda, Kadikoy, Istanbul",
  hasBalcony: true,
  hasParking: false,
  hasElevator: true
};

test("formatTurkishNumberForSpeech produces deterministic Turkish words for high-risk integers", () => {
  assert.equal(formatTurkishNumberForSpeech(12), "on iki");
  assert.equal(formatTurkishNumberForSpeech(95), "doksan be\u015f");
  assert.equal(formatTurkishNumberForSpeech(65000), "altm\u0131\u015f be\u015f bin");
  assert.equal(
    formatTurkishNumberForSpeech(24_500_000),
    "yirmi d\u00f6rt milyon be\u015f y\u00fcz bin"
  );
});

test("formatReferenceCodeForSpeech preserves tokens and reads digits separately", () => {
  assert.equal(
    formatReferenceCodeForSpeech("DEMO-IST-3401"),
    "DEMO - IST - 3 4 0 1"
  );
});

test("formatPhoneNumberForSpeech groups Turkish callback numbers into short blocks", () => {
  assert.equal(
    formatPhoneNumberForSpeech("0505 692 40 71"),
    "0 5 0 5 - 6 9 2 - 4 0 - 7 1"
  );
});

test("buildListingSpeechPresentation emits natural spoken phrases for listing search output", () => {
  const speech = buildListingSpeechPresentation(LISTING_FIXTURE);

  assert.equal(speech.spokenReferenceCode, "DEMO - IST - 3 4 0 1");
  assert.equal(speech.spokenRoomPlan, "\u0130ki oda bir salon.");
  assert.equal(speech.spokenPrice, "Fiyat\u0131 altm\u0131\u015f be\u015f bin lira.");
  assert.equal(speech.spokenDues, "Aidat\u0131 iki bin be\u015f y\u00fcz lira.");
  assert.equal(
    speech.spokenNetM2,
    "Yakla\u015f\u0131k doksan be\u015f metrekare."
  );
  assert.match(
    speech.spokenSummary,
    /Kadikoy Moda taraf\u0131nda kiral\u0131k bir daire var\./
  );
  assert.match(speech.spokenSummary, /\u0130ki oda bir salon\./);
  assert.match(
    speech.spokenSummary,
    /Fiyat\u0131 altm\u0131\u015f be\u015f bin lira\./
  );
  assert.match(
    speech.spokenSummary,
    /Aidat\u0131 iki bin be\u015f y\u00fcz lira\./
  );
  assert.match(speech.spokenSummary, /Bina ya\u015f\u0131 on iki\./);
  assert.match(speech.spokenSummary, /Balkon var\./);
  assert.match(speech.spokenSummary, /Asans\u00f6r var\./);
});
