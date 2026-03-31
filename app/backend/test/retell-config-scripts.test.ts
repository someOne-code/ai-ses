import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { exportRetellConfig } from "../scripts/export-retell-config.ts";
import { restoreRetellConfig } from "../scripts/restore-retell-config.ts";
import { renderRetellPromptSource } from "../src/modules/retell/prompt-source/index.ts";

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("exportRetellConfig keeps writing llm.json for retell-llm agents", async () => {
  const snapshotsRoot = await mkdtemp(
    path.join(tmpdir(), "ai-ses-retell-export-llm-")
  );
  const llmRetrieveCalls: Array<{ id: string; version: number }> = [];
  const retell = {
    agent: {
      async getVersions() {
        return [
          { version: 3, is_published: false },
          { version: 2, is_published: true }
        ];
      },
      async retrieve(_agentId: string, options: { version: number }) {
        return options.version === 2
          ? {
              agent_id: "agent_llm",
              agent_name: "Retell LLM Published",
              response_engine: {
                type: "retell-llm",
                llm_id: "llm_published",
                version: 7
              }
            }
          : {
              agent_id: "agent_llm",
              agent_name: "Retell LLM Draft",
              response_engine: {
                type: "retell-llm",
                llm_id: "llm_draft",
                version: 8
              }
            };
      }
    },
    llm: {
      async retrieve(id: string, options: { version: number }) {
        llmRetrieveCalls.push({ id, version: options.version });
        return {
          llm_id: id,
          version: options.version,
          general_prompt: `prompt-${id}`
        };
      }
    },
    voice: {
      async retrieve() {
        throw new Error("voice.retrieve should not be called");
      }
    },
    knowledgeBase: {
      async retrieve() {
        throw new Error("knowledgeBase.retrieve should not be called");
      }
    },
    phoneNumber: {
      async list() {
        return [];
      }
    }
  };

  const result = await exportRetellConfig({
    retell: retell as never,
    agentId: "agent_llm",
    snapshotsRoot,
    exportedAt: new Date("2026-03-30T12:00:00.000Z")
  });
  const manifest = await readJson(path.join(result.snapshotDir, "manifest.json"));

  assert.equal(result.publishedLlmVersion, 7);
  assert.equal(result.draftLlmVersion, 8);
  assert.equal(manifest.publishedHasLlmArtifact, true);
  assert.equal(manifest.draftHasLlmArtifact, true);
  assert.equal(
    await pathExists(path.join(result.snapshotDir, "published", "llm.json")),
    true
  );
  assert.equal(
    await pathExists(path.join(result.snapshotDir, "draft", "llm.json")),
    true
  );
  assert.deepEqual(llmRetrieveCalls, [
    { id: "llm_published", version: 7 },
    { id: "llm_draft", version: 8 }
  ]);
});

test("exportRetellConfig skips llm.json for supported non-retell response engines", async () => {
  const snapshotsRoot = await mkdtemp(
    path.join(tmpdir(), "ai-ses-retell-export-non-llm-")
  );
  let llmRetrieveCalls = 0;
  const retell = {
    agent: {
      async getVersions() {
        return [
          { version: 4, is_published: true },
          { version: 5, is_published: false }
        ];
      },
      async retrieve(_agentId: string, options: { version: number }) {
        return options.version === 4
          ? {
              agent_id: "agent_non_llm",
              agent_name: "Custom LLM Agent",
              response_engine: {
                type: "custom-llm",
                llm_websocket_url: "wss://custom.example/ws"
              }
            }
          : {
              agent_id: "agent_non_llm",
              agent_name: "Conversation Flow Draft",
              response_engine: {
                type: "conversation-flow",
                conversation_flow_id: "flow_123",
                version: 2
              }
            };
      }
    },
    llm: {
      async retrieve() {
        llmRetrieveCalls += 1;
        throw new Error("llm.retrieve should not be called");
      }
    },
    voice: {
      async retrieve() {
        throw new Error("voice.retrieve should not be called");
      }
    },
    knowledgeBase: {
      async retrieve() {
        throw new Error("knowledgeBase.retrieve should not be called");
      }
    },
    phoneNumber: {
      async list() {
        return [];
      }
    }
  };

  const result = await exportRetellConfig({
    retell: retell as never,
    agentId: "agent_non_llm",
    snapshotsRoot,
    exportedAt: new Date("2026-03-30T12:30:00.000Z")
  });
  const manifest = await readJson(path.join(result.snapshotDir, "manifest.json"));

  assert.equal(result.publishedLlmVersion, null);
  assert.equal(result.draftLlmVersion, null);
  assert.equal(manifest.responseEngineType, "custom-llm");
  assert.equal(manifest.draftResponseEngineType, "conversation-flow");
  assert.equal(manifest.publishedHasLlmArtifact, false);
  assert.equal(manifest.draftHasLlmArtifact, false);
  assert.equal(
    await pathExists(path.join(result.snapshotDir, "published", "llm.json")),
    false
  );
  assert.equal(
    await pathExists(path.join(result.snapshotDir, "draft", "llm.json")),
    false
  );
  assert.equal(
    await pathExists(path.join(result.snapshotDir, "published", "agent.json")),
    true
  );
  assert.equal(llmRetrieveCalls, 0);
});

