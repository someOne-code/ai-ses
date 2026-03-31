import assert from "node:assert/strict";
import test from "node:test";

import { sign } from "retell-sdk";

import { AppError } from "../src/lib/errors.js";
import type { ListingsService } from "../src/modules/listings/service.js";
import { getRepairStepCallerMessage } from "../src/modules/retell/repair-messages.js";
import type { RetellRepository } from "../src/modules/retell/repository.js";
import { createRetellService } from "../src/modules/retell/service.js";
import type { ShowingRequestsService } from "../src/modules/showing-requests/service.js";

const RETELL_SECRET = "retell-test-secret";
const TENANT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OFFICE_ID = "11111111-1111-4111-8111-111111111111";
const OFFICE_PHONE = "+905550000001";

function createUnexpectedListingsService(): ListingsService {
  return {
    async searchListingsDetailed() {
      throw new Error("searchListingsDetailed should not be called in this test.");
    },
    async searchListings() {
      throw new Error("searchListings should not be called in this test.");
    },
    async getListingByReference() {
      throw new Error("getListingByReference should not be called in this test.");
    },
    async refreshMainSearchDocument() {
      throw new Error(
        "refreshMainSearchDocument should not be called in this test."
      );
    }
  } as ListingsService;
}

function createFakeRetellRepository(): RetellRepository {
  return {
    async findOfficeContextById(officeId) {
      if (officeId === OFFICE_ID) {
        return { officeId: OFFICE_ID, tenantId: TENANT_ID };
      }

      return null;
    },
    async findOfficeContextByPhoneNumbers(phoneNumbers) {
      return phoneNumbers.includes(OFFICE_PHONE)
        ? { officeId: OFFICE_ID, tenantId: TENANT_ID }
        : null;
    },
    async findCallLogByProviderCallId() {
      return null;
    },
    async createCallLog() {},
    async updateCallLog() {},
    async createAuditEvent() {}
  };
}

function createFailingShowingRequestsService(
  details: unknown
): ShowingRequestsService {
  return {
    async createShowingRequest() {
      throw new AppError("Invalid input.", 400, "VALIDATION_ERROR", details);
    }
  } as ShowingRequestsService;
}

async function executeCreateShowingRequestFailure(details: unknown) {
  const retellService = createRetellService({
    repository: createFakeRetellRepository(),
    listingsService: createUnexpectedListingsService(),
    showingRequestsService: createFailingShowingRequestsService(details),
    webhookSecret: RETELL_SECRET
  });

  const body = {
    name: "create_showing_request",
    args: {
      listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Ada Yilmaz",
      customerPhone: "+905551112233",
      preferredDatetime: "2026-04-01T12:00:00.000Z"
    },
    call: {
      call_id: "call-retell-failure-mapping",
      from_number: "+905551112233",
      to_number: OFFICE_PHONE
    }
  };
  const rawBody = JSON.stringify(body);
  const signature = await sign(rawBody, RETELL_SECRET);
  const result = await retellService.executeTool({
    signature,
    body,
    rawBody
  });

  assert.equal(result.ok, false);

  return result.error;
}

test("Retell service uses the canonical upstream repairStep for caller-safe phrasing", async () => {
  const error = await executeCreateShowingRequestFailure({
    code: "VALIDATION_ERROR",
    repairStep: "preferredDatetime",
    fieldErrors: [
      {
        field: "preferredDatetime",
        message: "Preferred datetime must be in the future."
      }
    ]
  });

  assert.equal(error.code, "VALIDATION_ERROR");
  assert.equal(error.repairStep, "preferredDatetime");
  assert.equal(
    error.message,
    getRepairStepCallerMessage("preferredDatetime")
  );
  assert.deepEqual(error.fieldErrors, [
    {
      field: "preferredDatetime",
      message: "Preferred datetime must be in the future."
    }
  ]);
});

test("Retell service falls back to the generic caller-safe validation message for unknown repairStep", async () => {
  const error = await executeCreateShowingRequestFailure({
    code: "VALIDATION_ERROR",
    repairStep: "unknown",
    fieldErrors: [
      {
        field: "customerPhone",
        message:
          "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
      }
    ]
  });

  assert.equal(error.code, "VALIDATION_ERROR");
  assert.equal(error.repairStep, "unknown");
  assert.equal(
    error.message,
    "Talebi oluşturmak için bazı bilgileri yeniden teyit etmem gerekiyor."
  );
  assert.notEqual(error.message, getRepairStepCallerMessage("customerPhone"));
  assert.deepEqual(error.fieldErrors, [
    {
      field: "customerPhone",
      message:
        "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
    }
  ]);
});

test("Retell service does not invent a different field owner from fieldErrors", async () => {
  const error = await executeCreateShowingRequestFailure({
    code: "VALIDATION_ERROR",
    repairStep: "preferredDatetime",
    fieldErrors: [
      {
        field: "customerPhone",
        message:
          "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
      }
    ]
  });

  assert.equal(error.code, "VALIDATION_ERROR");
  assert.equal(error.repairStep, "preferredDatetime");
  assert.equal(
    error.message,
    getRepairStepCallerMessage("preferredDatetime")
  );
  assert.notEqual(error.message, getRepairStepCallerMessage("customerPhone"));
  assert.deepEqual(error.fieldErrors, [
    {
      field: "customerPhone",
      message:
        "Customer phone must be a valid Turkish mobile number in spoken, local, or E.164 form."
    }
  ]);
});
