import { config as loadEnv } from "dotenv";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Retell from "retell-sdk";

loadEnv({ path: new URL("../.env", import.meta.url) });

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..");
const defaultSnapshotsRoot = path.join(
  backendDir,
  ".tmp",
  "retell-account-snapshots"
);

type SnapshotLabel = "published" | "draft";

interface LlmRef {
  label: SnapshotLabel;
  id: string;
  version: number;
}

interface LlmEntry extends LlmRef {
  llm: unknown;
}

type RetellExportClient = Pick<
  Retell,
  "agent" | "llm" | "voice" | "knowledgeBase" | "phoneNumber"
>;

interface ExportRetellConfigParams {
  retell: RetellExportClient;
  agentId: string;
  snapshotsRoot?: string;
  exportedAt?: Date;
}

export interface ExportRetellConfigResult {
  ok: true;
  snapshotDir: string;
  latestDir: string;
  publishedAgentVersion: number;
  publishedLlmVersion: number | null;
  draftAgentVersion: number | null;
  draftLlmVersion: number | null;
  boundPhoneNumbers: number;
  usedVoiceIds: string[];
}

function sanitizeTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

async function writeJson(filePath: string, value: JsonValue) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function extractVoiceIds(agent: Record<string, unknown>) {
  const primary = typeof agent.voice_id === "string" ? [agent.voice_id] : [];
  const fallbacks = Array.isArray(agent.fallback_voice_ids)
    ? agent.fallback_voice_ids.filter(
        (voiceId): voiceId is string => typeof voiceId === "string"
      )
    : [];

  return unique([...primary, ...fallbacks]);
}

function collectLlmRefs(
  publishedAgent: Awaited<ReturnType<Retell["agent"]["retrieve"]>>,
  draftAgent: Awaited<ReturnType<Retell["agent"]["retrieve"]>> | null
) {
  return unique(
    [
      {
        id:
          publishedAgent.response_engine.type === "retell-llm"
            ? publishedAgent.response_engine.llm_id
            : null,
        version:
          publishedAgent.response_engine.type === "retell-llm"
            ? publishedAgent.response_engine.version
            : null,
        label: "published"
      },
      {
        id:
          draftAgent?.response_engine.type === "retell-llm"
            ? draftAgent.response_engine.llm_id
            : null,
        version:
          draftAgent?.response_engine.type === "retell-llm"
            ? draftAgent.response_engine.version
            : null,
        label: "draft"
      }
    ]
      .filter(
        (
          ref
        ): ref is {
          id: string;
          version: number;
          label: SnapshotLabel;
        } => typeof ref.id === "string" && typeof ref.version === "number"
      )
      .map((ref) => `${ref.label}|${ref.id}|${ref.version}`)
  ).map((key) => {
    const [label, id, version] = key.split("|");
    return {
      label: label as SnapshotLabel,
      id,
      version: Number(version)
    };
  });
}

function mapLlmEntriesByLabel(entries: LlmEntry[]) {
  return Object.fromEntries(
    entries.map((entry) => [entry.label, entry])
  ) as Partial<Record<SnapshotLabel, LlmEntry>>;
}

function isPhoneBoundToAgent(
  phoneNumber: Record<string, unknown>,
  targetAgentId: string
) {
  const singleInbound =
    typeof phoneNumber.inbound_agent_id === "string" &&
    phoneNumber.inbound_agent_id === targetAgentId;
  const singleOutbound =
    typeof phoneNumber.outbound_agent_id === "string" &&
    phoneNumber.outbound_agent_id === targetAgentId;
  const inboundPool =
    Array.isArray(phoneNumber.inbound_agents) &&
    phoneNumber.inbound_agents.some(
      (agent) =>
        !!agent &&
        typeof agent === "object" &&
        "agent_id" in agent &&
        agent.agent_id === targetAgentId
    );
  const outboundPool =
    Array.isArray(phoneNumber.outbound_agents) &&
    phoneNumber.outbound_agents.some(
      (agent) =>
        !!agent &&
        typeof agent === "object" &&
        "agent_id" in agent &&
        agent.agent_id === targetAgentId
    );

  return singleInbound || singleOutbound || inboundPool || outboundPool;
}

