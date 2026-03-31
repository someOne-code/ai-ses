import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const n8nDir = path.resolve(currentDir, "../../../infra/n8n");
const runtimeVerificationPath = path.resolve(
  currentDir,
  "../../../infra/n8n/runtime-verification.md"
);

async function readProjectOwnedWorkflowAssets() {
  const entries = await readdir(n8nDir);
  const assetNames = entries.filter(
    (entry) => entry.startsWith("ai-ses-") && entry.endsWith(".json")
  );

  return Promise.all(
    assetNames.map(async (name) => ({
      name,
      raw: await readFile(path.join(n8nDir, name), "utf8")
    }))
  );
}

async function readAllWorkflowAssets() {
  const entries = await readdir(n8nDir);
  const assetNames = entries.filter((entry) => entry.endsWith(".json"));

  return Promise.all(
    assetNames.map(async (name) => ({
      name,
      workflow: JSON.parse(
        (await readFile(path.join(n8nDir, name), "utf8")).replace(/^\uFEFF/, "")
      ) as {
        id?: string;
        versionId?: string;
        meta?: Record<string, unknown> | null;
        nodes?: unknown[];
        connections?: Record<string, unknown>;
      }
    }))
  );
}

function parseWorkflow(raw: string) {
  return JSON.parse(raw) as Record<string, unknown>;
}

function getCallbackNodeNames(raw: string) {
  return [
    ...raw.matchAll(/"name": "(Send [^"]+ Result Callback|Send Failed Delivery Callback)"/g)
  ].map((match) => match[1]!);
}

test("project-owned n8n assets do not allow body-controlled callback routing for secret-bearing requests", async () => {
  const assets = await readProjectOwnedWorkflowAssets();

  assert.ok(assets.length >= 1);

  for (const asset of assets) {
    if (
      !asset.raw.includes("$env.N8N_BOOKING_CALLBACK_SECRET") &&
      !asset.raw.includes("$env.N8N_CRM_CALLBACK_SECRET")
    ) {
      continue;
    }

    assert.equal(
      asset.raw.includes("callbackSecretHeader"),
      false,
      `${asset.name} must not read callback secret header from request payload`
    );
    assert.equal(
      asset.raw.includes("body.callback"),
      false,
      `${asset.name} must not read callback metadata from request payload`
    );
    assert.equal(
      asset.raw.includes("backendBaseUrl"),
      false,
      `${asset.name} must not read backend callback base URL from request payload`
    );
    assert.ok(
      asset.raw.includes("x-ai-ses-callback-secret"),
      `${asset.name} must use the fixed backend callback header`
    );
  }
});

test("project-owned n8n assets gate outbound execution behind a trigger secret when they perform secret-bearing callbacks", async () => {
  const assets = await readProjectOwnedWorkflowAssets();

  for (const asset of assets) {
    const usesBookingCallbackSecret = asset.raw.includes(
      "$env.N8N_BOOKING_CALLBACK_SECRET"
    );
    const usesCrmCallbackSecret = asset.raw.includes(
      "$env.N8N_CRM_CALLBACK_SECRET"
    );

    if (!usesBookingCallbackSecret && !usesCrmCallbackSecret) {
      continue;
    }

    const expectedTriggerEnv = usesBookingCallbackSecret
      ? "$env.N8N_BOOKING_TRIGGER_SECRET"
      : "$env.N8N_CRM_TRIGGER_SECRET";
    const expectedForbiddenCode = usesBookingCallbackSecret
      ? "BOOKING_TRIGGER_FORBIDDEN"
      : "CRM_SYNC_TRIGGER_FORBIDDEN";

    assert.ok(
      asset.raw.includes(expectedTriggerEnv),
      `${asset.name} must require the matching trigger secret env var`
    );
    assert.ok(
      asset.raw.includes("x-ai-ses-trigger-secret"),
      `${asset.name} must validate the trigger secret header`
    );
    assert.ok(
      asset.raw.includes(expectedForbiddenCode),
      `${asset.name} must explicitly reject unauthorized inbound execution`
    );
  }
});

