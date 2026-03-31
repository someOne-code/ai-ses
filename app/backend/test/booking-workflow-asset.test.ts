import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REQUIRED_GOOGLE_CALENDAR_NODE_NAMES } from "./helpers/google-calendar-credential-guard.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
  currentDir,
  "../../../infra/n8n/ai-ses-booking-flow.json"
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
      id?: string;
      versionId?: string;
      meta?: unknown;
    }
  };
}

test("booking workflow asset is project-owned and parseable", async () => {
  const { workflow } = await readWorkflow();

  assert.equal(workflow.name, "ai-ses - Booking Flow");
  assert.ok(Array.isArray(workflow.nodes));
  assert.ok(workflow.nodes.length >= 10);
});

test("booking workflow asset stays import-safe for local n8n", async () => {
  const { workflow } = await readWorkflow();

  assert.equal(workflow.id, undefined);
  assert.equal(workflow.versionId, undefined);
  assert.equal(workflow.meta, undefined);
});

test("booking workflow asset uses only the intended standard node patterns", async () => {
  const { workflow } = await readWorkflow();
  const nodeTypes = workflow.nodes.map((node) => node.type);

  assert.ok(nodeTypes.includes("n8n-nodes-base.webhook"));
  assert.ok(nodeTypes.includes("n8n-nodes-base.httpRequest"));
  assert.ok(nodeTypes.includes("n8n-nodes-base.googleCalendar"));
  assert.ok(nodeTypes.includes("n8n-nodes-base.wait"));
  assert.ok(nodeTypes.includes("n8n-nodes-base.respondToWebhook"));

  assert.equal(
    workflow.nodes.some((node) =>
      node.type.startsWith("@n8n/n8n-nodes-langchain")
    ),
    false
  );
});

test("booking workflow asset has no embedded credentials and no legacy AI receptionist nodes", async () => {
  const { raw, workflow } = await readWorkflow();

  assert.equal(
    workflow.nodes.some((node) => Object.hasOwn(node, "credentials")),
    false
  );
  assert.equal(raw.includes("OpenAI Chat Model"), false);
  assert.equal(raw.includes("AI Agent"), false);
  assert.equal(raw.includes("lahoodreservations@gmail.com"), false);
  assert.equal(raw.includes("assistantId"), false);
  assert.equal(raw.includes("phoneNumberId"), false);
});

