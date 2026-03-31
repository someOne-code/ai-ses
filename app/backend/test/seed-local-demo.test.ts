import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LOCAL_DEMO_CONNECTION_CONFIGS } from "../scripts/seed-local-demo.ts";
import { env } from "../src/config/env.js";

type WorkflowNode = {
  name?: string;
  type?: string;
  parameters?: {
    path?: unknown;
  };
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..", "..");
const bookingWorkflowAssetPath = path.join(
  repoRoot,
  "infra",
  "n8n",
  "ai-ses-booking-flow.json"
);

function readBookingWebhookPath() {
  const workflow = JSON.parse(
    readFileSync(bookingWorkflowAssetPath, "utf8")
  ) as {
    nodes?: WorkflowNode[];
  };
  const webhookNode = workflow.nodes?.find(
    (node) => node.name === "Webhook" && node.type === "n8n-nodes-base.webhook"
  );
  const webhookPath = webhookNode?.parameters?.path;

  assert.equal(typeof webhookPath, "string");
  assert.notEqual(webhookPath.trim(), "");

  return webhookPath;
}

test("local demo booking connection config includes the live booking trigger path", () => {
  const webhookPath = readBookingWebhookPath();

  assert.equal(
    LOCAL_DEMO_CONNECTION_CONFIGS.booking.triggerPath,
    `/webhook/${webhookPath}`
  );
  assert.equal(
    LOCAL_DEMO_CONNECTION_CONFIGS.booking.workflowSlug,
    webhookPath
  );

  if (env.N8N_GOOGLE_CALENDAR_ID) {
    assert.equal(LOCAL_DEMO_CONNECTION_CONFIGS.booking.provider, "google_calendar");
    assert.equal(
      LOCAL_DEMO_CONNECTION_CONFIGS.booking.calendarId,
      env.N8N_GOOGLE_CALENDAR_ID
    );
    assert.equal(
      LOCAL_DEMO_CONNECTION_CONFIGS.booking.cleanupCreatedEvent,
      false
    );
    assert.equal(
      "availabilityUrl" in LOCAL_DEMO_CONNECTION_CONFIGS.booking,
      false
    );
    assert.equal("bookingUrl" in LOCAL_DEMO_CONNECTION_CONFIGS.booking, false);
    return;
  }

  assert.equal(
    LOCAL_DEMO_CONNECTION_CONFIGS.booking.provider,
    undefined
  );
  assert.equal(
    LOCAL_DEMO_CONNECTION_CONFIGS.booking.availabilityUrl,
    "http://127.0.0.1:4010/availability"
  );
  assert.equal(
    LOCAL_DEMO_CONNECTION_CONFIGS.booking.bookingUrl,
    "http://127.0.0.1:4010/booking"
  );
});
