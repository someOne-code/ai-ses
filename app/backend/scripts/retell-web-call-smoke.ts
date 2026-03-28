import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import Retell from "retell-sdk";

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
      #events {
        min-height: 120px;
        white-space: pre-wrap;
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
      <div id="events">Olaylar burada akacak.</div>
    </main>

    <script type="module">
      import { RetellWebClient } from "https://esm.sh/retell-client-js-sdk";

      const client = new RetellWebClient();
      const statusEl = document.getElementById("status");
      const eventsEl = document.getElementById("events");

      function pushEvent(message) {
        const timestamp = new Date().toLocaleTimeString("tr-TR");
        eventsEl.textContent += "\\n[" + timestamp + "] " + message;
      }

      client.on("call_started", () => {
        statusEl.textContent = "Call basladi.";
        pushEvent("call_started");
      });

      client.on("call_ended", () => {
        statusEl.textContent = "Call bitti.";
        pushEvent("call_ended");
      });

      client.on("error", (error) => {
        statusEl.textContent = "Hata olustu.";
        pushEvent("error: " + JSON.stringify(error));
      });

      client.on("update", (update) => {
        pushEvent("update: " + JSON.stringify(update));
      });

      document.getElementById("start").addEventListener("click", async () => {
        statusEl.textContent = "Token aliniyor...";
        try {
          const response = await fetch("/api/token", { method: "POST" });
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "Token alinamadi.");
          }

          statusEl.textContent = "Call baslatiliyor...";
          pushEvent("call_id: " + payload.callId);
          await client.startCall({ accessToken: payload.accessToken });
        } catch (error) {
          statusEl.textContent = "Call baslatilamadi.";
          pushEvent(String(error));
        }
      });

      document.getElementById("stop").addEventListener("click", () => {
        client.stopCall();
        statusEl.textContent = "Stop istendi.";
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

  response.writeHead(404).end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log("Retell web call smoke server ready.");
  console.log(`Open: http://127.0.0.1:${port}`);
  console.log(`Agent ID: ${agentId}`);
  console.log(`Agent Version: ${agentVersion ?? "latest draft"}`);
  console.log(`Office ID: ${officeId}`);
});
