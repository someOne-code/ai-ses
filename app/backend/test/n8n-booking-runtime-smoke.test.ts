import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";

import { seedLocalDemoData } from "../scripts/seed-local-demo.ts";
import { buildUniqueGoogleSmokeSlot } from "./helpers/google-provider-smoke.ts";
import {
  prepareGoogleCalendarCredentialRepair,
  REQUIRED_GOOGLE_CALENDAR_NODE_NAMES
} from "./helpers/google-calendar-credential-guard.ts";

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

type WorkflowDetailResponse = {
  id: string;
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

type ExecutionListResponse = {
  data: Array<{
    id: string;
    startedAt: string;
    workflowId: string;
    status: string;
  }>;
};

type ExecutionDetailResponse = {
  id: string;
  data?: {
    resultData?: {
      runData?: Record<
        string,
        Array<{
          data?: {
            main?: Array<Array<{ json: Record<string, unknown> }>>;
          };
        }>
      >;
    };
  };
};

type ClaimedSmokeOffice = {
  officeId: string;
  deactivatedConnectionIds: string[];
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

async function ensureGoogleCalendarNodeCredentials(
  baseUrl: string,
  apiKey: string,
  workflowId: string
) {
  const headers = {
    "X-N8N-API-KEY": apiKey,
    "Content-Type": "application/json"
  };
  const { response, json } = await fetchJson<WorkflowDetailResponse>(
    `${baseUrl}/api/v1/workflows/${workflowId}`,
    { headers }
  );

  assert.equal(response.status, 200, `Failed to fetch workflow ${workflowId}`);
  assert.ok(json);

  const { sourceCredential, repairedNodeNames, updatedNodes } =
    prepareGoogleCalendarCredentialRepair(workflowId, json.nodes);

  if (repairedNodeNames.length === 0) {
    return;
  }

  const updateResponse = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      name: json.name,
      nodes: updatedNodes,
      connections: json.connections,
      settings: json.settings ?? {}
    })
  });

  assert.equal(
    updateResponse.status,
    200,
    `Failed to update workflow ${workflowId} with missing Google credentials`
  );

  const updatedWorkflow = (await updateResponse.json()) as WorkflowDetailResponse;

  for (const nodeName of REQUIRED_GOOGLE_CALENDAR_NODE_NAMES) {
    const updatedNode = updatedWorkflow.nodes.find((node) => {
      const typedNode = node as {
        name?: string;
        credentials?: {
          googleCalendarOAuth2Api?: { id: string; name: string };
        };
      };

      return typedNode.name === nodeName;
    }) as
      | {
          credentials?: {
            googleCalendarOAuth2Api?: { id: string; name: string };
          };
        }
      | undefined;

    assert.ok(updatedNode, `Workflow ${workflowId} must still include ${nodeName}`);
    assert.deepEqual(
      updatedNode.credentials?.googleCalendarOAuth2Api,
      sourceCredential,
      `Workflow ${workflowId} must persist the Google credential on ${nodeName}`
    );
  }
}

function getRequiredGoogleCalendarNodeNames(execution: ExecutionDetailResponse) {
  return REQUIRED_GOOGLE_CALENDAR_NODE_NAMES.filter(
    (nodeName) => getNodeJsonOutput(execution, nodeName) !== null
  );
}

