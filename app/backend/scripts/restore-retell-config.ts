import { config as loadEnv } from "dotenv";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import Retell from "retell-sdk";
import { renderRetellPromptSource } from "../src/modules/retell/prompt-source/index.js";

loadEnv({ path: new URL("../.env", import.meta.url) });

type JsonObject = Record<string, unknown>;
type VoiceProvider = "elevenlabs" | "cartesia" | "minimax" | "fish_audio" | "platform";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..");
const defaultSnapshotDir = path.join(
  backendDir,
  ".tmp",
  "retell-account-snapshots",
  "latest"
);
const execFileAsync = promisify(execFile);

export type SnapshotSource = "published" | "draft";

type RestoredResponseEngine =
  | {
      type: "retell-llm";
      llm_id: string;
      version?: number | null;
    }
  | {
      type: "custom-llm";
      llm_websocket_url: string;
    }
  | {
      type: "conversation-flow";
      conversation_flow_id: string;
      version?: number | null;
    };

type RetellRestoreClient = Pick<Retell, "agent" | "llm" | "voice">;

export interface RestoreRetellConfigParams {
  retell: RetellRestoreClient;
  snapshotDir?: string;
  source?: SnapshotSource;
  publishAgent?: boolean;
  backendDir?: string;
}

export interface RestoreRetellConfigResult {
  ok: true;
  restoredAt: string;
  sourceSnapshotDir: string;
  source: SnapshotSource;
  sourceAgentId: string | null;
  sourceLlmId: string | null;
  sourceResponseEngineType: RestoredResponseEngine["type"];
  newAgentId: string;
  newLlmId: string | null;
  publishedAgentVersion: number | null;
  latestDraftAgentVersion: number | null;
  voiceMap: Record<string, string>;
  phoneBindingTransferred: false;
  notes: string[];
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object for ${label}`);
  }

  return value as JsonObject;
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function readOptionalJson(filePath: string) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

function pick<T extends JsonObject, K extends keyof T>(value: T, keys: K[]) {
  const next: Partial<T> = {};

  for (const key of keys) {
    if (key in value && value[key] !== undefined) {
      next[key] = value[key];
    }
  }

  return next;
}

function sanitizeLlmPayload(raw: JsonObject) {
  return pick(raw, [
    "begin_after_user_silence_ms",
    "begin_message",
    "default_dynamic_variables",
    "general_prompt",
    "general_tools",
    "kb_config",
    "knowledge_base_ids",
    "mcps",
    "model",
    "model_high_priority",
    "model_temperature",
    "s2s_model",
    "start_speaker",
    "starting_state",
    "states",
    "tool_call_strict_mode"
  ]);
}

function extractPromptSourceToolEndpointUrl(raw: JsonObject) {
  const states = Array.isArray(raw.states) ? raw.states : [];

  for (const state of states) {
    if (!state || typeof state !== "object" || !("tools" in state)) {
      continue;
    }

    const tools = Array.isArray(state.tools) ? state.tools : [];

    for (const tool of tools) {
      if (
        tool &&
        typeof tool === "object" &&
        "type" in tool &&
        tool.type === "custom" &&
        "url" in tool &&
        typeof tool.url === "string" &&
        tool.url.trim().length > 0
      ) {
        return tool.url;
      }
    }
  }

  throw new Error(
    "Snapshot llm payload does not include a custom tool URL for repo prompt rendering."
  );
}

function buildRepoOwnedRetellLlmPayload(raw: JsonObject) {
  const toolEndpointUrl = extractPromptSourceToolEndpointUrl(raw);
  const rendered = renderRetellPromptSource({
    toolEndpointUrl,
    model: typeof raw.model === "string" ? raw.model : undefined,
    modelTemperature:
      typeof raw.model_temperature === "number"
        ? raw.model_temperature
        : undefined,
    modelHighPriority:
      typeof raw.model_high_priority === "boolean"
        ? raw.model_high_priority
        : undefined,
    toolCallStrictMode:
      typeof raw.tool_call_strict_mode === "boolean"
        ? raw.tool_call_strict_mode
        : undefined,
    beginMessage: typeof raw.begin_message === "string" ? raw.begin_message : undefined
  });

  return {
    ...pick(raw, [
      "begin_after_user_silence_ms",
      "default_dynamic_variables",
      "kb_config",
      "knowledge_base_ids",
      "mcps",
      "s2s_model"
    ]),
    ...rendered
  };
}

function sanitizeSnapshotResponseEngine(raw: JsonObject): RestoredResponseEngine {
  const type = raw.type;

  if (type === "retell-llm") {
    if (typeof raw.llm_id !== "string") {
      throw new Error("Snapshot retell-llm response engine is missing llm_id");
    }

    return {
      type,
      llm_id: raw.llm_id,
      ...(typeof raw.version === "number" ? { version: raw.version } : {})
    };
  }

  if (type === "custom-llm") {
    if (typeof raw.llm_websocket_url !== "string") {
      throw new Error(
        "Snapshot custom-llm response engine is missing llm_websocket_url"
      );
    }

    return {
      type,
      llm_websocket_url: raw.llm_websocket_url
    };
  }

  if (type === "conversation-flow") {
    if (typeof raw.conversation_flow_id !== "string") {
      throw new Error(
        "Snapshot conversation-flow response engine is missing conversation_flow_id"
      );
    }

    return {
      type,
      conversation_flow_id: raw.conversation_flow_id,
      ...(typeof raw.version === "number" ? { version: raw.version } : {})
    };
  }

  throw new Error("Snapshot agent has an unsupported response_engine type");
}

function sanitizeAgentPayload(
  raw: JsonObject,
  responseEngine: RestoredResponseEngine
) {
  const payload = pick(raw, [
    "agent_name",
    "allow_user_dtmf",
    "analysis_successful_prompt",
    "analysis_summary_prompt",
    "analysis_user_sentiment_prompt",
    "boosted_keywords",
    "data_storage_setting",
    "fallback_voice_ids",
    "interruption_sensitivity",
    "language",
    "max_call_duration_ms",
    "normalize_for_speech",
    "opt_in_signed_url",
    "pii_config",
    "post_call_analysis_data",
    "post_call_analysis_model",
    "version_description",
    "voice_id",
    "voice_speed",
    "webhook_timeout_ms",
    "webhook_url",
    "channel",
    "user_dtmf_options"
  ]) as JsonObject;

  payload.response_engine = responseEngine as unknown as JsonObject;

  return payload;
}

async function ensureVoice(retell: RetellRestoreClient, snapshotVoice: JsonObject) {
  const voiceName = snapshotVoice.voice_name;
  const provider = snapshotVoice.provider;

  if (typeof voiceName !== "string" || typeof provider !== "string") {
    throw new Error("Snapshot voice is missing voice_name/provider");
  }

  const available = await retell.voice.list();
  const existing = available.find(
    (voice) => voice.voice_name === voiceName && voice.provider === provider
  );

  if (existing) {
    return existing.voice_id;
  }

  const previewUrl = snapshotVoice.preview_audio_url;
  if (typeof previewUrl !== "string") {
    throw new Error(`Voice ${voiceName} cannot be restored: missing preview_audio_url`);
  }

  if (
    provider !== "elevenlabs" &&
    provider !== "cartesia" &&
    provider !== "minimax" &&
    provider !== "fish_audio" &&
    provider !== "platform"
  ) {
    throw new Error(`Voice ${voiceName} cannot be restored: unsupported provider ${provider}`);
  }

  const tempDir = path.join(backendDir, ".tmp", "retell-voice-clone");
  const tempFile = path.join(
    tempDir,
    `${voiceName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp3`
  );
  const preparedFile =
    provider === "minimax"
      ? path.join(
          tempDir,
          `${voiceName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-prepared.mp3`
        )
      : tempFile;

  await mkdir(tempDir, { recursive: true });

  const response = await fetch(previewUrl);
  if (!response.ok) {
    throw new Error(`Voice preview download failed for ${voiceName}: ${response.status}`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(tempFile, fileBuffer);

  if (provider === "minimax") {
    await execFileAsync("ffmpeg", [
      "-y",
      "-stream_loop",
      "2",
      "-i",
      tempFile,
      "-t",
      "12",
      preparedFile
    ]);
  }

  try {
    const created = await retell.voice.clone({
      voice_name: voiceName,
      voice_provider: provider as VoiceProvider,
      files: [createReadStream(preparedFile)]
    });

    return created.voice_id;
  } finally {
    await rm(tempFile, { force: true });
    if (preparedFile !== tempFile) {
      await rm(preparedFile, { force: true });
    }
  }
}

export async function restoreRetellConfig({
  retell,
  snapshotDir = defaultSnapshotDir,
  source = "draft",
  publishAgent = true,
  backendDir: workingBackendDir = backendDir
}: RestoreRetellConfigParams): Promise<RestoreRetellConfigResult> {
  const manifest = asObject(
    await readJson(path.join(snapshotDir, "manifest.json")),
    "manifest"
  );
  const agentRaw = asObject(
    await readJson(path.join(snapshotDir, source, "agent.json")),
    `${source} agent`
  );
  const sourceResponseEngine = sanitizeSnapshotResponseEngine(
    asObject(agentRaw.response_engine, `${source} agent response_engine`)
  );

  const voiceIds = Array.isArray(manifest.usedVoiceIds)
    ? manifest.usedVoiceIds.filter((value): value is string => typeof value === "string")
    : [];

  const voiceMap = new Map<string, string>();

  for (const oldVoiceId of voiceIds) {
    const snapshotVoice = asObject(
      await readJson(path.join(snapshotDir, "voices", `${oldVoiceId}.json`)),
      `voice ${oldVoiceId}`
    );
    const newVoiceId = await ensureVoice(retell, snapshotVoice);
    voiceMap.set(oldVoiceId, newVoiceId);
  }

  let sourceLlmId: string | null = null;
  let newLlmId: string | null = null;
  let agentResponseEngine: RestoredResponseEngine;

  if (sourceResponseEngine.type === "retell-llm") {
    const llmSnapshot = await readOptionalJson(path.join(snapshotDir, source, "llm.json"));

    if (llmSnapshot === null) {
      throw new Error(
        `Snapshot ${source}/llm.json is required when response_engine.type is retell-llm.`
      );
    }

    const llmRaw = asObject(llmSnapshot, `${source} llm`);
    const llmPayload = buildRepoOwnedRetellLlmPayload(llmRaw);
    const createdLlm = await retell.llm.create(llmPayload as never);

    sourceLlmId = sourceResponseEngine.llm_id;
    newLlmId = createdLlm.llm_id;
    agentResponseEngine = {
      type: "retell-llm",
      llm_id: createdLlm.llm_id,
      ...(typeof createdLlm.version === "number"
        ? { version: createdLlm.version }
        : {})
    };
  } else {
    agentResponseEngine = sourceResponseEngine;
  }

  const agentPayload = sanitizeAgentPayload(agentRaw, agentResponseEngine);

  const primaryVoiceId = agentPayload.voice_id;
  if (typeof primaryVoiceId === "string" && voiceMap.has(primaryVoiceId)) {
    agentPayload.voice_id = voiceMap.get(primaryVoiceId);
  }

  if (Array.isArray(agentPayload.fallback_voice_ids)) {
    agentPayload.fallback_voice_ids = agentPayload.fallback_voice_ids
      .map((voiceId) =>
        typeof voiceId === "string" && voiceMap.has(voiceId)
          ? voiceMap.get(voiceId)
          : voiceId
      )
      .filter((voiceId): voiceId is string => typeof voiceId === "string");
  }

  const createdAgent = await retell.agent.create(agentPayload as never);

  if (publishAgent) {
    try {
      await retell.agent.publish(createdAgent.agent_id);
    } catch (error) {
      const versions = await retell.agent.getVersions(createdAgent.agent_id);
      const hasPublishedVersion = versions.some((version) => version.is_published);

      if (
        !(
          error instanceof SyntaxError &&
          hasPublishedVersion
        )
      ) {
        throw error;
      }
    }
  }

  const versions = await retell.agent.getVersions(createdAgent.agent_id);
  const publishedVersion =
    versions
      .filter((version) => version.is_published)
      .sort((a, b) => b.version - a.version)[0]?.version ?? null;
  const latestDraftVersion =
    versions
      .filter((version) => !version.is_published)
      .sort((a, b) => b.version - a.version)[0]?.version ?? null;

  const restoreTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const restoreDir = path.join(
    workingBackendDir,
    ".tmp",
    "retell-account-snapshots",
    "restores"
  );
  const restoreResult = {
    ok: true,
    restoredAt: new Date().toISOString(),
    sourceSnapshotDir: snapshotDir,
    source,
    sourceAgentId: agentRaw.agent_id ?? null,
    sourceLlmId,
    sourceResponseEngineType: sourceResponseEngine.type,
    newAgentId: createdAgent.agent_id,
    newLlmId,
    publishedAgentVersion: publishedVersion,
    latestDraftAgentVersion: latestDraftVersion,
    voiceMap: Object.fromEntries(voiceMap),
    phoneBindingTransferred: false,
    notes: [
      "Phone numbers are account-bound and were not transferred automatically.",
      "Webhook URL and tool URLs were copied from the snapshot payload.",
      "Custom voices were recreated from snapshot preview audio when missing."
    ]
  } satisfies RestoreRetellConfigResult;

  await mkdir(restoreDir, { recursive: true });
  await writeFile(
    path.join(restoreDir, `${restoreTimestamp}.json`),
    `${JSON.stringify(restoreResult, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(restoreDir, "latest.json"),
    `${JSON.stringify(restoreResult, null, 2)}\n`,
    "utf8"
  );

  return restoreResult;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      snapshotDir: { type: "string" },
      source: { type: "string" },
      publish: { type: "boolean" }
    }
  });
  const apiKey = process.env.RETELL_API_KEY;

  if (!apiKey) {
    throw new Error("Missing RETELL_API_KEY in app/backend/.env");
  }

  const result = await restoreRetellConfig({
    retell: new Retell({ apiKey }),
    snapshotDir: values.snapshotDir ?? defaultSnapshotDir,
    source: values.source === "published" ? "published" : "draft",
    publishAgent: values.publish ?? true
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
