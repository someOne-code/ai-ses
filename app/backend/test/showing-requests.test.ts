import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../src/lib/errors.js";
import { parseCreateShowingRequestToolArgs } from "../src/modules/retell/types.js";
import { createShowingRequestsService } from "../src/modules/showing-requests/service.js";
import {
  parseCreateShowingRequestBody,
  type CreateShowingRequestInput
} from "../src/modules/showing-requests/types.js";

interface ValidationErrorDetails {
  repairStep?: string;
  fieldErrors?: Array<{ field: string; message: string }>;
}

const baseInput: CreateShowingRequestInput = {
  officeId: "11111111-1111-4111-8111-111111111111",
  listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  customerName: "Ada",
  customerPhone: "+905551112233",
  customerEmail: "ada@example.com",
  preferredTimeWindow: "afternoon",
  preferredDatetime: new Date("2026-03-30T13:00:00.000Z")
};

function getValidationErrorDetails(input: Record<string, unknown>): ValidationErrorDetails {
  try {
    parseCreateShowingRequestBody(input);
    assert.fail("Expected showing request validation to fail.");
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "VALIDATION_ERROR");
    return (error.details as ValidationErrorDetails | undefined) ?? {};
  }
}

test("showing requests service dispatches booking after a successful create", async () => {
  const dispatched: Array<{ officeId: string; showingRequestId: string }> = [];
  const service = createShowingRequestsService(
    {
      async findOfficeListing() {
        return { id: baseInput.listingId };
      },
      async create() {
        return {
          id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
          officeId: baseInput.officeId,
          listingId: baseInput.listingId,
          customerName: baseInput.customerName,
          customerPhone: baseInput.customerPhone,
          customerEmail: baseInput.customerEmail ?? null,
          preferredTimeWindow: baseInput.preferredTimeWindow,
          preferredDatetime: baseInput.preferredDatetime,
          status: "pending",
          createdAt: new Date("2026-03-29T10:00:00.000Z")
        };
      }
    },
    {
      integrationsService: {
        async dispatchShowingRequestCreated(params) {
          dispatched.push(params);
        }
      }
    }
  );

  const record = await service.createShowingRequest(baseInput);

  assert.equal(record.id, "cccccccc-cccc-4ccc-8ccc-ccccccccccc1");
  assert.deepEqual(dispatched, [
    {
      officeId: baseInput.officeId,
      showingRequestId: record.id
    }
  ]);
});

test("showing requests service keeps request creation successful when booking dispatch fails after persistence", async () => {
  let dispatchAttempts = 0;
  const service = createShowingRequestsService(
    {
      async findOfficeListing() {
        return { id: baseInput.listingId };
      },
      async create() {
        return {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          officeId: baseInput.officeId,
          listingId: baseInput.listingId,
          customerName: baseInput.customerName,
          customerPhone: baseInput.customerPhone,
          customerEmail: baseInput.customerEmail ?? null,
          preferredTimeWindow: baseInput.preferredTimeWindow,
          preferredDatetime: baseInput.preferredDatetime,
          status: "pending",
          createdAt: new Date("2026-03-29T10:05:00.000Z")
        };
      }
    },
    {
      integrationsService: {
        async dispatchShowingRequestCreated() {
          dispatchAttempts += 1;
          throw new Error("booking workflow offline");
        }
      }
    }
  );

  const record = await service.createShowingRequest(baseInput);

  assert.equal(record.id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(record.status, "pending");
  assert.equal(dispatchAttempts, 1);
});

test("showing request parser keeps a bad phone repair isolated to customerPhone", () => {
  const details = getValidationErrorDetails({
    listingId: baseInput.listingId,
    customerName: baseInput.customerName,
    customerPhone: "505692471",
    preferredTimeWindow: "lunch"
  });

  assert.equal(details.repairStep, "customerPhone");
  assert.deepEqual(
    (details.fieldErrors ?? []).map((entry) => entry.field),
    ["customerPhone"]
  );
  assert.match(details.fieldErrors?.[0]?.message ?? "", /Turkish mobile number/i);
});

test("showing request parser keeps missing or invalid scheduling inside scheduling repair fields", () => {
  const details = getValidationErrorDetails({
    listingId: baseInput.listingId,
    customerName: baseInput.customerName,
    customerPhone: "5056924071",
    preferredTimeWindow: "lunch"
  });

  assert.equal(details.repairStep, "preferredDatetime");
  assert.deepEqual(
    [...new Set((details.fieldErrors ?? []).map((entry) => entry.field))].sort(),
    ["preferredDatetime", "preferredTimeWindow"]
  );
});

test("showing request parser keeps missing preferred datetime inside scheduling repair fields across provider-empty shapes", () => {
  for (const preferredDatetime of [undefined, null, "", 0] as const) {
    const details = getValidationErrorDetails({
      listingId: baseInput.listingId,
      customerName: baseInput.customerName,
      customerPhone: "5056924071",
      preferredTimeWindow: "afternoon",
      ...(preferredDatetime === undefined ? {} : { preferredDatetime })
    });

    assert.equal(details.repairStep, "preferredDatetime");
    assert.deepEqual(
      [...new Set((details.fieldErrors ?? []).map((entry) => entry.field))].sort(),
      ["preferredDatetime"]
    );
  }
});

test("showing request parsers ignore provider-empty preferredTimeWindow markers when preferred datetime is present", () => {
  for (const preferredTimeWindow of [null, "", 0] as const) {
    const body = parseCreateShowingRequestBody({
      listingId: baseInput.listingId,
      customerName: baseInput.customerName,
      customerPhone: "5056924071",
      preferredDatetime: baseInput.preferredDatetime.toISOString(),
      preferredTimeWindow
    });

    const toolArgs = parseCreateShowingRequestToolArgs({
      listingId: baseInput.listingId,
      customerName: baseInput.customerName,
      customerPhone: "5056924071",
      preferredDatetime: baseInput.preferredDatetime.toISOString(),
      preferredTimeWindow
    });

    assert.equal(body.preferredTimeWindow, undefined);
    assert.equal(toolArgs.preferredTimeWindow, undefined);
  }
});

test("showing request parser does not reopen unrelated fields when the same failed normalized phone candidate is retried", () => {
  const firstBadPhoneCandidate = "505 692 47 1";
  const secondBadPhoneCandidate = "505-692-47-1";

  const firstAttempt = getValidationErrorDetails({
    listingId: baseInput.listingId,
    customerName: baseInput.customerName,
    customerPhone: firstBadPhoneCandidate,
    preferredDatetime: baseInput.preferredDatetime.toISOString()
  });

  const secondAttempt = getValidationErrorDetails({
    listingId: baseInput.listingId,
    customerName: "",
    customerPhone: secondBadPhoneCandidate,
    preferredTimeWindow: "lunch"
  });

  assert.equal(firstAttempt.repairStep, "customerPhone");
  assert.deepEqual(
    (firstAttempt.fieldErrors ?? []).map((entry) => entry.field),
    ["customerPhone"]
  );
  assert.equal(secondAttempt.repairStep, "customerPhone");
  assert.deepEqual(
    (secondAttempt.fieldErrors ?? []).map((entry) => entry.field),
    ["customerPhone"]
  );
});