test("restoreRetellConfig preserves retell-llm restore behavior for existing snapshots", async () => {
  const backendDir = await mkdtemp(
    path.join(tmpdir(), "ai-ses-retell-restore-llm-")
  );
  const snapshotDir = path.join(backendDir, "snapshot");
  const llmCreatePayloads: Record<string, unknown>[] = [];
  const agentCreatePayloads: Record<string, unknown>[] = [];

  await writeJson(path.join(snapshotDir, "manifest.json"), {
    usedVoiceIds: []
  });
  await writeJson(path.join(snapshotDir, "draft", "agent.json"), {
    agent_id: "agent_source",
    agent_name: "Restore Retell LLM",
    voice_id: "voice_existing",
    response_engine: {
      type: "retell-llm",
      llm_id: "llm_source",
      version: 3
    },
    webhook_url: "https://example.com/webhook"
  });
  await writeJson(path.join(snapshotDir, "draft", "llm.json"), {
    llm_id: "llm_source",
    general_prompt: "Hello from snapshot.",
    model: "gpt-test",
    model_temperature: 0.3,
    model_high_priority: true,
    tool_call_strict_mode: false,
    begin_message: "Snapshot begin message.",
    default_dynamic_variables: {
      office_id: "22222222-2222-4222-8222-222222222222"
    },
    kb_config: {
      top_k: 4
    },
    states: [
      {
        name: "listing_help",
        tools: [
          {
            name: "search_listings",
            type: "custom",
            url: "https://backend.example.com/v1/retell/tools"
          }
        ]
      }
    ]
  });

  const retell = {
    voice: {
      async list() {
        return [];
      },
      async clone() {
        throw new Error("voice.clone should not be called");
      }
    },
    llm: {
      async create(payload: Record<string, unknown>) {
        llmCreatePayloads.push(payload);
        return { llm_id: "llm_new", version: 9 };
      }
    },
    agent: {
      async create(payload: Record<string, unknown>) {
        agentCreatePayloads.push(payload);
        return { agent_id: "agent_new" };
      },
      async publish() {
        throw new Error("agent.publish should not be called");
      },
      async getVersions() {
        return [];
      }
    }
  };

  const result = await restoreRetellConfig({
    retell: retell as never,
    snapshotDir,
    source: "draft",
    publishAgent: false,
    backendDir
  });

  assert.equal(llmCreatePayloads.length, 1);
  assert.equal(agentCreatePayloads.length, 1);
  const expectedRendered = renderRetellPromptSource({
    toolEndpointUrl: "https://backend.example.com/v1/retell/tools",
    model: "gpt-test",
    modelTemperature: 0.3,
    modelHighPriority: true,
    toolCallStrictMode: false,
    beginMessage: "Snapshot begin message."
  });
  assert.equal(llmCreatePayloads[0]?.general_prompt, expectedRendered.general_prompt);
  assert.deepEqual(llmCreatePayloads[0]?.states, expectedRendered.states);
  assert.deepEqual(llmCreatePayloads[0]?.general_tools, expectedRendered.general_tools);
  assert.equal(llmCreatePayloads[0]?.starting_state, expectedRendered.starting_state);
  assert.equal(llmCreatePayloads[0]?.begin_message, expectedRendered.begin_message);
  assert.deepEqual(llmCreatePayloads[0]?.default_dynamic_variables, {
    office_id: "22222222-2222-4222-8222-222222222222"
  });
  assert.deepEqual(llmCreatePayloads[0]?.kb_config, {
    top_k: 4
  });
  assert.deepEqual(agentCreatePayloads[0]?.response_engine, {
    type: "retell-llm",
    llm_id: "llm_new",
    version: 9
  });
  assert.equal(result.sourceLlmId, "llm_source");
  assert.equal(result.newLlmId, "llm_new");
  assert.equal(result.sourceResponseEngineType, "retell-llm");
});

test("restoreRetellConfig accepts snapshots without llm.json for custom-llm agents", async () => {
  const backendDir = await mkdtemp(
    path.join(tmpdir(), "ai-ses-retell-restore-custom-")
  );
  const snapshotDir = path.join(backendDir, "snapshot");
  const agentCreatePayloads: Record<string, unknown>[] = [];
  let llmCreateCalls = 0;

  await writeJson(path.join(snapshotDir, "manifest.json"), {
    usedVoiceIds: []
  });
  await writeJson(path.join(snapshotDir, "draft", "agent.json"), {
    agent_id: "agent_source_custom",
    agent_name: "Restore Custom LLM",
    voice_id: "voice_existing",
    response_engine: {
      type: "custom-llm",
      llm_websocket_url: "wss://custom.example/ws"
    },
    webhook_url: "https://example.com/custom-webhook"
  });

  const retell = {
    voice: {
      async list() {
        return [];
      },
      async clone() {
        throw new Error("voice.clone should not be called");
      }
    },
    llm: {
      async create() {
        llmCreateCalls += 1;
        throw new Error("llm.create should not be called");
      }
    },
    agent: {
      async create(payload: Record<string, unknown>) {
        agentCreatePayloads.push(payload);
        return { agent_id: "agent_custom_new" };
      },
      async publish() {
        throw new Error("agent.publish should not be called");
      },
      async getVersions() {
        return [];
      }
    }
  };

  const result = await restoreRetellConfig({
    retell: retell as never,
    snapshotDir,
    source: "draft",
    publishAgent: false,
    backendDir
  });

  assert.equal(llmCreateCalls, 0);
  assert.equal(agentCreatePayloads.length, 1);
  assert.deepEqual(agentCreatePayloads[0]?.response_engine, {
    type: "custom-llm",
    llm_websocket_url: "wss://custom.example/ws"
  });
  assert.equal(result.sourceLlmId, null);
  assert.equal(result.newLlmId, null);
  assert.equal(result.sourceResponseEngineType, "custom-llm");
});
