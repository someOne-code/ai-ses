import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";

import {
  LOCAL_DEMO_IDS,
  cleanupLocalDemoData
} from "../scripts/seed-local-demo.ts";
import {
  fetchChainedLocalDemoEvidence,
  prepareChainedLocalDemoState,
  resetChainedLocalDemoState
} from "./helpers/local-demo-chain.ts";

const execFileAsync = promisify(execFile);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, "..");
const envPath = path.join(backendDir, ".env");
const n8nDbPath = path.join(os.homedir(), ".n8n", "database.sqlite");

type EnvMap = Record<string, string>;

type WorkflowListResponse = {
  data: Array<{
    id: string;
    name: string;
    active: boolean;
  }>;
};

type RouteResolution = {
  bookingRouteUrl: string;
  crmRouteUrl: string;
};

type ChainedStubRequest = {
  method: string | undefined;
  url: string | undefined;
  body: Record<string, unknown>;
};

function parseEnv(raw: string) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .reduce<EnvMap>((acc, line) => {
      const separatorIndex = line.indexOf("=");

      if (separatorIndex <= 0) {
        return acc;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      acc[key] = value;
      return acc;
    }, {});
}

async function readBackendEnv() {
  return parseEnv(await readFile(envPath, "utf8"));
}

function requireEnv(env: EnvMap, key: string) {
  const value = env[key];

  assert.ok(value, `Missing ${key} in backend .env`);
  return value;
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : null;

  return { response, json, text };
}

async function resolveWorkflowId(
  baseUrl: string,
  apiKey: string,
  workflowName: string
) {
  const { response, json } = await fetchJson<WorkflowListResponse>(
    `${baseUrl}/api/v1/workflows?limit=250`,
    {
      headers: {
        "X-N8N-API-KEY": apiKey
      }
    }
  );

  assert.equal(response.status, 200, "Failed to list workflows from n8n");
  assert.ok(json);

  const workflow = json.data.find((entry) => entry.name === workflowName);

  assert.ok(workflow, `Workflow ${workflowName} not found in live n8n`);
  assert.equal(workflow.active, true, `${workflowName} must be active in live n8n`);

  return workflow.id;
}

async function resolveWebhookPath(workflowId: string) {
  const query =
    "select webhookPath from webhook_entity where workflowId = '" +
    workflowId +
    "' and method = 'POST' and node = 'Webhook' order by webhookPath limit 1;";
  const { stdout } = await execFileAsync("sqlite3", [n8nDbPath, query]);
  const webhookPath = stdout.trim();

  assert.ok(webhookPath, `No live webhook_entity row found for workflow ${workflowId}`);
  return webhookPath;
}

async function resolveLiveRoutes(
  baseUrl: string,
  apiKey: string
): Promise<RouteResolution> {
  const bookingWorkflowId = await resolveWorkflowId(
    baseUrl,
    apiKey,
    "ai-ses - Booking Flow"
  );
  const crmWorkflowId = await resolveWorkflowId(
    baseUrl,
    apiKey,
    "ai-ses - CRM Sync"
  );
  const bookingWebhookPath = await resolveWebhookPath(bookingWorkflowId);
  const crmWebhookPath = await resolveWebhookPath(crmWorkflowId);

  return {
    bookingRouteUrl: `${baseUrl}/webhook/${bookingWebhookPath}`,
    crmRouteUrl: `${baseUrl}/webhook/${crmWebhookPath}`
  };
}

