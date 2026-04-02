#!/usr/bin/env node
/**
 * Fetch recent Retell calls and their transcripts for debugging.
 * 
 * Usage:
 *   cd app/backend
 *   npx tsx scripts/fetch-retell-calls.ts [--limit 10] [--search "IST 3401"]
 */

import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import Retell from "retell-sdk";

loadEnv({ path: new URL("../.env", import.meta.url) });

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    limit: { type: "string", default: "20" },
    search: { type: "string" }
  }
});

const apiKey = process.env.RETELL_API_KEY;

if (!apiKey) {
  throw new Error("Missing RETELL_API_KEY in app/backend/.env");
}

const limit = Number(values.limit ?? 20);
const searchTerm = values.search;

if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
  throw new Error(`Invalid limit: ${values.limit}. Must be between 1 and 100.`);
}

const retell = new Retell({ apiKey });

async function fetchRecentCalls() {
  console.log(`Fetching ${limit} most recent Retell calls...`);
  
  const calls = await retell.call.list({
    limit: limit
  });

  if (calls.length === 0) {
    console.log("\nNo calls found.");
    return;
  }

  console.log(`\nFound ${calls.length} calls:\n`);

  for (const call of calls) {
    console.log("=".repeat(80));
    console.log(`Call ID: ${call.call_id}`);
    console.log(`Status: ${call.call_status}`);
    console.log(`Start: ${call.start_timestamp ? new Date(call.start_timestamp).toISOString() : "N/A"}`);
    console.log(`End: ${call.end_timestamp ? new Date(call.end_timestamp).toISOString() : "N/A"}`);
    console.log(`Duration: ${call.duration_ms ? `${(call.duration_ms / 1000).toFixed(1)}s` : "N/A"}`);
    console.log(`Metadata: ${JSON.stringify(call.metadata, null, 2)}`);
    
    // Fetch detailed call with transcript
    try {
      const detail = await retell.call.retrieve(call.call_id);
      
      if (detail.transcript) {
        console.log("\n--- TRANSCRIPT ---");
        console.log(detail.transcript);
        console.log("--- END TRANSCRIPT ---\n");
      }

      // Check for tool calls
      if (detail.tool_calls && detail.tool_calls.length > 0) {
        console.log("\n--- TOOL CALLS ---");
        for (const toolCall of detail.tool_calls) {
          console.log(`Tool: ${toolCall.name}`);
          console.log(`Args: ${JSON.stringify(toolCall.arguments, null, 2)}`);
          console.log(`Result: ${JSON.stringify(toolCall.output, null, 2)}`);
          console.log("---");
        }
        console.log("--- END TOOL CALLS ---\n");
      }

      // Check for analysis
      if (detail.call_analysis) {
        console.log("\n--- CALL ANALYSIS ---");
        console.log(JSON.stringify(detail.call_analysis, null, 2));
        console.log("--- END CALL ANALYSIS ---\n");
      }

      // Search for term in transcript
      if (searchTerm && detail.transcript) {
        const lowerTranscript = detail.transcript.toLowerCase();
        const lowerSearch = searchTerm.toLowerCase();
        if (lowerTranscript.includes(lowerSearch)) {
          console.log(`\n*** SEARCH MATCH: "${searchTerm}" found in this call! ***\n`);
        }
      }
    } catch (err) {
      console.log(`\nCould not fetch details for ${call.call_id}: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log("");
  }
}

fetchRecentCalls().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
