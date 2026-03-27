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

type CrmSmokeResponseBody = {
  accepted: boolean;
  workflow: string;
  officeId: string;
  entityType: string;
  entityId: string;
  deliveryStatus: string;
  callbackAccepted: boolean;
};

type AuditEventRow = {
  action: string;
  delivery_status: string | null;
  event_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  note: string | null;
  external_record_id: string | null;
};

type StubResponseConfig = {
  statusCode?: number;
  body?: Record<string, unknown>;
};

type CrmSmokeFixture = {
  tenantId: string;
  officeId: string;
  callLogId: string;
  connectionId: string;
  providerCallId: string;
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

async function withCrmStub<T>(
  config: StubResponseConfig,
  run: (stubBaseUrl: string) => Promise<T>
) {
  const receivedRequests: Array<{
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      receivedRequests.push({
        headers: request.headers,
        body
      });
      response.setHeader("Content-Type", "application/json");
      response.statusCode = config.statusCode ?? 200;
      response.end(
        JSON.stringify(
          config.body ?? {
            id: "crm-local-record-1",
            note: 'Local smoke CRM delivery accepted: "quoted".'
          }
        )
      );
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

async function createCrmSmokeFixture(client: Client): Promise<CrmSmokeFixture> {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const callLogId = randomUUID();
  const connectionId = randomUUID();
  const providerCallId = `crm-smoke-provider-${callLogId}`;

  await client.query(
    `insert into tenants (id, name, status)
     values ($1, $2, 'active')`,
    [tenantId, `CRM Smoke Tenant ${tenantId}`]
  );
  await client.query(
    `insert into offices (id, tenant_id, name, timezone, status)
     values ($1, $2, $3, 'Europe/Istanbul', 'active')`,
    [officeId, tenantId, `CRM Smoke Office ${officeId}`]
  );
  await client.query(
    `insert into call_logs (
       id, office_id, provider_call_id, direction, status, summary,
       lead_intent, lead_temperature, handoff_recommended,
       budget_known, location_known, timeline_known,
       started_at, ended_at
     ) values (
       $1, $2, $3, 'inbound', 'ended', 'Local CRM smoke call summary.',
       'showing_request', 'warm', true,
       true, true, false,
       '2026-03-25T09:00:00.000Z', '2026-03-25T09:02:00.000Z'
     )`,
    [callLogId, officeId, providerCallId]
  );

  return {
    tenantId,
    officeId,
    callLogId,
    connectionId,
    providerCallId
  };
}

async function cleanupCrmSmokeFixture(
  client: Client,
  fixture: CrmSmokeFixture | null
) {
  if (!fixture) {
    return;
  }

  await client.query(`delete from audit_events where office_id = $1`, [
    fixture.officeId
  ]);
  await client.query(`delete from integration_connections where id = $1`, [
    fixture.connectionId
  ]);
  await client.query(`delete from call_logs where id = $1`, [fixture.callLogId]);
  await client.query(`delete from offices where id = $1`, [fixture.officeId]);
  await client.query(`delete from tenants where id = $1`, [fixture.tenantId]);
}

function createCrmWebhookBody(
  fixture: CrmSmokeFixture,
  connectionConfig: Record<string, unknown>
) {
  return {
    kind: "crm_webhook",
    office: {
      officeId: fixture.officeId,
      tenantId: fixture.tenantId,
      name: `CRM Smoke Office ${fixture.officeId}`,
      timezone: "Europe/Istanbul"
    },
    entity: {
      entityType: "call_log",
      id: fixture.callLogId,
      providerCallId: fixture.providerCallId,
      direction: "inbound",
      status: "ended",
      summary: "Local CRM smoke call summary.",
      leadIntent: "showing_request",
      leadTemperature: "warm",
      handoffRecommended: true,
      budgetKnown: true,
      locationKnown: true,
      timelineKnown: false,
      startedAt: "2026-03-25T09:00:00.000Z",
      endedAt: "2026-03-25T09:02:00.000Z"
    },
    event: {
      eventType: "call_summary_ready"
    },
    connection: {
      id: fixture.connectionId,
      config: connectionConfig
    }
  };
}

async function insertCrmConnection(
  client: Client,
  fixture: CrmSmokeFixture,
  config: Record<string, unknown>
) {
  await client.query(
    `insert into integration_connections (
       id, office_id, kind, status, config
     ) values ($1, $2, 'crm_webhook', 'active', $3::jsonb)`,
    [fixture.connectionId, fixture.officeId, JSON.stringify(config)]
  );
}

async function fetchLatestCrmAuditEvent(client: Client, officeId: string) {
  return client.query<AuditEventRow>(
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
    [officeId]
  );
}

function assertCrmAuditEvent(
  row: AuditEventRow | undefined,
  fixture: CrmSmokeFixture,
  deliveryStatus: "delivered" | "failed" | "skipped",
  options?: {
    note?: string;
    noteIncludes?: string;
    externalRecordId?: string | null;
  }
) {
  assert.equal(row?.action, "crm_delivery_result_recorded");
  assert.equal(row?.delivery_status, deliveryStatus);
  assert.equal(row?.event_type, "call_summary_ready");
  assert.equal(row?.entity_type, "call_log");
  assert.equal(row?.entity_id, fixture.callLogId);

  if (options?.note !== undefined) {
    assert.equal(row?.note, options.note);
  }

  if (options?.noteIncludes) {
    assert.match(row?.note ?? "", new RegExp(options.noteIncludes));
  }

  assert.equal(row?.external_record_id ?? null, options?.externalRecordId ?? null);
}

const smokeSkipReason =
  process.env.RUN_N8N_SMOKE_TESTS === "1"
    ? process.env.N8N_CRM_TRIGGER_SECRET
      ? false
      : "N8N_CRM_TRIGGER_SECRET is required for live n8n smoke tests"
    : "RUN_N8N_SMOKE_TESTS=1 is required for live n8n smoke tests";

test(
  "live n8n crm workflow resolves actual webhook path and rejects wrong trigger secret",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const workflowId = await resolveWorkflowId(baseUrl, apiKey, "ai-ses - CRM Sync");
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;

    assert.notEqual(
      routeUrl,
      `${baseUrl}/webhook/ai-ses-crm-sync`,
      "Smoke tests must use the live registered route, not a guessed path"
    );

    const { response, json } = await fetchJson<{
      accepted: boolean;
      workflow: string;
      error: { code: string; message: string };
    }>(routeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ai-ses-trigger-secret": "wrong-secret"
      },
      body: JSON.stringify({ kind: "crm_webhook" })
    });

    assert.equal(response.status, 401);
    assert.deepEqual(json, {
      accepted: false,
      workflow: "ai-ses - CRM Sync",
      error: {
        code: "CRM_SYNC_TRIGGER_FORBIDDEN",
        message: "Invalid CRM sync workflow trigger secret."
      }
    });
  }
);