async function assertGoogleCalendarExecutionNodeSet(
  execution: ExecutionDetailResponse,
  expectedNodeNames: string[]
) {
  assert.deepEqual(
    getRequiredGoogleCalendarNodeNames(execution),
    expectedNodeNames
  );
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

async function listWorkflowExecutions(
  baseUrl: string,
  apiKey: string,
  workflowId: string
) {
  const { response, json } = await fetchJson<ExecutionListResponse>(
    `${baseUrl}/api/v1/executions?limit=20&workflowId=${workflowId}`,
    {
      headers: {
        "X-N8N-API-KEY": apiKey
      }
    }
  );

  assert.equal(response.status, 200, "Failed to list executions from n8n");
  assert.ok(json);

  return json.data;
}

async function getExecutionDetail(
  baseUrl: string,
  apiKey: string,
  executionId: string
) {
  const { response, json } = await fetchJson<ExecutionDetailResponse>(
    `${baseUrl}/api/v1/executions/${executionId}?includeData=true`,
    {
      headers: {
        "X-N8N-API-KEY": apiKey
      }
    }
  );

  assert.equal(response.status, 200, `Failed to fetch execution ${executionId}`);
  assert.ok(json);

  return json;
}

async function waitForExecutionAfter(
  baseUrl: string,
  apiKey: string,
  workflowId: string,
  startedAfter: number,
  timeoutMs = 20000,
  matches?: (execution: ExecutionDetailResponse) => boolean
) {
  const startedAt = Date.now();
  const checkedIds = new Set<string>();

  while (Date.now() - startedAt < timeoutMs) {
    const executions = await listWorkflowExecutions(baseUrl, apiKey, workflowId);

    for (const execution of executions) {
      if (new Date(execution.startedAt).getTime() < startedAfter) {
        continue;
      }

      if (!matches) {
        return execution.id;
      }

      if (checkedIds.has(execution.id)) {
        continue;
      }

      const detail = await getExecutionDetail(baseUrl, apiKey, execution.id);
      checkedIds.add(execution.id);

      if (matches(detail)) {
        return execution.id;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for workflow execution.`);
}

function getNodeJsonOutput(
  execution: ExecutionDetailResponse,
  nodeName: string
) {
  const runItems = execution.data?.resultData?.runData?.[nodeName] ?? [];
  const firstRun = runItems[0];
  const main = firstRun?.data?.main ?? [];

  return main[0]?.[0]?.json ?? null;
}

async function claimSmokeOffice(client: Client): Promise<ClaimedSmokeOffice> {
  const withoutActiveConnection = await client.query<{
    office_id: string;
  }>(
    `select o.id as office_id
     from offices o
     where o.status = 'active'
       and not exists (
         select 1
         from integration_connections ic
         where ic.office_id = o.id
           and ic.kind = 'booking_workflow'
           and ic.status = 'active'
       )
     order by o.created_at
     limit 1`
  );

  const officeIdWithoutActiveConnection = withoutActiveConnection.rows[0]?.office_id;

  if (officeIdWithoutActiveConnection) {
    return {
      officeId: officeIdWithoutActiveConnection,
      deactivatedConnectionIds: []
    };
  }

  const fallbackOffice = await client.query<{
    office_id: string;
  }>(
    `select id as office_id
     from offices
     where status = 'active'
     order by created_at
     limit 1`
  );
  const officeId = fallbackOffice.rows[0]?.office_id;

  assert.ok(officeId, "At least one active office is required for smoke tests");

  const existingConnections = await client.query<{
    id: string;
  }>(
    `select id
     from integration_connections
     where office_id = $1
       and kind = 'booking_workflow'
       and status = 'active'
     order by created_at`,
    [officeId]
  );
  const deactivatedConnectionIds = existingConnections.rows.map((row) => row.id);

  if (deactivatedConnectionIds.length > 0) {
    await client.query(
      `update integration_connections
       set status = 'inactive',
           updated_at = now()
       where id = any($1::uuid[])`,
      [deactivatedConnectionIds]
    );
  }

  return {
    officeId,
    deactivatedConnectionIds
  };
}

async function withBookingStub<T>(
  input: {
    availabilityResponse: Record<string, unknown>;
    bookingResponse: Record<string, unknown>;
    availabilityStatusCode?: number;
    bookingStatusCode?: number;
  },
  run: (stubBaseUrl: string) => Promise<T>
) {
  const receivedRequests: Array<{
    method: string | undefined;
    url: string | undefined;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer((request, response) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      receivedRequests.push({
        method: request.method,
        url: request.url,
        body: body ? (JSON.parse(body) as Record<string, unknown>) : {}
      });

      if (request.url === "/availability") {
        response.statusCode = input.availabilityStatusCode ?? 200;
        response.end(JSON.stringify(input.availabilityResponse));
        return;
      }

      if (request.url === "/booking") {
        response.statusCode = input.bookingStatusCode ?? 200;
        response.end(JSON.stringify(input.bookingResponse));
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

const smokeSkipReason =
  process.env.RUN_N8N_SMOKE_TESTS === "1"
    ? process.env.N8N_BOOKING_TRIGGER_SECRET
      ? false
      : "N8N_BOOKING_TRIGGER_SECRET is required for live n8n smoke tests"
    : "RUN_N8N_SMOKE_TESTS=1 is required for live n8n smoke tests";

const providerSmokeSkipReason =
  process.env.RUN_N8N_PROVIDER_SMOKE_TESTS === "1"
    ? process.env.N8N_BOOKING_TRIGGER_SECRET
      ? false
      : "N8N_BOOKING_TRIGGER_SECRET is required for Google Calendar provider smoke tests"
    : "RUN_N8N_PROVIDER_SMOKE_TESTS=1 is required for Google Calendar provider smoke tests";

const providerSuccessSmokeSkipReason =
  process.env.RUN_N8N_PROVIDER_SMOKE_TESTS === "1"
    ? process.env.N8N_BOOKING_TRIGGER_SECRET
      ? process.env.N8N_GOOGLE_CALENDAR_ID
        ? false
        : "N8N_GOOGLE_CALENDAR_ID is required for the real Google Calendar success smoke"
      : "N8N_BOOKING_TRIGGER_SECRET is required for Google Calendar provider smoke tests"
    : "RUN_N8N_PROVIDER_SMOKE_TESTS=1 is required for Google Calendar provider smoke tests";

test(
  "live n8n booking workflow resolves actual webhook path and rejects wrong trigger secret",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const workflowId = await resolveWorkflowId(
      baseUrl,
      apiKey,
      "ai-ses - Booking Flow"
    );
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    assert.ok(webhookPath.trim() !== "", "Live booking webhook path must resolve");
    assert.equal(
      routeUrl,
      `${baseUrl}/webhook/${webhookPath}`,
      "Smoke tests must use the live registered route resolved from n8n"
    );

    const { response, json } = await fetchJson<{
      accepted: boolean;
      error: { code: string; message: string };
    }>(routeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ai-ses-trigger-secret": "wrong-secret"
      },
      body: JSON.stringify({ kind: "booking_workflow" })
    });

    assert.equal(response.status, 401);
    assert.deepEqual(json, {
      accepted: false,
      workflow: "ai-ses - Booking Flow",
      error: {
        code: "BOOKING_TRIGGER_FORBIDDEN",
        message: "Invalid booking workflow trigger secret."
      }
    });
  }
);

test(
  "live n8n booking workflow reaches unavailable callback branch with the correct trigger secret",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_BOOKING_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(
      baseUrl,
      apiKey,
      "ai-ses - Booking Flow"
    );
    await ensureGoogleCalendarNodeCredentials(baseUrl, apiKey, workflowId);
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const claimedOffice = await claimSmokeOffice(client);
    const officeId = claimedOffice.officeId;

    const listingId = randomUUID();
    const showingRequestId = randomUUID();
    const connectionId = randomUUID();

    try {
      const { result: smokeResponse, receivedRequests } = await withBookingStub(
        {
          availabilityResponse: {
            available: false,
            note: "Local smoke: slot unavailable.",
            alternateSlots: [{ startTime: "2026-03-26T17:00:00+03:00" }]
          },
          bookingResponse: {
            booked: true,
            scheduledDatetime: "2026-03-26T17:00:00+03:00",
            note: "Local smoke booking created."
          }
        },
        async (stubBaseUrl) => {
          await client.query(
            `insert into listings (
               id, office_id, reference_code, title, status, currency
             ) values ($1, $2, $3, $4, 'active', 'TRY')
             on conflict (office_id, reference_code) do update
             set title = excluded.title,
                 status = 'active',
                 id = excluded.id`,
            [
              listingId,
              officeId,
              `SMOKE-BOOKING-RUNTIME-${showingRequestId}`,
              "Smoke Booking Listing"
            ]
          );

          await client.query(
            `insert into showing_requests (
               id, office_id, listing_id, customer_name, customer_phone, preferred_datetime, status
             ) values ($1, $2, $3, $4, $5, $6, 'pending')
             on conflict (id) do update
             set office_id = excluded.office_id,
                 listing_id = excluded.listing_id,
                 customer_name = excluded.customer_name,
                 customer_phone = excluded.customer_phone,
                 preferred_datetime = excluded.preferred_datetime,
                 status = 'pending'`,
            [
              showingRequestId,
              officeId,
              listingId,
              "Smoke Tester",
              "+905555555555",
              "2026-03-26T12:00:00.000Z"
            ]
          );

          await client.query(
            `insert into integration_connections (
               id, office_id, kind, status, config
             ) values ($1, $2, 'booking_workflow', 'active', $3::jsonb)
             on conflict (id) do update
             set office_id = excluded.office_id,
                 status = 'active',
                 config = excluded.config,
                 updated_at = now()`,
            [
              connectionId,
              officeId,
              JSON.stringify({
                availabilityUrl: `${stubBaseUrl}/availability`,
                bookingUrl: `${stubBaseUrl}/booking`
              })
            ]
          );

          return fetchJson<{
            accepted: boolean;
            workflow: string;
            officeId: string;
            showingRequestId: string;
            status: string;
            callbackAccepted: boolean;
          }>(routeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ai-ses-trigger-secret": triggerSecret
            },
            body: JSON.stringify({
              kind: "booking_workflow",
              office: { officeId },
              showingRequest: {
                id: showingRequestId,
                preferredDatetime: "2026-03-26T15:00:00+03:00"
              },
              connection: {
                id: connectionId,
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

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - Booking Flow",
        officeId,
        showingRequestId,
        status: "failed",
        callbackAccepted: true
      });

      assert.equal(receivedRequests.length, 1);
      assert.equal(receivedRequests[0]?.url, "/availability");

      const showingRequest = await client.query<{ status: string }>(
        `select status
         from showing_requests
         where id = $1`,
        [showingRequestId]
      );

      assert.equal(showingRequest.rows[0]?.status, "failed");

      const auditEvent = await client.query<{
        action: string;
        status: string | null;
        note: string | null;
      }>(
        `select action,
                payload->>'status' as status,
                payload->>'note' as note
         from audit_events
         where office_id = $1
           and action = 'booking_result_recorded'
         order by created_at desc
         limit 1`,
        [officeId]
      );

      assert.equal(auditEvent.rows[0]?.action, "booking_result_recorded");
      assert.equal(auditEvent.rows[0]?.status, "failed");
      assert.equal(auditEvent.rows[0]?.note, "Local smoke: slot unavailable.");
    } finally {
      await client.query(
        `delete from integration_connections
         where id = $1`,
        [connectionId]
      );
      await client.query(
        `delete from showing_requests
         where id = $1`,
        [showingRequestId]
      );
      await client.query(
        `delete from listings
         where id = $1`,
        [listingId]
      );
      if (claimedOffice.deactivatedConnectionIds.length > 0) {
        await client.query(
          `update integration_connections
           set status = 'active',
               updated_at = now()
           where id = any($1::uuid[])`,
          [claimedOffice.deactivatedConnectionIds]
        );
      }
      await client.end();
    }
  }
);

test(
  "live n8n booking workflow records a failed result when availability returns non-2xx",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_BOOKING_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(
      baseUrl,
      apiKey,
      "ai-ses - Booking Flow"
    );
    await ensureGoogleCalendarNodeCredentials(baseUrl, apiKey, workflowId);
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const claimedOffice = await claimSmokeOffice(client);
    const officeId = claimedOffice.officeId;

    const listingId = randomUUID();
    const showingRequestId = randomUUID();
    const connectionId = randomUUID();

    try {
      const { result: smokeResponse, receivedRequests } = await withBookingStub(
        {
          availabilityStatusCode: 500,
          availabilityResponse: {
            code: "availability_provider_failed",
            message: 'Local smoke: availability provider returned 500 with "quoted" detail.'
          },
          bookingResponse: {
            booked: true,
            scheduledDatetime: "2026-03-26T17:00:00+03:00"
          }
        },
        async (stubBaseUrl) => {
          await client.query(
            `insert into listings (
               id, office_id, reference_code, title, status, currency
             ) values ($1, $2, $3, $4, 'active', 'TRY')
             on conflict (office_id, reference_code) do update
             set title = excluded.title,
                 status = 'active',
                 id = excluded.id`,
            [
              listingId,
              officeId,
              `SMOKE-BOOKING-AVAILABILITY-ERROR-${showingRequestId}`,
              "Smoke Booking Availability Error Listing"
            ]
          );

          await client.query(
            `insert into showing_requests (
               id, office_id, listing_id, customer_name, customer_phone, preferred_datetime, status
             ) values ($1, $2, $3, $4, $5, $6, 'pending')
             on conflict (id) do update
             set office_id = excluded.office_id,
                 listing_id = excluded.listing_id,
                 customer_name = excluded.customer_name,
                 customer_phone = excluded.customer_phone,
                 preferred_datetime = excluded.preferred_datetime,
                 status = 'pending'`,
            [
              showingRequestId,
              officeId,
              listingId,
              "Smoke Availability Error Tester",
              "+905555555557",
              "2026-03-26T13:00:00.000Z"
            ]
          );

          await client.query(
            `insert into integration_connections (
               id, office_id, kind, status, config
             ) values ($1, $2, 'booking_workflow', 'active', $3::jsonb)
             on conflict (id) do update
             set office_id = excluded.office_id,
                 status = 'active',
                 config = excluded.config,
                 updated_at = now()`,
            [
              connectionId,
              officeId,
              JSON.stringify({
                availabilityUrl: `${stubBaseUrl}/availability`,
                bookingUrl: `${stubBaseUrl}/booking`
              })
            ]
          );

          return fetchJson<{
            accepted: boolean;
            workflow: string;
            officeId: string;
            showingRequestId: string;
            status: string;
            callbackAccepted: boolean;
          }>(routeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ai-ses-trigger-secret": triggerSecret
            },
            body: JSON.stringify({
              kind: "booking_workflow",
              office: { officeId },
              showingRequest: {
                id: showingRequestId,
                preferredDatetime: "2026-03-26T16:00:00+03:00"
              },
              connection: {
                id: connectionId,
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

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - Booking Flow",
        officeId,
        showingRequestId,
        status: "failed",
        callbackAccepted: true
      });

      assert.equal(receivedRequests.length, 1);
      assert.equal(receivedRequests[0]?.url, "/availability");

      const showingRequest = await client.query<{ status: string }>(
        `select status
         from showing_requests
         where id = $1`,
        [showingRequestId]
      );

      assert.equal(showingRequest.rows[0]?.status, "failed");

      const auditEvent = await client.query<{
        action: string;
        status: string | null;
        note: string | null;
      }>(
        `select action,
                payload->>'status' as status,
                payload->>'note' as note
         from audit_events
         where office_id = $1
           and action = 'booking_result_recorded'
         order by created_at desc
         limit 1`,
        [officeId]
      );

      assert.equal(auditEvent.rows[0]?.action, "booking_result_recorded");
      assert.equal(auditEvent.rows[0]?.status, "failed");
      assert.equal(
        auditEvent.rows[0]?.note,
        'Local smoke: availability provider returned 500 with "quoted" detail.'
      );
    } finally {
      await client.query(
        `delete from integration_connections
         where id = $1`,
        [connectionId]
      );
      await client.query(
        `delete from showing_requests
         where id = $1`,
        [showingRequestId]
      );
      await client.query(
        `delete from listings
         where id = $1`,
        [listingId]
      );
      if (claimedOffice.deactivatedConnectionIds.length > 0) {
        await client.query(
          `update integration_connections
           set status = 'active',
               updated_at = now()
           where id = any($1::uuid[])`,
          [claimedOffice.deactivatedConnectionIds]
        );
      }
      await client.end();
    }
  }
);

test(
  "live n8n booking workflow reaches confirmed callback branch with the correct trigger secret",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_BOOKING_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(
      baseUrl,
      apiKey,
      "ai-ses - Booking Flow"
    );
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const claimedOffice = await claimSmokeOffice(client);
    const officeId = claimedOffice.officeId;

    const listingId = randomUUID();
    const showingRequestId = randomUUID();
    const connectionId = randomUUID();

    try {
      const { result: smokeResponse, receivedRequests } = await withBookingStub(
        {
          availabilityResponse: {
            available: true,
            scheduledDatetime: "2026-03-26T18:00:00+03:00"
          },
          bookingResponse: {
            booked: true,
            scheduledDatetime: "2026-03-26T18:00:00+03:00",
            note: "Local smoke: booking confirmed."
          }
        },
        async (stubBaseUrl) => {
          await client.query(
            `insert into listings (
               id, office_id, reference_code, title, status, currency
             ) values ($1, $2, $3, $4, 'active', 'TRY')
             on conflict (office_id, reference_code) do update
             set title = excluded.title,
                 status = 'active',
                 id = excluded.id`,
            [
              listingId,
              officeId,
              `SMOKE-BOOKING-CONFIRMED-${showingRequestId}`,
              "Smoke Booking Listing Confirmed"
            ]
          );

          await client.query(
            `insert into showing_requests (
               id, office_id, listing_id, customer_name, customer_phone, preferred_datetime, status
             ) values ($1, $2, $3, $4, $5, $6, 'pending')
             on conflict (id) do update
             set office_id = excluded.office_id,
                 listing_id = excluded.listing_id,
                 customer_name = excluded.customer_name,
                 customer_phone = excluded.customer_phone,
                 preferred_datetime = excluded.preferred_datetime,
                 status = 'pending'`,
            [
              showingRequestId,
              officeId,
              listingId,
              "Smoke Confirmed Tester",
              "+905555555556",
              "2026-03-26T15:30:00.000Z"
            ]
          );

          await client.query(
            `insert into integration_connections (
               id, office_id, kind, status, config
             ) values ($1, $2, 'booking_workflow', 'active', $3::jsonb)
             on conflict (id) do update
             set office_id = excluded.office_id,
                 status = 'active',
                 config = excluded.config,
                 updated_at = now()`,
            [
              connectionId,
              officeId,
              JSON.stringify({
                availabilityUrl: `${stubBaseUrl}/availability`,
                bookingUrl: `${stubBaseUrl}/booking`
              })
            ]
          );

          return fetchJson<{
            accepted: boolean;
            workflow: string;
            officeId: string;
            showingRequestId: string;
            status: string;
            callbackAccepted: boolean;
          }>(routeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ai-ses-trigger-secret": triggerSecret
            },
            body: JSON.stringify({
              kind: "booking_workflow",
              office: { officeId },
              showingRequest: {
                id: showingRequestId,
                preferredDatetime: "2026-03-26T18:00:00+03:00"
              },
              connection: {
                id: connectionId,
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

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - Booking Flow",
        officeId,
        showingRequestId,
        status: "confirmed",
        callbackAccepted: true
      });

      assert.equal(receivedRequests.length, 2);
      assert.equal(receivedRequests[0]?.url, "/availability");
      assert.equal(receivedRequests[1]?.url, "/booking");

      const showingRequest = await client.query<{ status: string }>(
        `select status
         from showing_requests
         where id = $1`,
        [showingRequestId]
      );

      assert.equal(showingRequest.rows[0]?.status, "confirmed");

      const auditEvent = await client.query<{
        action: string;
        status: string | null;
        note: string | null;
        scheduled_datetime: string | null;
      }>(
        `select action,
                payload->>'status' as status,
                payload->>'note' as note,
                payload->>'scheduledDatetime' as scheduled_datetime
         from audit_events
         where office_id = $1
           and action = 'booking_result_recorded'
         order by created_at desc
         limit 1`,
        [officeId]
      );

      assert.equal(auditEvent.rows[0]?.action, "booking_result_recorded");
      assert.equal(auditEvent.rows[0]?.status, "confirmed");
      assert.equal(
        auditEvent.rows[0]?.note,
        "Local smoke: booking confirmed."
      );
      assert.equal(
        auditEvent.rows[0]?.scheduled_datetime,
        "2026-03-26T18:00:00+03:00"
      );
    } finally {
      await client.query(
        `delete from integration_connections
         where id = $1`,
        [connectionId]
      );
      await client.query(
        `delete from showing_requests
         where id = $1`,
        [showingRequestId]
      );
      await client.query(
        `delete from listings
         where id = $1`,
        [listingId]
      );
      if (claimedOffice.deactivatedConnectionIds.length > 0) {
        await client.query(
          `update integration_connections
           set status = 'active',
               updated_at = now()
           where id = any($1::uuid[])`,
          [claimedOffice.deactivatedConnectionIds]
        );
      }
      await client.end();
    }
  }
);

test(
  "live n8n booking workflow records a failed result when booking returns non-2xx",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_BOOKING_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(
      baseUrl,
      apiKey,
      "ai-ses - Booking Flow"
    );
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const claimedOffice = await claimSmokeOffice(client);
    const officeId = claimedOffice.officeId;

    const listingId = randomUUID();
    const showingRequestId = randomUUID();
    const connectionId = randomUUID();

    try {
      const { result: smokeResponse, receivedRequests } = await withBookingStub(
        {
          availabilityResponse: {
            available: true,
            scheduledDatetime: "2026-03-26T19:00:00+03:00"
          },
          bookingStatusCode: 502,
          bookingResponse: {
            code: "booking_provider_failed",
            message: 'Local smoke: booking provider returned 502 with "quoted" detail.'
          }
        },
        async (stubBaseUrl) => {
          await client.query(
            `insert into listings (
               id, office_id, reference_code, title, status, currency
             ) values ($1, $2, $3, $4, 'active', 'TRY')
             on conflict (office_id, reference_code) do update
             set title = excluded.title,
                 status = 'active',
                 id = excluded.id`,
            [
              listingId,
              officeId,
              `SMOKE-BOOKING-CREATE-ERROR-${showingRequestId}`,
              "Smoke Booking Create Error Listing"
            ]
          );

          await client.query(
            `insert into showing_requests (
               id, office_id, listing_id, customer_name, customer_phone, preferred_datetime, status
             ) values ($1, $2, $3, $4, $5, $6, 'pending')
             on conflict (id) do update
             set office_id = excluded.office_id,
                 listing_id = excluded.listing_id,
                 customer_name = excluded.customer_name,
                 customer_phone = excluded.customer_phone,
                 preferred_datetime = excluded.preferred_datetime,
                 status = 'pending'`,
            [
              showingRequestId,
              officeId,
              listingId,
              "Smoke Booking Create Error Tester",
              "+905555555558",
              "2026-03-26T14:00:00.000Z"
            ]
          );

          await client.query(
            `insert into integration_connections (
               id, office_id, kind, status, config
             ) values ($1, $2, 'booking_workflow', 'active', $3::jsonb)
             on conflict (id) do update
             set office_id = excluded.office_id,
                 status = 'active',
                 config = excluded.config,
                 updated_at = now()`,
            [
              connectionId,
              officeId,
              JSON.stringify({
                availabilityUrl: `${stubBaseUrl}/availability`,
                bookingUrl: `${stubBaseUrl}/booking`
              })
            ]
          );

          return fetchJson<{
            accepted: boolean;
            workflow: string;
            officeId: string;
            showingRequestId: string;
            status: string;
            callbackAccepted: boolean;
          }>(routeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ai-ses-trigger-secret": triggerSecret
            },
            body: JSON.stringify({
              kind: "booking_workflow",
              office: { officeId },
              showingRequest: {
                id: showingRequestId,
                preferredDatetime: "2026-03-26T19:00:00+03:00"
              },
              connection: {
                id: connectionId,
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

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - Booking Flow",
        officeId,
        showingRequestId,
        status: "failed",
        callbackAccepted: true
      });

      assert.equal(receivedRequests.length, 2);
      assert.equal(receivedRequests[0]?.url, "/availability");
      assert.equal(receivedRequests[1]?.url, "/booking");

      const showingRequest = await client.query<{ status: string }>(
        `select status
         from showing_requests
         where id = $1`,
        [showingRequestId]
      );

      assert.equal(showingRequest.rows[0]?.status, "failed");

      const auditEvent = await client.query<{
        action: string;
        status: string | null;
        note: string | null;
      }>(
        `select action,
                payload->>'status' as status,
                payload->>'note' as note
         from audit_events
         where office_id = $1
           and action = 'booking_result_recorded'
         order by created_at desc
         limit 1`,
        [officeId]
      );

      assert.equal(auditEvent.rows[0]?.action, "booking_result_recorded");
      assert.equal(auditEvent.rows[0]?.status, "failed");
      assert.equal(
        auditEvent.rows[0]?.note,
        'Local smoke: booking provider returned 502 with "quoted" detail.'
      );
    } finally {
      await client.query(
        `delete from integration_connections
         where id = $1`,
        [connectionId]
      );
      await client.query(
        `delete from showing_requests
         where id = $1`,
        [showingRequestId]
      );
      await client.query(
        `delete from listings
         where id = $1`,
        [listingId]
      );
      if (claimedOffice.deactivatedConnectionIds.length > 0) {
        await client.query(
          `update integration_connections
           set status = 'active',
               updated_at = now()
           where id = any($1::uuid[])`,
          [claimedOffice.deactivatedConnectionIds]
        );
      }
      await client.end();
    }
  }
);

test(
  "live n8n booking workflow creates a real Google Calendar event and preserves backend writeback",
  { skip: providerSuccessSmokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_BOOKING_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(
      baseUrl,
      apiKey,
      "ai-ses - Booking Flow"
    );
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    let claimedOffice: ClaimedSmokeOffice | null = null;
    const listingId = randomUUID();
    const showingRequestId = randomUUID();
    const connectionId = randomUUID();
    const calendarId = process.env.N8N_GOOGLE_CALENDAR_ID as string;
    const { preferredDatetime, preferredDatetimeUtc } =
      buildUniqueGoogleSmokeSlot(showingRequestId);
    const executionStartedAfter = Date.now();

    try {
      await seedLocalDemoData();
      await client.connect();
      claimedOffice = await claimSmokeOffice(client);
      const officeId = claimedOffice.officeId;

      await client.query(
        `insert into listings (
           id, office_id, reference_code, title, status, currency
         ) values ($1, $2, $3, $4, 'active', 'TRY')
         on conflict (office_id, reference_code) do update
         set title = excluded.title,
             status = 'active',
             id = excluded.id`,
        [
          listingId,
          officeId,
          `SMOKE-GCAL-CONFIRMED-${showingRequestId}`,
          "Smoke Google Calendar Listing"
        ]
      );

      await client.query(
        `insert into showing_requests (
           id, office_id, listing_id, customer_name, customer_phone, preferred_datetime, status
         ) values ($1, $2, $3, $4, $5, $6, 'pending')
         on conflict (id) do update
         set office_id = excluded.office_id,
             listing_id = excluded.listing_id,
             customer_name = excluded.customer_name,
             customer_phone = excluded.customer_phone,
             preferred_datetime = excluded.preferred_datetime,
             status = 'pending'`,
        [
          showingRequestId,
          officeId,
          listingId,
          "Smoke Google Calendar Tester",
          "+905555555558",
          preferredDatetimeUtc
        ]
      );

      const providerConfig = {
        provider: "google_calendar",
        calendarId,
        cleanupCreatedEvent: true,
        durationMinutes: 30,
        confirmationDelaySeconds: 0
      };

      await client.query(
        `insert into integration_connections (
           id, office_id, kind, status, config
         ) values ($1, $2, 'booking_workflow', 'active', $3::jsonb)
         on conflict (id) do update
         set office_id = excluded.office_id,
             status = 'active',
             config = excluded.config,
             updated_at = now()`,
        [connectionId, officeId, JSON.stringify(providerConfig)]
      );

      const smokeResponse = await fetchJson<{
        accepted: boolean;
        workflow: string;
        officeId: string;
        showingRequestId: string;
        status: string;
        callbackAccepted: boolean;
      }>(routeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ai-ses-trigger-secret": triggerSecret
        },
        body: JSON.stringify({
          kind: "booking_workflow",
          office: {
            officeId
          },
          showingRequest: {
            id: showingRequestId,
            listingReferenceCode: `SMOKE-GCAL-CONFIRMED-${showingRequestId}`,
            listingTitle: "Smoke Google Calendar Listing",
            customerName: "Smoke Google Calendar Tester",
            customerPhone: "+905555555558",
            preferredDatetime
          },
          connection: {
            id: connectionId,
            config: providerConfig
          }
        })
      });

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - Booking Flow",
        officeId,
        showingRequestId,
        status: "confirmed",
        callbackAccepted: true
      });

      const executionId = await waitForExecutionAfter(
        baseUrl,
        apiKey,
        workflowId,
        executionStartedAfter,
        20000,
        (execution) =>
          getNodeJsonOutput(execution, "Webhook")?.body?.showingRequest?.id ===
          showingRequestId
      );
      const execution = await getExecutionDetail(baseUrl, apiKey, executionId);
      await assertGoogleCalendarExecutionNodeSet(execution, [
        "Check Google Calendar Availability",
        "Create Google Calendar Event",
        "Delete Google Calendar Event"
      ]);
      const availabilityOutput = getNodeJsonOutput(
        execution,
        "Check Google Calendar Availability"
      );
      const createOutput = getNodeJsonOutput(
        execution,
        "Create Google Calendar Event"
      );
      const deleteOutput = getNodeJsonOutput(
        execution,
        "Delete Google Calendar Event"
      );

      assert.equal(availabilityOutput?.available, true);
      assert.equal(typeof createOutput?.id, "string");
      assert.ok(
        typeof createOutput?.htmlLink === "string" || typeof createOutput?.summary === "string"
      );
      assert.equal(deleteOutput?.success, true);

      const showingRequest = await client.query<{ status: string }>(
        `select status
         from showing_requests
         where id = $1`,
        [showingRequestId]
      );

      assert.equal(showingRequest.rows[0]?.status, "confirmed");

      const auditEvent = await client.query<{
        action: string;
        status: string | null;
        note: string | null;
        external_booking_id: string | null;
        scheduled_datetime: string | null;
      }>(
        `select action,
                payload->>'status' as status,
                payload->>'note' as note,
                payload->>'externalBookingId' as external_booking_id,
                payload->>'scheduledDatetime' as scheduled_datetime
         from audit_events
         where office_id = $1
           and action = 'booking_result_recorded'
         order by created_at desc
         limit 1`,
        [officeId]
      );

      assert.equal(auditEvent.rows[0]?.action, "booking_result_recorded");
      assert.equal(auditEvent.rows[0]?.status, "confirmed");
      assert.equal(auditEvent.rows[0]?.external_booking_id, createOutput?.id as string);
      assert.equal(
        auditEvent.rows[0]?.scheduled_datetime,
        (createOutput?.start as { dateTime?: string } | undefined)?.dateTime ??
          preferredDatetime
      );
      assert.ok(
        typeof auditEvent.rows[0]?.note === "string" &&
          auditEvent.rows[0]!.note!.trim() !== ""
      );
    } finally {
      await client.query(
        `delete from integration_connections
         where id = $1`,
        [connectionId]
      );
      await client.query(
        `delete from showing_requests
         where id = $1`,
        [showingRequestId]
      );
      await client.query(
        `delete from listings
         where id = $1`,
        [listingId]
      );
      if ((claimedOffice?.deactivatedConnectionIds.length ?? 0) > 0) {
        await client.query(
          `update integration_connections
           set status = 'active',
               updated_at = now()
           where id = any($1::uuid[])`,
          [claimedOffice?.deactivatedConnectionIds ?? []]
        );
      }
      await client.end();
    }
  }
);

test(
  "live n8n booking workflow normalizes a real Google Calendar provider failure",
  { skip: providerSmokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_BOOKING_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(
      baseUrl,
      apiKey,
      "ai-ses - Booking Flow"
    );
    await ensureGoogleCalendarNodeCredentials(baseUrl, apiKey, workflowId);
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    let claimedOffice: ClaimedSmokeOffice | null = null;
    const listingId = randomUUID();
    const showingRequestId = randomUUID();
    const connectionId = randomUUID();
    const executionStartedAfter = Date.now();

    try {
      await seedLocalDemoData();
      await client.connect();
      claimedOffice = await claimSmokeOffice(client);
      const officeId = claimedOffice.officeId;

      await client.query(
        `insert into listings (
           id, office_id, reference_code, title, status, currency
         ) values ($1, $2, $3, $4, 'active', 'TRY')
         on conflict (office_id, reference_code) do update
         set title = excluded.title,
             status = 'active',
             id = excluded.id`,
        [
          listingId,
          officeId,
          `SMOKE-GCAL-FAILED-${showingRequestId}`,
          "Smoke Google Calendar Failure Listing"
        ]
      );

      await client.query(
        `insert into showing_requests (
           id, office_id, listing_id, customer_name, customer_phone, preferred_datetime, status
         ) values ($1, $2, $3, $4, $5, $6, 'pending')
         on conflict (id) do update
         set office_id = excluded.office_id,
             listing_id = excluded.listing_id,
             customer_name = excluded.customer_name,
             customer_phone = excluded.customer_phone,
             preferred_datetime = excluded.preferred_datetime,
             status = 'pending'`,
        [
          showingRequestId,
          officeId,
          listingId,
          "Smoke Google Calendar Failure Tester",
          "+905555555559",
          "2026-04-02T12:00:00.000Z"
        ]
      );

      const providerConfig = {
        provider: "google_calendar",
        calendarId: "missing-calendar-ai-ses@example.com",
        durationMinutes: 30,
        confirmationDelaySeconds: 0
      };

      await client.query(
        `insert into integration_connections (
           id, office_id, kind, status, config
         ) values ($1, $2, 'booking_workflow', 'active', $3::jsonb)
         on conflict (id) do update
         set office_id = excluded.office_id,
             status = 'active',
             config = excluded.config,
             updated_at = now()`,
        [connectionId, officeId, JSON.stringify(providerConfig)]
      );

      const smokeResponse = await fetchJson<{
        accepted: boolean;
        workflow: string;
        officeId: string;
        showingRequestId: string;
        status: string;
        callbackAccepted: boolean;
      }>(routeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ai-ses-trigger-secret": triggerSecret
        },
        body: JSON.stringify({
          kind: "booking_workflow",
          office: {
            officeId
          },
          showingRequest: {
            id: showingRequestId,
            listingReferenceCode: `SMOKE-GCAL-FAILED-${showingRequestId}`,
            listingTitle: "Smoke Google Calendar Failure Listing",
            customerName: "Smoke Google Calendar Failure Tester",
            customerPhone: "+905555555559",
            preferredDatetime: "2026-04-02T15:00:00+03:00"
          },
          connection: {
            id: connectionId,
            config: providerConfig
          }
        })
      });

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - Booking Flow",
        officeId,
        showingRequestId,
        status: "failed",
        callbackAccepted: true
      });

      const executionId = await waitForExecutionAfter(
        baseUrl,
        apiKey,
        workflowId,
        executionStartedAfter,
        20000,
        (execution) =>
          getNodeJsonOutput(execution, "Webhook")?.body?.showingRequest?.id ===
          showingRequestId
      );
      const execution = await getExecutionDetail(baseUrl, apiKey, executionId);
      await assertGoogleCalendarExecutionNodeSet(execution, [
        "Check Google Calendar Availability"
      ]);
      const availabilityOutput = getNodeJsonOutput(
        execution,
        "Check Google Calendar Availability"
      );

      assert.ok(
        availabilityOutput &&
          (typeof availabilityOutput.error === "string" ||
            typeof availabilityOutput.errorMessage === "string" ||
            typeof availabilityOutput.message === "string")
      );
      assert.equal(
        getNodeJsonOutput(execution, "Create Google Calendar Event"),
        null
      );

      const showingRequest = await client.query<{ status: string }>(
        `select status
         from showing_requests
         where id = $1`,
        [showingRequestId]
      );

      assert.equal(showingRequest.rows[0]?.status, "failed");

      const auditEvent = await client.query<{
        action: string;
        status: string | null;
        note: string | null;
      }>(
        `select action,
                payload->>'status' as status,
                payload->>'note' as note
         from audit_events
         where office_id = $1
           and action = 'booking_result_recorded'
         order by created_at desc
         limit 1`,
        [officeId]
      );

      assert.equal(auditEvent.rows[0]?.action, "booking_result_recorded");
      assert.equal(auditEvent.rows[0]?.status, "failed");
      assert.ok(
        typeof auditEvent.rows[0]?.note === "string" &&
          auditEvent.rows[0]!.note!.trim() !== ""
      );
    } finally {
      await client.query(
        `delete from integration_connections
         where id = $1`,
        [connectionId]
      );
      await client.query(
        `delete from showing_requests
         where id = $1`,
        [showingRequestId]
      );
      await client.query(
        `delete from listings
         where id = $1`,
        [listingId]
      );
      if ((claimedOffice?.deactivatedConnectionIds.length ?? 0) > 0) {
        await client.query(
          `update integration_connections
           set status = 'active',
               updated_at = now()
           where id = any($1::uuid[])`,
          [claimedOffice?.deactivatedConnectionIds ?? []]
        );
      }
      await client.end();
    }
  }
);
