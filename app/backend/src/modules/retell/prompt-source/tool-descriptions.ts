import {
  retellToolContracts,
  type RetellToolContract
} from "../types.js";

export const retellPromptSourceToolNames = [
  "search_listings",
  "get_listing_by_reference",
  "create_showing_request"
] as const;

export type RetellPromptSourceToolName =
  (typeof retellPromptSourceToolNames)[number];

export const minimalRetellToolDescriptions = {
  search_listings:
    "Search active office listings with filters and optional free-text preference. Use only returned listings.",
  get_listing_by_reference:
    "Find one active office listing by full reference code. Keep every spoken token, including any prefix.",
  create_showing_request:
    "Create a showing request for a verified listing with confirmed customer details. listingId must come from a verified backend result."
} satisfies Record<RetellPromptSourceToolName, string>;

function getBaseToolContract(
  name: RetellPromptSourceToolName
): RetellToolContract {
  const contract = retellToolContracts.find((candidate) => candidate.name === name);

  if (!contract) {
    throw new Error(`Missing Retell tool contract for ${name}`);
  }

  return contract;
}

export function getMinimalRetellToolDescriptions() {
  return { ...minimalRetellToolDescriptions };
}

export function getMinimalRetellToolContract(
  name: RetellPromptSourceToolName
): RetellToolContract {
  const contract = getBaseToolContract(name);

  return {
    ...contract,
    description: minimalRetellToolDescriptions[name],
    parameters: structuredClone(contract.parameters)
  };
}
