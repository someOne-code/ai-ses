import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getMinimalRetellToolDescriptions,
  minimalRetellToolDescriptions,
  renderRetellPromptSource,
  retellPromptSourceStateNames
} from "../src/modules/retell/prompt-source/index.ts";
import { generalPrompt } from "../src/modules/retell/prompt-source/general.js";
import intakeGeneralState from "../src/modules/retell/prompt-source/states/intake-general.js";
import {
  listingHelpStateSource,
  listingHelpToolNames
} from "../src/modules/retell/prompt-source/states/listing-help.js";
import { showingRequestStatePrompt } from "../src/modules/retell/prompt-source/states/showing-request.js";

function getCustomTools(
  payload: ReturnType<typeof renderRetellPromptSource>
): Record<string, { description: string; url: string }> {
  return Object.fromEntries(
    payload.states.flatMap((state) =>
      (state.tools ?? []).map((tool) => [
        tool.name,
        { description: tool.description, url: tool.url }
      ])
    )
  );
}

async function readPublishedLlmSnapshot() {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const snapshotPath = path.join(
    testDir,
    "..",
    ".tmp",
    "retell-account-snapshots",
    "latest",
    "published",
    "llm.json"
  );

  return JSON.parse(await readFile(snapshotPath, "utf8")) as {
    states?: Array<{
      tools?: Array<{
        name?: string;
        type?: string;
        description?: string;
      }>;
    }>;
  };
}

test("renderRetellPromptSource emits the Retell multi-prompt payload shape", () => {
  const toolEndpointUrl = "https://backend.example.com/v1/retell/tools";
  const rendered = renderRetellPromptSource({ toolEndpointUrl });
  const customTools = getCustomTools(rendered);

  assert.equal(rendered.model, "gpt-5.4-mini");
  assert.equal(rendered.model_temperature, 0);
  assert.equal(rendered.model_high_priority, false);
  assert.equal(rendered.tool_call_strict_mode, true);
  assert.equal(rendered.starting_state, "intake_general");
  assert.equal(rendered.start_speaker, "agent");
  assert.equal(rendered.begin_message.length > 0, true);
  assert.equal(rendered.general_tools.length, 2);
  assert.equal(rendered.general_prompt, generalPrompt);
  assert.deepEqual(
    rendered.states.map((state) => state.name),
    [...retellPromptSourceStateNames]
  );
  assert.equal(rendered.states[0]?.state_prompt, intakeGeneralState.state_prompt);
  assert.equal(
    rendered.states[1]?.state_prompt,
    listingHelpStateSource.statePrompt
  );
  assert.equal(rendered.states[2]?.state_prompt, showingRequestStatePrompt);
  assert.deepEqual(Object.keys(customTools), [
    "search_listings",
    "get_listing_by_reference",
    "create_showing_request"
  ]);

  for (const tool of Object.values(customTools)) {
    assert.equal(tool.url, toolEndpointUrl);
  }
});

test("renderRetellPromptSource includes the required global and state sections", () => {
  const rendered = renderRetellPromptSource({
    toolEndpointUrl: "https://backend.example.com/v1/retell/tools"
  });

  assert.match(rendered.general_prompt, /Turkish-speaking AI receptionist/);
  assert.match(rendered.general_prompt, /Never invent listing facts/);

  const intakeGeneral = rendered.states.find(
    (state) => state.name === "intake_general"
  );
  const listingHelp = rendered.states.find(
    (state) => state.name === "listing_help"
  );
  const showingRequest = rendered.states.find(
    (state) => state.name === "showing_request"
  );

  assert.ok(intakeGeneral);
  assert.ok(listingHelp);
  assert.ok(showingRequest);
  assert.equal(intakeGeneral.state_prompt, intakeGeneralState.state_prompt);
  assert.equal(listingHelp.state_prompt, listingHelpStateSource.statePrompt);
  assert.equal(showingRequest.state_prompt, showingRequestStatePrompt);
  assert.deepEqual(
    (listingHelp.tools ?? []).map((tool) => tool.name),
    [...listingHelpToolNames]
  );
});

test("minimal tool descriptions stay at or below the live Retell snapshot baseline", async () => {
  const snapshot = await readPublishedLlmSnapshot();
  const snapshotDescriptions = Object.fromEntries(
    (snapshot.states ?? []).flatMap((state) =>
      (state.tools ?? [])
        .filter((tool) => tool.type === "custom" && typeof tool.name === "string")
        .map((tool) => [tool.name as string, tool.description ?? ""])
    )
  );
  const minimal = getMinimalRetellToolDescriptions();

  let snapshotTotalLength = 0;
  let minimalTotalLength = 0;

  for (const [name, description] of Object.entries(minimal)) {
    const baseline = snapshotDescriptions[name];

    assert.equal(typeof baseline, "string");
    assert.ok(description.length <= baseline.length);
    snapshotTotalLength += baseline.length;
    minimalTotalLength += description.length;
  }

  assert.ok(minimalTotalLength <= snapshotTotalLength);
});

test("minimal tool descriptions stay contract-level and do not duplicate state workflow prose", () => {
  assert.deepEqual(getMinimalRetellToolDescriptions(), minimalRetellToolDescriptions);

  const minimal = Object.values(getMinimalRetellToolDescriptions());
  const totalLength = minimal.reduce(
    (sum, description) => sum + description.length,
    0
  );

  assert.ok(totalLength < 350);

  for (const description of minimal) {
    assert.equal(description.includes("repairStep"), false);
    assert.equal(description.includes("matchInterpretation"), false);
    assert.equal(description.includes("phone_call"), false);
    assert.equal(description.includes("web_call"), false);
    assert.equal(description.includes("{{user_number}}"), false);
    assert.equal(description.includes("spokenSummary"), false);
    assert.equal(description.includes("spokenHighlights"), false);
    assert.equal(description.includes("preferredDatetime"), false);
    assert.equal(description.includes("preferredTimeWindow"), false);
  }
});

test("renderer does not reintroduce snapshot-era tool-rule prose into minimal descriptions", () => {
  const minimal = Object.values(getMinimalRetellToolDescriptions())
    .join(" ")
    .toLowerCase();

  for (const forbiddenPhrase of [
    "matchinterpretation",
    "verified_structured_match",
    "hybrid_candidate",
    "no_match",
    "phone_call",
    "web_call",
    "{{user_number}}",
    "spokensummary",
    "spokenhighlights",
    "spokenprice",
    "spokenreferencecode"
  ]) {
    assert.equal(minimal.includes(forbiddenPhrase), false);
  }
});
