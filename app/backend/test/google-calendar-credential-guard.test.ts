import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareGoogleCalendarCredentialRepair,
  REQUIRED_GOOGLE_CALENDAR_NODE_NAMES,
  type GoogleCalendarWorkflowNode
} from "./helpers/google-calendar-credential-guard.ts";

function buildNode(
  name: string,
  credential?: { id: string; name: string }
): GoogleCalendarWorkflowNode {
  return {
    name,
    type: "n8n-nodes-base.googleCalendar",
    credentials: credential
      ? {
          googleCalendarOAuth2Api: credential
        }
      : undefined
  };
}

test("google calendar credential guard repairs only the required named node set", () => {
  const sourceCredential = { id: "cred-1", name: "Smoke Google" };
  const nodes: GoogleCalendarWorkflowNode[] = [
    buildNode("Check Google Calendar Availability"),
    buildNode("Create Google Calendar Event", sourceCredential),
    buildNode("Delete Google Calendar Event"),
    buildNode("Some Future Google Node")
  ];

  const result = prepareGoogleCalendarCredentialRepair("wf-123", nodes);

  assert.deepEqual(
    REQUIRED_GOOGLE_CALENDAR_NODE_NAMES,
    [
      "Check Google Calendar Availability",
      "Create Google Calendar Event",
      "Delete Google Calendar Event"
    ]
  );
  assert.deepEqual(result.repairedNodeNames.sort(), [
    "Check Google Calendar Availability",
    "Delete Google Calendar Event"
  ]);
  assert.deepEqual(
    result.updatedNodes.find((node) => node.name === "Check Google Calendar Availability")
      ?.credentials?.googleCalendarOAuth2Api,
    sourceCredential
  );
  assert.deepEqual(
    result.updatedNodes.find((node) => node.name === "Delete Google Calendar Event")
      ?.credentials?.googleCalendarOAuth2Api,
    sourceCredential
  );
  assert.equal(
    result.updatedNodes.find((node) => node.name === "Some Future Google Node")
      ?.credentials?.googleCalendarOAuth2Api,
    undefined
  );
});

test("google calendar credential guard fails fast when the source credential is missing", () => {
  const nodes: GoogleCalendarWorkflowNode[] = [
    buildNode("Check Google Calendar Availability"),
    buildNode("Create Google Calendar Event"),
    buildNode("Delete Google Calendar Event")
  ];

  assert.throws(
    () => prepareGoogleCalendarCredentialRepair("wf-456", nodes),
    /must already have a live Google Calendar credential on Create Google Calendar Event/
  );
});
