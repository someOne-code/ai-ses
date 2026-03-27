import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
  currentDir,
  "../../../infra/n8n/ai-ses-crm-sync.json"
);

type WorkflowNode = {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  credentials?: unknown;
};

async function readWorkflow() {
  const raw = await readFile(workflowPath, "utf8");
  return {
    raw,
    workflow: JSON.parse(raw) as {
      name: string;
      nodes: WorkflowNode[];
      connections: Record<string, unknown>;
    }
  };
}

test("crm workflow asset is project-owned and parseable", async () => {
  const { workflow } = await readWorkflow();

  assert.equal(workflow.name, "ai-ses - CRM Sync");
  assert.ok(Array.isArray(workflow.nodes));
  assert.ok(workflow.nodes.length >= 10);
});

test("crm workflow asset uses only the intended standard node patterns", async () => {
  const { workflow } = await readWorkflow();
  const nodeTypes = workflow.nodes.map((node) => node.type);

  assert.ok(nodeTypes.includes("n8n-nodes-base.webhook"));
  assert.ok(nodeTypes.includes("n8n-nodes-base.httpRequest"));
  assert.ok(nodeTypes.includes("n8n-nodes-base.if"));
  assert.ok(nodeTypes.includes("n8n-nodes-base.respondToWebhook"));

  assert.equal(
    workflow.nodes.some((node) =>
      node.type.startsWith("@n8n/n8n-nodes-langchain")
    ),
    false
  );
  assert.equal(
    workflow.nodes.some((node) => node.type.includes("googleCalendar")),
    false
  );
});

test("crm workflow asset has no embedded credentials and no legacy outbound marketing nodes", async () => {
  const { raw, workflow } = await readWorkflow();

  assert.equal(
    workflow.nodes.some((node) => Object.hasOwn(node, "credentials")),
    false
  );
  assert.equal(raw.includes("OpenAI Chat Model"), false);
  assert.equal(raw.includes("AI Agent"), false);
  assert.equal(raw.includes("VAPI"), false);
  assert.equal(raw.includes("airtable"), false);
  assert.equal(raw.includes("gmail"), false);
  assert.equal(raw.includes("twilio"), false);
});

test("crm workflow asset authenticates inbound requests before outbound delivery", async () => {
  const { workflow } = await readWorkflow();
  const webhookNode = workflow.nodes.find((node) => node.name === "Webhook");
  const authNode = workflow.nodes.find(
    (node) => node.name === "If Trigger Secret Valid"
  );
  const unauthorizedNode = workflow.nodes.find(
    (node) => node.name === "Respond Unauthorized"
  );

  assert.ok(webhookNode);
  assert.deepEqual(webhookNode?.parameters, {
    httpMethod: "POST",
    path: "ai-ses-crm-sync",
    responseMode: "responseNode",
    options: {}
  });
  assert.ok(authNode);
  assert.ok(unauthorizedNode);

  assert.deepEqual(workflow.connections["Webhook"], {
    main: [[{ node: "If Trigger Secret Valid", type: "main", index: 0 }]]
  });
  assert.deepEqual(workflow.connections["If Trigger Secret Valid"], {
    main: [
      [{ node: "Normalize Dispatch", type: "main", index: 0 }],
      [{ node: "Respond Unauthorized", type: "main", index: 0 }]
    ]
  });

  assert.deepEqual(authNode?.parameters, {
    conditions: {
      options: {
        version: 2
      },
      conditions: [
        {
          id: "4db75f17-f0c7-4fe0-94ea-e46c2e25e4d8",
          leftValue: "={{ $('Webhook').item.json.headers['x-ai-ses-trigger-secret'] || '' }}",
          rightValue: "={{ $env.N8N_CRM_TRIGGER_SECRET || '' }}",
          operator: {
            type: "string",
            operation: "equals"
          }
        }
      ],
      combinator: "and"
    },
    looseTypeValidation: true,
    options: {}
  });
});

