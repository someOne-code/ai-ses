import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { and, asc, eq, inArray } from "drizzle-orm";
import Retell from "retell-sdk";

import { db } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/index.js";

loadEnv({ path: new URL("../.env", import.meta.url) });

const DEFAULT_PORT = 8787;
const DEFAULT_OFFICE_ID = "22222222-2222-4222-8222-222222222222";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    agentId: { type: "string" },
    agentVersion: { type: "string" },
    officeId: { type: "string" },
    port: { type: "string" }
  }
});

const agentId = values.agentId;
const agentVersion =
  values.agentVersion !== undefined ? Number(values.agentVersion) : undefined;
const officeId = values.officeId ?? DEFAULT_OFFICE_ID;
const port = Number(values.port ?? DEFAULT_PORT);
const apiKey = process.env.RETELL_API_KEY;

if (!apiKey) {
  throw new Error("Missing RETELL_API_KEY in app/backend/.env");
}

if (!agentId) {
  throw new Error(
    "Missing --agentId. Example: npm run smoke:retell-web-call -- --agentId agent_xxx"
  );
}

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid port: ${values.port ?? DEFAULT_PORT}`);
}

if (
  agentVersion !== undefined &&
  (!Number.isInteger(agentVersion) || agentVersion < 0)
) {
  throw new Error(`Invalid agentVersion: ${values.agentVersion}`);
}

const retell = new Retell({ apiKey });

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function summarizeToolArgs(
  toolName: string,
  args: Record<string, unknown> | null
): string | null {
  if (!args) {
    return null;
  }

  if (toolName === "search_listings") {
    const parts = [
      typeof args.district === "string" ? `ilce=${args.district}` : null,
      typeof args.neighborhood === "string"
        ? `mahalle=${args.neighborhood}`
        : null,
      typeof args.listingType === "string"
        ? `tip=${args.listingType}`
        : null,
      typeof args.maxPrice === "number" ? `max=${args.maxPrice}` : null,
      typeof args.queryText === "string" ? `niyet=${args.queryText}` : null
    ].filter((part): part is string => part !== null);

    return parts.length > 0 ? parts.join(" | ") : null;
  }

  if (toolName === "get_listing_by_reference") {
    return typeof args.referenceCode === "string"
      ? `kod=${args.referenceCode}`
      : null;
  }

  if (toolName === "create_showing_request") {
    const parts = [
      typeof args.listingId === "string" ? `listingId hazir` : null,
      typeof args.preferredTimeWindow === "string"
        ? `aralik=${args.preferredTimeWindow}`
        : null,
      typeof args.preferredDatetime === "string" ? "tarih hazir" : null
    ].filter((part): part is string => part !== null);

    return parts.length > 0 ? parts.join(" | ") : null;
  }

  return null;
}

async function getToolEvents(callId: string) {
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      payload: auditEvents.payload,
      createdAt: auditEvents.createdAt
    })
    .from(auditEvents)
    .where(
      and(
        inArray(auditEvents.action, [
          "retell.tool.executed",
          "retell.tool.failed"
        ]),
        eq(auditEvents.actorId, callId)
      )
    )
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));

  return rows.flatMap((row) => {
    const payload = asRecord(row.payload);
    const tool =
      typeof payload?.tool === "string" && payload.tool.trim() !== ""
        ? payload.tool
        : null;

    if (!tool) {
      return [];
    }

    const success = payload?.success === false ? false : true;
    const args = asRecord(payload?.args);
    const errorCode =
      typeof payload?.errorCode === "string" ? payload.errorCode : null;

    return [{
      id: row.id,
      tool,
      success,
      errorCode,
      summary: summarizeToolArgs(tool, args),
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt as string).toISOString()
    }];
  });
}

const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ai-ses Retell Web Call Smoke</title>
    <style>
      :root {
        color-scheme: light;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f5f2ea;
        color: #1f2937;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(214, 189, 152, 0.35), transparent 30%),
          linear-gradient(180deg, #f7f3ec 0%, #efe7db 100%);
      }
      main {
        width: min(720px, calc(100vw - 32px));
        background: rgba(255, 255, 255, 0.84);
        border: 1px solid rgba(162, 123, 76, 0.2);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 24px 80px rgba(74, 52, 31, 0.14);
        backdrop-filter: blur(12px);
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(1.6rem, 2vw, 2rem);
      }
      p {
        margin: 0 0 16px;
        line-height: 1.55;
      }
      .meta {
        display: grid;
        gap: 10px;
        margin: 20px 0;
        padding: 16px;
        border-radius: 16px;
        background: #faf6ef;
      }
      .meta code {
        font-size: 0.95rem;
        word-break: break-all;
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin: 20px 0;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        cursor: pointer;
      }
      #start {
        background: #1f6d4f;
        color: white;
      }
      #stop {
        background: #d7c6ac;
        color: #3c2b1d;
      }
      #status, #events {
        margin-top: 16px;
        padding: 14px 16px;
        border-radius: 16px;
        background: #fff;
        border: 1px solid rgba(162, 123, 76, 0.16);
      }
      .panels {
        display: grid;
        gap: 16px;
        margin-top: 16px;
      }
      .panel {
        padding: 14px 16px;
        border-radius: 16px;
        background: #fff;
        border: 1px solid rgba(162, 123, 76, 0.16);
      }
      .panel h2 {
        margin: 0 0 10px;
        font-size: 1rem;
      }
      #events, #tool-events {
        min-height: 120px;
        white-space: pre-wrap;
      }
      #transcript {
        display: grid;
        gap: 10px;
        min-height: 120px;
      }
      #tool-events {
        display: grid;
        gap: 10px;
      }
      .placeholder {
        color: #6b7280;
      }
      .utterance {
        border-radius: 14px;
        padding: 10px 12px;
        background: #faf6ef;
      }
      .utterance.user {
        background: #eef6ff;
      }
      .utterance-role {
        display: block;
        margin-bottom: 4px;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #6b7280;
      }
      .utterance-content {
        line-height: 1.5;
      }
      .tool-event {
        border-radius: 14px;
        padding: 10px 12px;
        background: #f7faf7;
      }
      .tool-event.failed {
        background: #fff2f2;
      }
      .tool-title {
        display: block;
        margin-bottom: 4px;
        font-size: 0.85rem;
        font-weight: 700;
      }
      .tool-meta {
        color: #6b7280;
        line-height: 1.5;
        font-size: 0.92rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Retell Web Call Smoke</h1>
      <p>
        Bu sayfa local backend persistence testi icin gercek bir Retell web call
        baslatir. Start'a bastiginda access token server tarafinda uretilir ve
        call metadata icine office context yerlestirilir.
      </p>

      <div class="meta">
        <div><strong>Agent ID:</strong> <code>${agentId}</code></div>
        <div><strong>Agent Version:</strong> <code>${agentVersion ?? "latest draft"}</code></div>
        <div><strong>Office ID:</strong> <code>${officeId}</code></div>
        <div><strong>Backend webhook:</strong> <code>/v1/webhooks/retell</code></div>
      </div>

      <div class="actions">
        <button id="start">Start Call</button>
        <button id="stop" type="button">Stop Call</button>
      </div>

      <div id="status">Hazir.</div>
      <div class="panels">
        <section class="panel">
          <h2>Canli Transcript</h2>
          <div id="transcript">
            <div class="placeholder">Transcript burada akacak.</div>
          </div>
        </section>

        <section class="panel">
          <h2>Olaylar</h2>
          <div id="events">Onemli olaylar burada akacak.</div>
        </section>

        <section class="panel">
          <h2>Tool Cagrilari</h2>
          <div id="tool-events">
            <div class="placeholder">Tool cagrilari burada akacak.</div>
          </div>
        </section>
      </div>
    </main>

    <script type="module">
      import { RetellWebClient } from "https://esm.sh/retell-client-js-sdk";

      const client = new RetellWebClient();
      const statusEl = document.getElementById("status");
      const eventsEl = document.getElementById("events");
      const transcriptEl = document.getElementById("transcript");
      const toolEventsEl = document.getElementById("tool-events");
      let lastTurntaking = null;
      let lastEventMessage = null;
      let currentCallId = null;
      let toolPollInterval = null;
      let lastRenderedToolEventId = null;

      function resetPanels() {
        eventsEl.textContent = "Onemli olaylar burada akacak.";
        transcriptEl.replaceChildren();
        toolEventsEl.replaceChildren();
        const placeholder = document.createElement("div");
        placeholder.className = "placeholder";
        placeholder.textContent = "Transcript burada akacak.";
        transcriptEl.appendChild(placeholder);
        const toolPlaceholder = document.createElement("div");
        toolPlaceholder.className = "placeholder";
        toolPlaceholder.textContent = "Tool cagrilari burada akacak.";
        toolEventsEl.appendChild(toolPlaceholder);
        lastTurntaking = null;
        lastEventMessage = null;
        lastRenderedToolEventId = null;
      }

      function pushEvent(message) {
        if (message === lastEventMessage) {
          return;
        }

        lastEventMessage = message;
        const timestamp = new Date().toLocaleTimeString("tr-TR");

        if (eventsEl.textContent === "Onemli olaylar burada akacak.") {
          eventsEl.textContent = "";
        }

        eventsEl.textContent += (eventsEl.textContent ? "\\n" : "") + "[" + timestamp + "] " + message;
      }

      function roleLabel(role) {
        if (role === "agent") {
          return "Asistan";
        }

        if (role === "user") {
          return "Kullanici";
        }

        return "Bilinmeyen";
      }

      function renderTranscript(transcript) {
        transcriptEl.replaceChildren();

        if (!Array.isArray(transcript) || transcript.length === 0) {
          const placeholder = document.createElement("div");
          placeholder.className = "placeholder";
          placeholder.textContent = "Transcript burada akacak.";
          transcriptEl.appendChild(placeholder);
          return;
        }

        for (const utterance of transcript) {
          const item = document.createElement("div");
          item.className = "utterance " + (utterance.role === "user" ? "user" : "agent");

          const role = document.createElement("span");
          role.className = "utterance-role";
          role.textContent = roleLabel(utterance.role);

          const content = document.createElement("div");
          content.className = "utterance-content";
          content.textContent = typeof utterance.content === "string" && utterance.content.trim() !== ""
            ? utterance.content.trim()
            : "...";

          item.appendChild(role);
          item.appendChild(content);
          transcriptEl.appendChild(item);
        }
      }

      function renderToolEvents(events) {
        toolEventsEl.replaceChildren();

        if (!Array.isArray(events) || events.length === 0) {
          const placeholder = document.createElement("div");
          placeholder.className = "placeholder";
          placeholder.textContent = "Tool cagrilari burada akacak.";
          toolEventsEl.appendChild(placeholder);
          return;
        }

        for (const event of events) {
          const item = document.createElement("div");
          item.className = "tool-event " + (event.success ? "success" : "failed");

          const title = document.createElement("span");
          title.className = "tool-title";
          title.textContent = (event.success ? "OK" : "HATA") + " - " + event.tool;

          const meta = document.createElement("div");
          meta.className = "tool-meta";
          const parts = [];
          if (event.summary) {
            parts.push(event.summary);
          }
          if (event.errorCode) {
            parts.push("kod=" + event.errorCode);
          }
          meta.textContent = parts.length > 0 ? parts.join(" | ") : "Ek bilgi yok.";

          item.appendChild(title);
          item.appendChild(meta);
          toolEventsEl.appendChild(item);
        }
      }

      async function refreshToolEvents() {
        if (!currentCallId) {
          return;
        }

        try {
          const response = await fetch("/api/tool-events?callId=" + encodeURIComponent(currentCallId));
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "Tool eventleri alinamadi.");
          }

          renderToolEvents(payload.events);

          if (Array.isArray(payload.events) && payload.events.length > 0) {
            const lastEvent = payload.events[payload.events.length - 1];
            if (lastEvent?.id && lastEvent.id !== lastRenderedToolEventId) {
              lastRenderedToolEventId = lastEvent.id;
              pushEvent("tool: " + lastEvent.tool + (lastEvent.success ? "" : " (hata)"));
            }
          }
        } catch (error) {
          pushEvent(String(error));
        }
      }

      function stopToolPolling() {
        if (toolPollInterval) {
          clearInterval(toolPollInterval);
          toolPollInterval = null;
        }
      }

      function startToolPolling() {
        stopToolPolling();
        toolPollInterval = setInterval(() => {
          void refreshToolEvents();
        }, 1200);
      }

      client.on("call_started", () => {
        statusEl.textContent = "Call basladi.";
        pushEvent("call_started");
      });

      client.on("call_ended", () => {
        statusEl.textContent = "Call bitti.";
        pushEvent("call_ended");
        void refreshToolEvents();
        stopToolPolling();
      });

      client.on("error", (error) => {
        statusEl.textContent = "Hata olustu.";
        pushEvent("error: " + JSON.stringify(error));
      });

      client.on("update", (update) => {
        renderTranscript(update?.transcript);

        if (update?.turntaking && update.turntaking !== lastTurntaking) {
          lastTurntaking = update.turntaking;
          pushEvent(
            update.turntaking === "agent_turn"
              ? "sira asistanda"
              : update.turntaking === "user_turn"
                ? "sira kullanicida"
                : "turntaking: " + update.turntaking
          );
        }
      });

      client.on("metadata", (metadata) => {
        if (!metadata) {
          return;
        }

        pushEvent("metadata guncellendi");
      });

      document.getElementById("start").addEventListener("click", async () => {
        resetPanels();
        stopToolPolling();
        currentCallId = null;
        statusEl.textContent = "Token aliniyor...";
        try {
          const response = await fetch("/api/token", { method: "POST" });
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "Token alinamadi.");
          }

          statusEl.textContent = "Call baslatiliyor...";
          currentCallId = payload.callId;
          pushEvent("call_id: " + payload.callId);
          startToolPolling();
          void refreshToolEvents();
          await client.startCall({ accessToken: payload.accessToken });
        } catch (error) {
          statusEl.textContent = "Call baslatilamadi.";
          pushEvent(String(error));
          stopToolPolling();
        }
      });

      document.getElementById("stop").addEventListener("click", () => {
        client.stopCall();
        statusEl.textContent = "Stop istendi.";
        pushEvent("stop_istendi");
        void refreshToolEvents();
      });
    </script>
  </body>
</html>`;

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400).end("Missing url");
    return;
  }

  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  if (request.method === "POST" && request.url === "/api/token") {
    try {
      const webCall = await retell.call.createWebCall({
        agent_id: agentId,
        ...(agentVersion !== undefined ? { agent_version: agentVersion } : {}),
        metadata: { office_id: officeId },
        retell_llm_dynamic_variables: { office_id: officeId },
        data_storage_setting: "everything"
      });

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          callId: webCall.call_id,
          accessToken: webCall.access_token
        })
      );
      return;
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : "Retell token request failed"
        })
      );
      return;
    }
  }

  if (request.method === "GET" && request.url.startsWith("/api/tool-events")) {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      const callId = url.searchParams.get("callId")?.trim();

      if (!callId) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Missing callId" }));
        return;
      }

      const events = await getToolEvents(callId);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ events }));
      return;
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : "Tool eventleri alinamadi"
        })
      );
      return;
    }
  }

  response.writeHead(404).end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log("Retell web call smoke server ready.");
  console.log(`Open: http://127.0.0.1:${port}`);
  console.log(`Agent ID: ${agentId}`);
  console.log(`Agent Version: ${agentVersion ?? "latest draft"}`);
  console.log(`Office ID: ${officeId}`);
});
