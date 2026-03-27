import "../src/config/env.js";

import path from "node:path";

import { db, pool } from "../src/db/client.js";
import {
  createListingsImportService,
  type ListingImportFormat
} from "../src/modules/listings/import.js";

type CliArgs = {
  officeId: string;
  filePath: string;
  sourceFormat: ListingImportFormat;
};

function readOption(args: string[], flag: string) {
  const index = args.indexOf(flag);

  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

function parseArgs(argv: string[]): CliArgs {
  const officeId = readOption(argv, "--officeId");
  const filePath = readOption(argv, "--file");
  const sourceFormat = readOption(argv, "--format") as ListingImportFormat | null;

  if (!officeId || !filePath || !sourceFormat) {
    throw new Error(
      "Usage: npm run import:listings -- --officeId <uuid> --format <csv|xlsx> --file <path>"
    );
  }

  if (sourceFormat !== "csv" && sourceFormat !== "xlsx") {
    throw new Error("format must be csv or xlsx.");
  }

  return {
    officeId,
    filePath: path.resolve(filePath),
    sourceFormat
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const service = createListingsImportService(db);
  const result = await service.importFile(args);

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error."
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