async function safeRetrieveVoice(retell: RetellExportClient, voiceId: string) {
  try {
    return await retell.voice.retrieve(voiceId);
  } catch (error) {
    return {
      voice_id: voiceId,
      export_error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

async function safeRetrieveKnowledgeBase(
  retell: RetellExportClient,
  knowledgeBaseId: string
) {
  try {
    return await retell.knowledgeBase.retrieve(knowledgeBaseId);
  } catch (error) {
    return {
      knowledge_base_id: knowledgeBaseId,
      export_error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export async function exportRetellConfig({
  retell,
  agentId,
  snapshotsRoot = defaultSnapshotsRoot,
  exportedAt = new Date()
}: ExportRetellConfigParams): Promise<ExportRetellConfigResult> {
  const agentVersions = await retell.agent.getVersions(agentId);
  const sortedVersions = [...agentVersions].sort((a, b) => a.version - b.version);
  const publishedVersions = sortedVersions.filter((version) => version.is_published);
  const draftVersions = sortedVersions.filter((version) => !version.is_published);
  const published = publishedVersions.at(-1);
  const draft = draftVersions.at(-1);

  if (!published) {
    throw new Error(`No published agent version found for ${agentId}`);
  }

  const snapshotName = `${agentId}_${sanitizeTimestamp(exportedAt)}`;
  const snapshotDir = path.join(snapshotsRoot, snapshotName);
  const latestDir = path.join(snapshotsRoot, "latest");

  const publishedAgent = await retell.agent.retrieve(agentId, {
    version: published.version
  });
  const draftAgent = draft
    ? await retell.agent.retrieve(agentId, { version: draft.version })
    : null;

  const llmRefs = collectLlmRefs(publishedAgent, draftAgent);

  const llmEntries = await Promise.all(
    llmRefs.map(async (ref) => ({
      ...ref,
      llm: await retell.llm.retrieve(ref.id, { version: ref.version })
    }))
  );

  const llmByLabel = mapLlmEntriesByLabel(llmEntries);

  const voiceIds = unique([
    ...extractVoiceIds(publishedAgent as unknown as Record<string, unknown>),
    ...extractVoiceIds(
      (draftAgent ?? {}) as unknown as Record<string, unknown>
    )
  ]);

  const voices = await Promise.all(
    voiceIds.map(async (voiceId) => ({
      voiceId,
      detail: await safeRetrieveVoice(retell, voiceId)
    }))
  );

  const phoneNumbers = await retell.phoneNumber.list();
  const boundPhoneNumbers = phoneNumbers.filter((phoneNumber) =>
    isPhoneBoundToAgent(phoneNumber as unknown as Record<string, unknown>, agentId)
  );

  const knowledgeBaseIds = unique(
    llmEntries.flatMap((entry) =>
      Array.isArray((entry.llm as { knowledge_base_ids?: string[] }).knowledge_base_ids)
        ? ((entry.llm as { knowledge_base_ids?: string[] }).knowledge_base_ids ?? [])
        : []
    )
  );

  const knowledgeBases = await Promise.all(
    knowledgeBaseIds.map(async (knowledgeBaseId) => ({
      knowledgeBaseId,
      detail: await safeRetrieveKnowledgeBase(retell, knowledgeBaseId)
    }))
  );

  const manifest = {
    exportedAt: exportedAt.toISOString(),
    snapshotName,
    agentId,
    publishedAgentVersion: published.version,
    publishedLlmVersion:
      publishedAgent.response_engine.type === "retell-llm"
        ? publishedAgent.response_engine.version
        : null,
    draftAgentVersion: draft?.version ?? null,
    draftLlmVersion:
      draftAgent?.response_engine.type === "retell-llm"
        ? draftAgent.response_engine.version
        : null,
    responseEngineType: publishedAgent.response_engine.type,
    draftResponseEngineType: draftAgent?.response_engine.type ?? null,
    publishedHasLlmArtifact: Boolean(llmByLabel.published),
    draftHasLlmArtifact: Boolean(llmByLabel.draft),
    usedVoiceIds: voiceIds,
    boundPhoneNumbers: boundPhoneNumbers.map((phoneNumber) => ({
      phone_number: phoneNumber.phone_number,
      nickname: phoneNumber.nickname ?? null,
      inbound_agent_id: phoneNumber.inbound_agent_id ?? null,
      inbound_agent_version: phoneNumber.inbound_agent_version ?? null,
      outbound_agent_id: phoneNumber.outbound_agent_id ?? null,
      outbound_agent_version: phoneNumber.outbound_agent_version ?? null
    })),
    knowledgeBaseIds
  } satisfies JsonValue;

  const restoreNotes = [
    "# Retell Restore Notes",
    "",
    `Exported at: ${exportedAt.toISOString()}`,
    `Agent ID: ${agentId}`,
    `Published agent/llm: v${published.version} / v${manifest.publishedLlmVersion ?? "n/a"}`,
    `Draft agent/llm: ${draft ? `v${draft.version} / v${manifest.draftLlmVersion ?? "n/a"}` : "none"}`,
    "",
    "## Recreate On A New Account",
    "",
    "1. If `published/llm.json` or `draft/llm.json` exists, recreate the Retell LLM from that file.",
    "2. Recreate the agent from `published/agent.json` or `draft/agent.json`. For non-`retell-llm` snapshots, reuse the exported `response_engine` block directly.",
    "3. Reapply voice settings using `voices/*.json`.",
    "4. Recreate any knowledge bases listed in `knowledge-bases/*.json` if they exist.",
    "5. Rebind or repurchase phone numbers using `phone-numbers/bound-to-agent.json`.",
    "6. Repoint inbound webhook and any MCP/KB ids to the new account resources.",
    "",
    "## Account-Bound IDs",
    "",
    "- `agent_id`, `llm_id`, `voice_id`, `knowledge_base_id`, `conversation_flow_id`, `mcp_id`, and phone-number bindings are account-specific.",
    "- Prompts, states, tool descriptions, voice parameters, webhook URLs, and most runtime settings can be copied from these files.",
    "- Custom voices may need to be recloned or re-added in the new account."
  ].join("\n");

  await mkdir(snapshotDir, { recursive: true });

  await writeJson(path.join(snapshotDir, "manifest.json"), manifest);
  await writeJson(
    path.join(snapshotDir, "agent-versions.json"),
    sortedVersions as unknown as JsonValue
  );
  await writeJson(
    path.join(snapshotDir, "published", "agent.json"),
    publishedAgent as unknown as JsonValue
  );
  if (llmByLabel.published) {
    await writeJson(
      path.join(snapshotDir, "published", "llm.json"),
      llmByLabel.published.llm as JsonValue
    );
  }

  if (draftAgent) {
    await writeJson(
      path.join(snapshotDir, "draft", "agent.json"),
      draftAgent as unknown as JsonValue
    );
  }

  if (llmByLabel.draft) {
    await writeJson(
      path.join(snapshotDir, "draft", "llm.json"),
      llmByLabel.draft.llm as JsonValue
    );
  }

  await writeJson(
    path.join(snapshotDir, "phone-numbers", "bound-to-agent.json"),
    boundPhoneNumbers as unknown as JsonValue
  );
  await writeJson(
    path.join(snapshotDir, "phone-numbers", "all.json"),
    phoneNumbers as unknown as JsonValue
  );

  for (const voice of voices) {
    await writeJson(
      path.join(snapshotDir, "voices", `${voice.voiceId}.json`),
      voice.detail as unknown as JsonValue
    );
  }

  for (const knowledgeBase of knowledgeBases) {
    await writeJson(
      path.join(
        snapshotDir,
        "knowledge-bases",
        `${knowledgeBase.knowledgeBaseId}.json`
      ),
      knowledgeBase.detail as unknown as JsonValue
    );
  }

  await writeFile(path.join(snapshotDir, "RESTORE.md"), `${restoreNotes}\n`, "utf8");

  await rm(latestDir, { recursive: true, force: true });
  await cp(snapshotDir, latestDir, { recursive: true });

  return {
    ok: true,
    snapshotDir,
    latestDir,
    publishedAgentVersion: published.version,
    publishedLlmVersion: manifest.publishedLlmVersion,
    draftAgentVersion: draft?.version ?? null,
    draftLlmVersion: manifest.draftLlmVersion,
    boundPhoneNumbers: manifest.boundPhoneNumbers.length,
    usedVoiceIds: voiceIds
  };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      agentId: { type: "string" },
      outDir: { type: "string" }
    }
  });
  const apiKey = process.env.RETELL_API_KEY;
  const agentId = values.agentId;

  if (!apiKey) {
    throw new Error("Missing RETELL_API_KEY in app/backend/.env");
  }

  if (!agentId) {
    throw new Error(
      "Missing --agentId. Example: npm run retell:export-config -- --agentId agent_xxx"
    );
  }

  const result = await exportRetellConfig({
    retell: new Retell({ apiKey }),
    agentId,
    snapshotsRoot: values.outDir ?? defaultSnapshotsRoot
  });

  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exitCode = 1;
  });
}
