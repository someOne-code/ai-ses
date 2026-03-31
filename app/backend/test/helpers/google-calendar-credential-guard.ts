import assert from "node:assert/strict";

export const REQUIRED_GOOGLE_CALENDAR_NODE_NAMES = [
  "Check Google Calendar Availability",
  "Create Google Calendar Event",
  "Delete Google Calendar Event"
] as const;

type GoogleCalendarCredential = {
  id: string;
  name: string;
};

export type GoogleCalendarWorkflowNode = {
  name?: string;
  type?: string;
  credentials?: {
    googleCalendarOAuth2Api?: GoogleCalendarCredential;
  } & Record<string, unknown>;
  [key: string]: unknown;
};

export function prepareGoogleCalendarCredentialRepair(
  workflowId: string,
  nodes: GoogleCalendarWorkflowNode[]
) {
  const requiredNodeNames = [...REQUIRED_GOOGLE_CALENDAR_NODE_NAMES];
  const requiredNodes = new Map<string, GoogleCalendarWorkflowNode>();

  for (const nodeName of requiredNodeNames) {
    const node = nodes.find((entry) => entry.name === nodeName);
    assert.ok(node, `Workflow ${workflowId} must include ${nodeName}`);
    requiredNodes.set(nodeName, node);
  }

  const sourceCredential =
    requiredNodes.get("Create Google Calendar Event")?.credentials
      ?.googleCalendarOAuth2Api;

  assert.ok(
    sourceCredential,
    `Workflow ${workflowId} must already have a live Google Calendar credential on Create Google Calendar Event`
  );

  const repairedNodeNames: string[] = [];
  const updatedNodes = nodes.map((node) => {
    if (!requiredNodeNames.includes(node.name as (typeof requiredNodeNames)[number])) {
      return node;
    }

    if (node.name === "Create Google Calendar Event") {
      return node;
    }

    if (node.credentials?.googleCalendarOAuth2Api) {
      return node;
    }

    repairedNodeNames.push(node.name as string);

    return {
      ...node,
      credentials: {
        ...(node.credentials ?? {}),
        googleCalendarOAuth2Api: sourceCredential
      }
    };
  });

  return {
    sourceCredential,
    repairedNodeNames,
    updatedNodes
  };
}
