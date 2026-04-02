import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRetellToolFailure,
  parseRetellToolResult
} from "../src/modules/retell/types.js";

test("Retell tool result parser preserves referenceCode repair metadata", () => {
  const result = parseRetellToolResult({
    ok: false,
    tool: "get_listing_by_reference",
    error: {
      code: "VALIDATION_ERROR",
      message: "Ilan kodunu yeniden teyit etmem gerekiyor.",
      callerMessage: "Ilan kodunu tam haliyle bir kez daha almam gerekiyor.",
      repairStep: "referenceCode",
      fieldErrors: [
        {
          field: "referenceCode",
          message: "Reference code is required."
        }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.tool, "get_listing_by_reference");
  assert.equal(result.error.repairStep, "referenceCode");
  assert.equal(
    result.error.callerMessage,
    "Ilan kodunu tam haliyle bir kez daha almam gerekiyor."
  );
  assert.deepEqual(result.error.fieldErrors, [
    {
      field: "referenceCode",
      message: "Reference code is required."
    }
  ]);
});

test("Retell tool failure parser preserves customerPhone repair metadata and extra envelope hints", () => {
  const result = parseRetellToolFailure({
    ok: false,
    tool: "create_showing_request",
    error: {
      code: "VALIDATION_ERROR",
      message: "Talebi olusturmak icin bazi bilgileri yeniden teyit etmem gerekiyor.",
      callerMessage:
        "Telefon numaranizi tam anlayamadim, 10 hane olarak tekrar soyler misiniz?",
      repairStep: "customerPhone",
      fieldErrors: [
        {
          field: "customerPhone",
          message:
            "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
        }
      ],
      sameCandidate: true
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.tool, "create_showing_request");
  assert.equal(result.error.repairStep, "customerPhone");
  assert.equal(result.error.sameCandidate, true);
  assert.equal(
    result.error.callerMessage,
    "Telefon numaranizi tam anlayamadim, 10 hane olarak tekrar soyler misiniz?"
  );
  assert.deepEqual(result.error.fieldErrors, [
    {
      field: "customerPhone",
      message:
        "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
    }
  ]);
});

test("Retell tool result parser does not collapse canonical fieldErrors into a generic unknown failure", () => {
  const result = parseRetellToolResult({
    ok: false,
    tool: "create_showing_request",
    error: {
      code: "VALIDATION_ERROR",
      message: "Talebi olusturmak icin bazi bilgileri yeniden teyit etmem gerekiyor.",
      callerMessage:
        "Talebi olusturmak icin bazi bilgileri yeniden teyit etmem gerekiyor.",
      repairStep: "unknown",
      fieldErrors: [
        {
          field: "customerPhone",
          message:
            "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
        }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.repairStep, "unknown");
  assert.equal(
    result.error.callerMessage,
    "Talebi olusturmak icin bazi bilgileri yeniden teyit etmem gerekiyor."
  );
  assert.deepEqual(result.error.fieldErrors, [
    {
      field: "customerPhone",
      message:
        "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
    }
  ]);
});