test("booking workflow asset authenticates inbound requests before outbound steps", async () => {
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
    path: "ai-ses-booking-flow",
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

  assert.deepEqual(authNode.parameters, {
    conditions: {
      options: {
        version: 2
      },
      conditions: [
        {
          id: "9f23fa6e-a8c9-4980-aefc-7aa9c9af6efc",
          leftValue: "={{ $('Webhook').item.json.headers['x-ai-ses-trigger-secret'] || '' }}",
          rightValue: "={{ $env.N8N_BOOKING_TRIGGER_SECRET || '' }}",
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

test("booking workflow asset uses fixed backend callback contract and narrows untrusted body fields", async () => {
  const { workflow } = await readWorkflow();
  const normalizeDispatchNode = workflow.nodes.find(
    (node) => node.name === "Normalize Dispatch"
  );
  const bookingCreateSuccessNode = workflow.nodes.find(
    (node) => node.name === "If Booking Creation Succeeded"
  );
  const googleProviderSwitchNode = workflow.nodes.find(
    (node) => node.name === "If Google Calendar Provider"
  );
  const googleBookingSwitchNode = workflow.nodes.find(
    (node) => node.name === "If Google Calendar Booking Provider"
  );
  const availabilityFailureCallback = workflow.nodes.find(
    (node) => node.name === "Send Failed Result Callback"
  );
  const bookingFailureCallback = workflow.nodes.find(
    (node) => node.name === "Send Booking Creation Failed Result Callback"
  );
  const callbackNodes = workflow.nodes.filter((node) =>
    [
      "Send Confirmed Result Callback",
      "Send Failed Result Callback",
      "Send Booking Creation Failed Result Callback"
    ].includes(node.name)
  );
  const callbackNormalizeNodes = workflow.nodes.filter((node) =>
    [
      "Normalize Confirmed Callback Result",
      "Normalize Failed Callback Result",
      "Normalize Booking Creation Failed Callback Result"
    ].includes(node.name)
  );
  const providerNodes = workflow.nodes.filter((node) =>
    ["Check Availability", "Create Booking"].includes(node.name)
  );

  assert.ok(normalizeDispatchNode);
  assert.ok(bookingCreateSuccessNode);
  assert.ok(googleProviderSwitchNode);
  assert.ok(googleBookingSwitchNode);
  assert.ok(availabilityFailureCallback);
  assert.ok(bookingFailureCallback);
  assert.equal(callbackNodes.length, 3);
  assert.equal(callbackNormalizeNodes.length, 3);
  assert.equal(providerNodes.length, 2);

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
  assert.equal(normalizeAssignments.includes("availabilityUrl"), false);
  assert.equal(normalizeAssignments.includes("bookingUrl"), false);
  assert.ok(normalizeAssignments.includes("providerKind"));
  assert.ok(normalizeAssignments.includes("calendarId"));
  assert.ok(normalizeAssignments.includes("cleanupCreatedEvent"));

  for (const node of providerNodes) {
    const parameters = node.parameters as { url?: string };
    assert.ok(
      parameters.url ===
        "={{ $('Webhook').item.json.body.connection.config.availabilityUrl }}" ||
        parameters.url ===
          "={{ $('Webhook').item.json.body.connection.config.bookingUrl }}"
    );
    assert.equal(
      Object.hasOwn(node, "continueOnFail"),
      true,
      `${node.name} must remain non-fatal`
    );
  }

  const googleProviderNodes = workflow.nodes.filter((node) =>
    REQUIRED_GOOGLE_CALENDAR_NODE_NAMES.includes(
      node.name as (typeof REQUIRED_GOOGLE_CALENDAR_NODE_NAMES)[number]
    )
  );

  assert.deepEqual(
    workflow.nodes
      .filter((node) => node.type === "n8n-nodes-base.googleCalendar")
      .map((node) => node.name)
      .sort(),
    [...REQUIRED_GOOGLE_CALENDAR_NODE_NAMES].sort()
  );

  for (const node of googleProviderNodes) {
    const parameters = node.parameters as {
      calendar?: { __rl?: boolean; mode?: string; value?: string };
      resource?: string;
      operation?: string;
    };

    assert.deepEqual(parameters.calendar, {
      __rl: true,
      mode: "id",
      value: "={{ $('Normalize Dispatch').item.json.calendarId }}"
    });
    assert.equal(
      Object.hasOwn(node, "continueOnFail"),
      true,
      `${node.name} must remain non-fatal`
    );
  }

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
      node.name === "Send Confirmed Result Callback"
        ? "If Cleanup Created Event Requested"
        : node.name === "Send Failed Result Callback"
          ? "Normalize Failed Callback Result"
          : "Normalize Booking Creation Failed Callback Result";

    assert.ok(
      headers.some(
        (header) =>
          header.name === "x-ai-ses-callback-secret" &&
          header.value === "={{ $env.N8N_BOOKING_CALLBACK_SECRET }}"
      )
    );
    assert.equal(
      parameters.url,
      "={{ $env.AI_SES_BACKEND_BASE_URL + '/v1/webhooks/n8n/booking-results' }}"
    );
    assert.equal(
      Object.hasOwn(node, "continueOnFail"),
      true,
      `${node.name} must remain non-fatal`
    );
    assert.ok(
      parameters.jsonBody?.includes('"connectionId": "{{ $(\'Normalize Dispatch\').item.json.connectionId }}"')
    );
    assert.deepEqual(workflow.connections[node.name], {
      main: [[{ node: expectedNormalizeNodeName, type: "main", index: 0 }]]
    });

    if (node.name !== "Send Confirmed Result Callback") {
      assert.ok(
        parameters.jsonBody?.includes('"note": {{ JSON.stringify('),
        `${node.name} must serialize failure notes safely`
      );
    }
  }

  for (const node of callbackNormalizeNodes) {
    const parameters = node.parameters as {
      assignments?: {
        assignments?: Array<{ name: string; value: string; type: string }>;
      };
    };
    const assignmentNames =
      parameters.assignments?.assignments?.map((assignment) => assignment.name) ?? [];

    assert.ok(assignmentNames.includes("status"));
    assert.ok(assignmentNames.includes("callbackAccepted"));
    assert.deepEqual(workflow.connections[node.name], {
      main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]]
    });
  }

  assert.equal(
    (
      workflow.nodes.find(
        (node) => node.name === "Normalize Confirmed Callback Result"
      )?.parameters as {
        assignments?: {
          assignments?: Array<{ name: string; value: string; type: string }>;
        };
      }
    ).assignments?.assignments?.find(
      (assignment) => assignment.name === "callbackAccepted"
    )?.value,
    "={{ Boolean($('Send Confirmed Result Callback').item.json.data?.received) }}"
  );

  assert.deepEqual(workflow.connections["Normalize Dispatch"], {
    main: [[{ node: "If Google Calendar Provider", type: "main", index: 0 }]]
  });
  assert.deepEqual(workflow.connections["If Google Calendar Provider"], {
    main: [
      [
        {
          node: "Check Google Calendar Availability",
          type: "main",
          index: 0
        }
      ],
      [{ node: "Check Availability", type: "main", index: 0 }]
    ]
  });
  assert.deepEqual(workflow.connections["Check Google Calendar Availability"], {
    main: [[{ node: "If Requested Slot Available", type: "main", index: 0 }]]
  });
  assert.deepEqual(workflow.connections["If Requested Slot Available"], {
    main: [
      [
        {
          node: "If Google Calendar Booking Provider",
          type: "main",
          index: 0
        }
      ],
      [{ node: "Send Failed Result Callback", type: "main", index: 0 }]
    ]
  });
  assert.deepEqual(workflow.connections["If Google Calendar Booking Provider"], {
    main: [
      [
        {
          node: "Create Google Calendar Event",
          type: "main",
          index: 0
        }
      ],
      [{ node: "Create Booking", type: "main", index: 0 }]
    ]
  });
  assert.deepEqual(workflow.connections["Create Booking"], {
    main: [[{ node: "If Booking Creation Succeeded", type: "main", index: 0 }]]
  });
  assert.deepEqual(workflow.connections["Create Google Calendar Event"], {
    main: [[{ node: "If Booking Creation Succeeded", type: "main", index: 0 }]]
  });
  assert.deepEqual(workflow.connections["Send Confirmed Result Callback"], {
    main: [[{ node: "If Cleanup Created Event Requested", type: "main", index: 0 }]]
  });
  assert.deepEqual(workflow.connections["If Cleanup Created Event Requested"], {
    main: [
      [{ node: "Delete Google Calendar Event", type: "main", index: 0 }],
      [{ node: "Normalize Confirmed Callback Result", type: "main", index: 0 }]
    ]
  });
  assert.deepEqual(workflow.connections["Delete Google Calendar Event"], {
    main: [[{ node: "Normalize Confirmed Callback Result", type: "main", index: 0 }]]
  });
  assert.deepEqual(workflow.connections["If Booking Creation Succeeded"], {
    main: [
      [{ node: "If Confirmation Delay Needed", type: "main", index: 0 }],
      [
        {
          node: "Send Booking Creation Failed Result Callback",
          type: "main",
          index: 0
        }
      ]
    ]
  });
  assert.ok(
    (
      availabilityFailureCallback.parameters as {
        jsonBody?: string;
      }
    ).jsonBody?.includes(
      "JSON.stringify((() => { const fallback = $json.note || (($json.alternateSlots?.length ?? 0) > 0 ? 'Requested slot unavailable. Alternate slots returned in payload.' : 'Requested slot unavailable.');"
    )
  );
  assert.ok(
    (
      bookingFailureCallback.parameters as {
        jsonBody?: string;
      }
    ).jsonBody?.includes(
      "JSON.stringify((() => { const fallback = 'Showing booking creation failed.';"
    )
  );
  assert.ok(
    (
      callbackNodes.find((node) => node.name === "Send Confirmed Result Callback")
        ?.parameters as { jsonBody?: string }
    ).jsonBody?.includes('"externalBookingId": {{ JSON.stringify($json.externalBookingId || $json.id || $json.eventId || null) }}')
  );
  assert.deepEqual(
    (
      workflow.nodes.find((node) => node.name === "Delete Google Calendar Event")
        ?.parameters as {
          calendar?: { __rl?: boolean; mode?: string; value?: string };
          eventId?: string;
          operation?: string;
        }
    ),
    {
      resource: "event",
      operation: "delete",
      calendar: {
        __rl: true,
        mode: "id",
        value: "={{ $('Normalize Dispatch').item.json.calendarId }}"
      },
      eventId: "={{ $('Create Google Calendar Event').item.json.id }}",
      options: {}
    }
  );
  assert.deepEqual(
    (
      workflow.nodes.find((node) => node.name === "Respond to Webhook")
        ?.parameters as { responseBody?: string }
    )?.responseBody,
    "={\n  \"accepted\": true,\n  \"workflow\": \"ai-ses - Booking Flow\",\n  \"officeId\": \"{{ $('Normalize Dispatch').item.json.officeId }}\",\n  \"showingRequestId\": \"{{ $('Normalize Dispatch').item.json.showingRequestId }}\",\n  \"status\": \"{{ $json.status }}\",\n  \"callbackAccepted\": {{ $json.callbackAccepted }}\n}\n"
  );
});