test(
  "live n8n crm workflow delivers to a stub receiver and persists backend crm callback audit state",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_CRM_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(baseUrl, apiKey, "ai-ses - CRM Sync");
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    let fixture: CrmSmokeFixture | null = null;

    await client.connect();

    try {
      fixture = await createCrmSmokeFixture(client);

      const { result: smokeResponse, receivedRequests } = await withCrmStub(
        {},
        async (stubBaseUrl) => {
          await insertCrmConnection(client, fixture, {
            deliveryUrl: `${stubBaseUrl}/crm-delivery`
          });

          return fetchJson<CrmSmokeResponseBody>(routeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ai-ses-trigger-secret": triggerSecret
            },
            body: JSON.stringify(
              createCrmWebhookBody(fixture, {
                deliveryUrl: `${stubBaseUrl}/crm-delivery`
              })
            )
          });
        }
      );

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - CRM Sync",
        officeId: fixture.officeId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        deliveryStatus: "delivered",
        callbackAccepted: true
      });

      assert.equal(receivedRequests.length, 1);
      const crmPayload = JSON.parse(receivedRequests[0]!.body) as {
        kind: string;
        workflow: string;
        connectionId: string;
        office: { officeId: string };
        event: { eventType: string };
        entity: { entityType: string; id: string };
      };

      assert.deepEqual(crmPayload, {
        kind: "crm_webhook",
        workflow: "ai-ses - CRM Sync",
        connectionId: fixture.connectionId,
        office: {
          officeId: fixture.officeId,
          tenantId: fixture.tenantId,
          name: `CRM Smoke Office ${fixture.officeId}`,
          timezone: "Europe/Istanbul"
        },
        event: { eventType: "call_summary_ready" },
        entity: {
          entityType: "call_log",
          id: fixture.callLogId,
          providerCallId: fixture.providerCallId,
          direction: "inbound",
          status: "ended",
          summary: "Local CRM smoke call summary.",
          leadIntent: "showing_request",
          leadTemperature: "warm",
          handoffRecommended: true,
          budgetKnown: true,
          locationKnown: true,
          timelineKnown: false,
          startedAt: "2026-03-25T09:00:00.000Z",
          endedAt: "2026-03-25T09:02:00.000Z"
        }
      });

      const auditEvent = await fetchLatestCrmAuditEvent(client, fixture.officeId);

      assertCrmAuditEvent(auditEvent.rows[0], fixture, "delivered", {
        note: 'Local smoke CRM delivery accepted: "quoted".',
        externalRecordId: "crm-local-record-1"
      });
    } finally {
      await cleanupCrmSmokeFixture(client, fixture);
      await client.end();
    }
  }
);