test("project-owned n8n workflows keep runtime verification guidance for live webhook registration and env-backed auth", async () => {
  const runtimeVerification = await readFile(runtimeVerificationPath, "utf8");

  assert.ok(runtimeVerification.includes("Do not assume the live webhook"));
  assert.ok(runtimeVerification.includes("webhook_entity"));
  assert.ok(runtimeVerification.includes("N8N_BOOKING_TRIGGER_SECRET"));
  assert.ok(runtimeVerification.includes("AI_SES_BACKEND_BASE_URL"));
  assert.ok(runtimeVerification.includes("smoke:n8n-booking-workflow"));
});

test("project-owned n8n workflow assets stay import-safe and do not pin top-level workflow identity metadata", async () => {
  const assets = await readProjectOwnedWorkflowAssets();

  for (const asset of assets) {
    const workflow = parseWorkflow(asset.raw);

    assert.equal(
      Object.hasOwn(workflow, "id"),
      false,
      `${asset.name} must not pin a top-level workflow id`
    );
    assert.equal(
      Object.hasOwn(workflow, "versionId"),
      false,
      `${asset.name} must not pin a top-level workflow versionId`
    );
    assert.equal(
      Object.hasOwn(workflow, "meta"),
      false,
      `${asset.name} must not pin top-level n8n instance metadata`
    );
  }
});

test("project-owned n8n callback workflows keep backend writeback non-fatal and explicit", async () => {
  const assets = await readProjectOwnedWorkflowAssets();

  for (const asset of assets) {
    if (!asset.raw.includes("/v1/webhooks/n8n/")) {
      continue;
    }

    const callbackNodeNames = getCallbackNodeNames(asset.raw);

    assert.ok(
      callbackNodeNames.length >= 1,
      `${asset.name} must keep explicit backend callback nodes`
    );

    for (const nodeName of callbackNodeNames) {
      assert.ok(
        asset.raw.includes(`"name": "${nodeName}",\r\n      "continueOnFail": true`) ||
          asset.raw.includes(`"name": "${nodeName}",\n      "continueOnFail": true`),
        `${asset.name} ${nodeName} must remain non-fatal`
      );
    }

    assert.ok(
      asset.raw.includes('\\"workflowRunId\\": \\"{{ $execution.id }}\\"'),
      `${asset.name} must send workflowRunId in backend callbacks`
    );

    assert.ok(
      asset.raw.includes('\\"callbackAccepted\\": {{ $json.callbackAccepted }}') ||
        asset.raw.includes('\\"callbackAccepted\\": {{ $json.data.received }}'),
      `${asset.name} must keep callbackAccepted explicit in webhook responses`
    );
    assert.ok(
      asset.raw.includes("Normalize Confirmed Callback Result") ||
        asset.raw.includes("Normalize Delivered Callback Result"),
      `${asset.name} must normalize callback results before responding`
    );
  }
});

test("workflow json assets omit instance-bound import metadata", async () => {
  const assets = await readAllWorkflowAssets();

  for (const asset of assets) {
    if (!Array.isArray(asset.workflow.nodes) || !asset.workflow.connections) {
      continue;
    }

    assert.equal(
      Object.hasOwn(asset.workflow, "id"),
      false,
      `${asset.name} must not pin a top-level workflow id`
    );
    assert.equal(
      Object.hasOwn(asset.workflow, "versionId"),
      false,
      `${asset.name} must not pin a top-level workflow versionId`
    );
    assert.equal(
      asset.workflow.meta?.instanceId,
      undefined,
      `${asset.name} must not carry an instance-bound meta.instanceId`
    );
    assert.equal(
      asset.workflow.meta?.templateCredsSetupCompleted,
      undefined,
      `${asset.name} must not carry import-state templateCredsSetupCompleted`
    );
  }
});