test("crm workflow asset uses fixed backend callback contract and narrows untrusted body fields", async () => {
  const { workflow } = await readWorkflow();
  const normalizeDispatchNode = workflow.nodes.find(
    (node) => node.name === "Normalize Dispatch"
  );
  const deliveryNode = workflow.nodes.find(
    (node) => node.name === "Deliver CRM Webhook"
  );
  const callbackNodes = workflow.nodes.filter((node) =>
    [
      "Send Delivered Result Callback",
      "Send Failed Delivery Callback",
      "Send Skipped Result Callback"
    ].includes(node.name)
  );
  const callbackNormalizeNodes = workflow.nodes.filter((node) =>
    [
      "Normalize Delivered Callback Result",
      "Normalize Failed Delivery Callback Result",
      "Normalize Skipped Callback Result"
    ].includes(node.name)
  );

  assert.ok(normalizeDispatchNode);
  assert.ok(deliveryNode);
  assert.equal(callbackNodes.length, 3);
  assert.equal(callbackNormalizeNodes.length, 3);
  assert.equal(
    Object.hasOwn(deliveryNode ?? {}, "continueOnFail"),
    true,
    "Deliver CRM Webhook must remain non-fatal"
  );

  const normalizeAssignments = (
    normalizeDispatchNode?.parameters as {
      assignments?: {
        assignments?: Array<{ name: string }>;
      };
    }
  ).assignments?.assignments?.map((assignment) => assignment.name) ?? [];

  assert.equal(normalizeAssignments.includes("callbackPath"), false);
  assert.equal(normalizeAssignments.includes("callbackSecretHeader"), false);
  assert.equal(normalizeAssignments.includes("backendBaseUrl"), false);
  assert.equal(normalizeAssignments.includes("deliveryUrl"), false);

  assert.deepEqual(deliveryNode?.parameters, {
    method: "POST",
    url: "={{ $('Webhook').item.json.body.connection.config.deliveryUrl }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        {
          name: "Accept",
          value: "application/json"
        },
        {
          name: "Content-Type",
          value: "application/json"
        }
      ]
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      "={\n  \"kind\": \"crm_webhook\",\n  \"workflow\": \"ai-ses - CRM Sync\",\n  \"connectionId\": \"{{ $('Normalize Dispatch').item.json.connectionId }}\",\n  \"office\": {{ JSON.stringify($('Webhook').item.json.body.office) }},\n  \"event\": {{ JSON.stringify($('Webhook').item.json.body.event) }},\n  \"entity\": {{ JSON.stringify($('Webhook').item.json.body.entity) }}\n}\n",
    options: {}
  });

  for (const node of callbackNodes) {
    const parameters = node.parameters as {
      headerParameters?: {
        parameters?: Array<{ name: string; value: string }>;
      };
      jsonBody?: string;
      url?: string;
    };
    const headers = parameters.headerParameters?.parameters ?? [];
    const expectedNormalizeNodeName =
      node.name === "Send Delivered Result Callback"
        ? "Normalize Delivered Callback Result"
        : node.name === "Send Failed Delivery Callback"
          ? "Normalize Failed Delivery Callback Result"
          : "Normalize Skipped Callback Result";

    assert.ok(
      headers.some(
        (header) =>
          header.name === "x-ai-ses-callback-secret" &&
          header.value === "={{ $env.N8N_CRM_CALLBACK_SECRET }}"
      )
    );
    assert.equal(
      parameters.url,
      "={{ $env.AI_SES_BACKEND_BASE_URL + '/v1/webhooks/n8n/crm-deliveries' }}"
    );
    assert.equal(
      Object.hasOwn(node, "continueOnFail"),
      true,
      `${node.name} must remain non-fatal`
    );
    assert.ok(
      parameters.jsonBody?.includes(
        '"connectionId": "{{ $(\'Normalize Dispatch\').item.json.connectionId }}"'
      )
    );
    assert.deepEqual(workflow.connections[node.name], {
      main: [[{ node: expectedNormalizeNodeName, type: "main", index: 0 }]]
    });
  }

  for (const node of callbackNormalizeNodes) {
    const parameters = node.parameters as {
      assignments?: {
        assignments?: Array<{ name: string }>;
      };
    };
    const assignmentNames =
      parameters.assignments?.assignments?.map((assignment) => assignment.name) ?? [];

    assert.ok(assignmentNames.includes("deliveryStatus"));
    assert.ok(assignmentNames.includes("callbackAccepted"));
    assert.deepEqual(workflow.connections[node.name], {
      main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]]
    });
  }

  const deliveredCallback = callbackNodes.find(
    (node) => node.name === "Send Delivered Result Callback"
  );
  const failedCallback = callbackNodes.find(
    (node) => node.name === "Send Failed Delivery Callback"
  );

  assert.ok(
    (
      deliveredCallback?.parameters as {
        jsonBody?: string;
      }
    ).jsonBody?.includes('"note": {{ JSON.stringify($json.note || \'CRM delivery accepted.\') }}')
  );
  assert.ok(
    (
      failedCallback?.parameters as {
        jsonBody?: string;
      }
    ).jsonBody?.includes("JSON.stringify((() => { const fallback = 'CRM delivery failed.';")
  );
  assert.deepEqual(
    (
      workflow.nodes.find((node) => node.name === "Respond to Webhook")
        ?.parameters as { responseBody?: string }
    )?.responseBody,
    "={\n  \"accepted\": true,\n  \"workflow\": \"ai-ses - CRM Sync\",\n  \"officeId\": \"{{ $('Normalize Dispatch').item.json.officeId }}\",\n  \"entityType\": \"{{ $('Normalize Dispatch').item.json.entityType }}\",\n  \"entityId\": \"{{ $('Normalize Dispatch').item.json.entityId }}\",\n  \"deliveryStatus\": \"{{ $json.deliveryStatus }}\",\n  \"callbackAccepted\": {{ $json.callbackAccepted }}\n}\n"
  );
});