test(
  "live n8n crm workflow records failed callback state when downstream crm delivery errors",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_CRM_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(baseUrl, apiKey, "ai-ses - CRM Sync");
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    let fixture: CrmSmokeFixture | null = null;

    await client.connect();

    try {
      fixture = await createCrmSmokeFixture(client);
      const deadDeliveryUrl = "http://127.0.0.1:6553/crm-delivery";

      await insertCrmConnection(client, fixture, {
        deliveryUrl: deadDeliveryUrl
      });

      const smokeResponse = await fetchJson<CrmSmokeResponseBody>(routeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ai-ses-trigger-secret": triggerSecret
        },
        body: JSON.stringify(
          createCrmWebhookBody(fixture, {
            deliveryUrl: deadDeliveryUrl
          })
        )
      });

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - CRM Sync",
        officeId: fixture.officeId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        deliveryStatus: "failed",
        callbackAccepted: true
      });

      const auditEvent = await fetchLatestCrmAuditEvent(client, fixture.officeId);

      assertCrmAuditEvent(auditEvent.rows[0], fixture, "failed", {
        noteIncludes: "ECONNREFUSED|crm delivery failed|CRM delivery failed",
        externalRecordId: null
      });
    } finally {
      await cleanupCrmSmokeFixture(client, fixture);
      await client.end();
    }
  }
);

test(
  "live n8n crm workflow preserves quoted provider messages on failed delivery callbacks",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_CRM_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(baseUrl, apiKey, "ai-ses - CRM Sync");
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    let fixture: CrmSmokeFixture | null = null;

    await client.connect();

    try {
      fixture = await createCrmSmokeFixture(client);

      const { result: smokeResponse } = await withCrmStub(
        {
          statusCode: 502,
          body: {
            code: "crm_provider_failed",
            message: 'Local smoke CRM delivery failed: "provider said no".'
          }
        },
        async (stubBaseUrl) => {
          await insertCrmConnection(client, fixture, {
            deliveryUrl: `${stubBaseUrl}/crm-delivery`
          });

          return fetchJson<CrmSmokeResponseBody>(routeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ai-ses-trigger-secret": triggerSecret
            },
            body: JSON.stringify(
              createCrmWebhookBody(fixture, {
                deliveryUrl: `${stubBaseUrl}/crm-delivery`
              })
            )
          });
        }
      );

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - CRM Sync",
        officeId: fixture.officeId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        deliveryStatus: "failed",
        callbackAccepted: true
      });

      const auditEvent = await fetchLatestCrmAuditEvent(client, fixture.officeId);

      assertCrmAuditEvent(auditEvent.rows[0], fixture, "failed", {
        note: 'Local smoke CRM delivery failed: "provider said no".',
        externalRecordId: null
      });
    } finally {
      await cleanupCrmSmokeFixture(client, fixture);
      await client.end();
    }
  }
);

test(
  "live n8n crm workflow records skipped callback state when delivery target is missing",
  { skip: smokeSkipReason },
  async () => {
    const env = await readBackendEnv();
    const baseUrl = requireEnv(env, "N8N_BASE_URL");
    const apiKey = requireEnv(env, "N8N_API_KEY");
    const databaseUrl = requireEnv(env, "DATABASE_URL");
    const triggerSecret = process.env.N8N_CRM_TRIGGER_SECRET as string;
    const workflowId = await resolveWorkflowId(baseUrl, apiKey, "ai-ses - CRM Sync");
    const webhookPath = await resolveWebhookPath(workflowId);
    const routeUrl = `${baseUrl}/webhook/${webhookPath}`;
    const client = new Client({ connectionString: databaseUrl });
    let fixture: CrmSmokeFixture | null = null;

    await client.connect();

    try {
      fixture = await createCrmSmokeFixture(client);
      await insertCrmConnection(client, fixture, {});

      const smokeResponse = await fetchJson<CrmSmokeResponseBody>(routeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ai-ses-trigger-secret": triggerSecret
        },
        body: JSON.stringify(createCrmWebhookBody(fixture, {}))
      });

      assert.equal(smokeResponse.response.status, 200);
      assert.deepEqual(smokeResponse.json, {
        accepted: true,
        workflow: "ai-ses - CRM Sync",
        officeId: fixture.officeId,
        entityType: "call_log",
        entityId: fixture.callLogId,
        deliveryStatus: "skipped",
        callbackAccepted: true
      });

      const auditEvent = await fetchLatestCrmAuditEvent(client, fixture.officeId);

      assertCrmAuditEvent(auditEvent.rows[0], fixture, "skipped", {
        note: "CRM deliveryUrl missing in connection config.",
        externalRecordId: null
      });
    } finally {
      await cleanupCrmSmokeFixture(client, fixture);
      await client.end();
    }
  }
);