async function withChainedStub<T>(
  run: (stubBaseUrl: string) => Promise<T>
): Promise<{ result: T; receivedRequests: ChainedStubRequest[] }> {
  const receivedRequests: ChainedStubRequest[] = [];
  const server = createServer((request, response) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      const parsedBody = body ? (JSON.parse(body) as Record<string, unknown>) : {};

      receivedRequests.push({
        method: request.method,
        url: request.url,
        body: parsedBody
      });
      response.setHeader("Content-Type", "application/json");

      if (request.url === "/availability") {
        response.end(
          JSON.stringify({
            available: true,
            scheduledDatetime: "2026-03-27T14:30:00+03:00"
          })
        );
        return;
      }

      if (request.url === "/booking") {
        response.end(
          JSON.stringify({
            booked: true,
            externalBookingId: "booking-chain-local-1",
            scheduledDatetime: "2026-03-27T14:30:00+03:00",
            note: "Local chained smoke: booking confirmed."
          })
        );
        return;
      }

      if (request.url === "/crm-delivery") {
        response.end(
          JSON.stringify({
            id: "crm-chain-local-1",
            note: "Local chained smoke: CRM delivery accepted."
          })
        );
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found", path: request.url }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  assert.ok(address && typeof address !== "string");

  try {
    const result = await run(`http://127.0.0.1:${address.port}`);
    return { result, receivedRequests };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 8000
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for chained condition.`);
}

const smokeSkipReason =
  process.env.RUN_N8N_SMOKE_TESTS === "1"
    ? process.env.N8N_BOOKING_TRIGGER_SECRET
      ? false
      : "N8N_BOOKING_TRIGGER_SECRET is required for live chained smoke tests"
    : "RUN_N8N_SMOKE_TESTS=1 is required for live chained smoke tests";

test(
  "live n8n booking and crm workflows prove a chained local backend flow on the demo seed",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const bookingTriggerSecret = process.env.N8N_BOOKING_TRIGGER_SECRET as string;
    const { bookingRouteUrl, crmRouteUrl } = await resolveLiveRoutes(baseUrl, apiKey);
    const crmTriggerPath = new URL(crmRouteUrl).pathname;

    assert.notEqual(
      bookingRouteUrl,
      `${baseUrl}/webhook/ai-ses-booking-flow`,
      "Chained smoke must use the live booking route, not a guessed path"
    );
    assert.notEqual(
      crmRouteUrl,
      `${baseUrl}/webhook/ai-ses-crm-sync`,
      "Chained smoke must use the live CRM route, not a guessed path"
    );

    await cleanupLocalDemoData().catch(() => undefined);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      const { result: bookingResponse, receivedRequests } = await withChainedStub(
        async (stubBaseUrl) => {
          await prepareChainedLocalDemoState(
            {
              bookingAvailabilityUrl: `${stubBaseUrl}/availability`,
              bookingUrl: `${stubBaseUrl}/booking`,
              crmTriggerPath,
              crmDeliveryUrl: `${stubBaseUrl}/crm-delivery`
            }
          );

          return fetchJson<{
            accepted: boolean;
            workflow: string;
            officeId: string;
            showingRequestId: string;
            status: string;
            callbackAccepted: boolean;
          }>(bookingRouteUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ai-ses-trigger-secret": bookingTriggerSecret
            },
            body: JSON.stringify({
              kind: "booking_workflow",
              office: {
                officeId: LOCAL_DEMO_IDS.officeId
              },
              showingRequest: {
                id: LOCAL_DEMO_IDS.showingRequestId,
                preferredDatetime: "2026-03-27T14:30:00+03:00"
              },
              connection: {
                id: LOCAL_DEMO_IDS.bookingConnectionId,
                config: {
                  availabilityUrl: `${stubBaseUrl}/availability`,
                  bookingUrl: `${stubBaseUrl}/booking`,
                  durationMinutes: 30,
                  confirmationDelaySeconds: 0
                }
              }
            })
          });
        }
      );

      assert.equal(bookingResponse.response.status, 200);
      assert.deepEqual(bookingResponse.json, {
        accepted: true,
        workflow: "ai-ses - Booking Flow",
        officeId: LOCAL_DEMO_IDS.officeId,
        showingRequestId: LOCAL_DEMO_IDS.showingRequestId,
        status: "confirmed",
        callbackAccepted: true
      });

      await waitForCondition(async () => {
        const evidence = await fetchChainedLocalDemoEvidence();

        return (
          evidence.showingRequest?.status === "confirmed" &&
          evidence.auditRows.some(
            (row) =>
              row.action === "crm_delivery_result_recorded" &&
              row.entityId === LOCAL_DEMO_IDS.showingRequestId &&
              row.eventType === "showing_booking_confirmed" &&
              row.status === null
          )
        );
      });

      const requestUrls = receivedRequests.map((entry) => entry.url);
      assert.ok(
        requestUrls.includes("/availability"),
        "Expected availability request"
      );
      assert.ok(requestUrls.includes("/booking"), "Expected booking request");
      assert.ok(
        requestUrls.includes("/crm-delivery"),
        "Expected CRM delivery request"
      );

      const showingRequest = await client.query<{ status: string }>(
        `select status
         from showing_requests
         where id = $1`,
        [LOCAL_DEMO_IDS.showingRequestId]
      );

      assert.equal(showingRequest.rows[0]?.status, "confirmed");

      const bookingAudit = await client.query<{
        action: string;
        status: string | null;
        showing_request_id: string | null;
        note: string | null;
        scheduled_datetime: string | null;
      }>(
        `select action,
                payload->>'status' as status,
                payload->>'showingRequestId' as showing_request_id,
                payload->>'note' as note,
                payload->>'scheduledDatetime' as scheduled_datetime
         from audit_events
         where office_id = $1
           and action = 'booking_result_recorded'
         order by created_at desc
         limit 1`,
        [LOCAL_DEMO_IDS.officeId]
      );

      assert.equal(bookingAudit.rows[0]?.action, "booking_result_recorded");
      assert.equal(bookingAudit.rows[0]?.status, "confirmed");
      assert.equal(
        bookingAudit.rows[0]?.showing_request_id,
        LOCAL_DEMO_IDS.showingRequestId
      );
      assert.equal(
        bookingAudit.rows[0]?.note,
        "Local chained smoke: booking confirmed."
      );
      assert.equal(
        bookingAudit.rows[0]?.scheduled_datetime,
        "2026-03-27T14:30:00+03:00"
      );

      const crmAudit = await client.query<{
        action: string;
        delivery_status: string | null;
        event_type: string | null;
        entity_type: string | null;
        entity_id: string | null;
        note: string | null;
        external_record_id: string | null;
      }>(
        `select action,
                payload->>'deliveryStatus' as delivery_status,
                payload->>'eventType' as event_type,
                payload->>'entityType' as entity_type,
                payload->>'entityId' as entity_id,
                payload->>'note' as note,
                payload->>'externalRecordId' as external_record_id
         from audit_events
         where office_id = $1
           and action = 'crm_delivery_result_recorded'
         order by created_at desc
         limit 1`,
        [LOCAL_DEMO_IDS.officeId]
      );

      assert.equal(crmAudit.rows[0]?.action, "crm_delivery_result_recorded");
      assert.equal(crmAudit.rows[0]?.delivery_status, "delivered");
      assert.equal(crmAudit.rows[0]?.event_type, "showing_booking_confirmed");
      assert.equal(crmAudit.rows[0]?.entity_type, "showing_request");
      assert.equal(crmAudit.rows[0]?.entity_id, LOCAL_DEMO_IDS.showingRequestId);
      assert.equal(
        crmAudit.rows[0]?.note,
        "Local chained smoke: CRM delivery accepted."
      );
      assert.equal(crmAudit.rows[0]?.external_record_id, "crm-chain-local-1");
    } finally {
      await client.end();
      await resetChainedLocalDemoState().catch(() => undefined);
      await cleanupLocalDemoData();
    }
  }
);
