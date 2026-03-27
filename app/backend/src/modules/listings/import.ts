import { access } from "node:fs/promises";
import * as fs from "node:fs";

import { and, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";

import type { Database } from "../../db/client.js";
import { listings, offices } from "../../db/schema/index.js";
import { AppError } from "../../lib/errors.js";
import {
  createListingSearchDocumentsRepository,
  createListingSearchDocumentsService
} from "./search-documents.js";

XLSX.set_fs(fs);

const SUPPORTED_LISTING_IMPORT_FORMATS = ["csv", "xlsx"] as const;

const HEADER_ALIASES: Record<string, keyof ListingImportCanonicalRow> = {
  referencecode: "referenceCode",
  reference: "referenceCode",
  refcode: "referenceCode",
  title: "title",
  description: "description",
  listingtype: "listingType",
  propertytype: "propertyType",
  price: "price",
  currency: "currency",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  netm2: "netM2",
  grossm2: "grossM2",
  district: "district",
  neighborhood: "neighborhood",
  addresstext: "addressText",
  address: "addressText",
  externallistingid: "externalListingId",
  status: "status",
  floornumber: "floorNumber",
  buildingage: "buildingAge",
  dues: "dues",
  hasbalcony: "hasBalcony",
  hasparking: "hasParking",
  haselevator: "hasElevator"
};

const REQUIRED_COLUMNS: Array<keyof Pick<
  ListingImportCanonicalRow,
  "referenceCode" | "title"
>> = ["referenceCode", "title"];

type ListingImportCanonicalRow = {
  referenceCode: string | null;
  title: string | null;
  description: string | null;
  listingType: string | null;
  propertyType: string | null;
  price: string | null;
  currency: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  netM2: string | null;
  grossM2: string | null;
  district: string | null;
  neighborhood: string | null;
  addressText: string | null;
  externalListingId: string | null;
  status: string | null;
  floorNumber: string | null;
  buildingAge: string | null;
  dues: string | null;
  hasBalcony: string | null;
  hasParking: string | null;
  hasElevator: string | null;
};

export type ListingImportFormat = (typeof SUPPORTED_LISTING_IMPORT_FORMATS)[number];

export interface ListingImportInput {
  officeId: string;
  filePath: string;
  sourceFormat: ListingImportFormat;
}

export interface ListingImportRowIssue {
  rowNumber: number;
  referenceCode: string | null;
  message: string;
}

export interface ListingImportSummary {
  officeId: string;
  filePath: string;
  sourceFormat: ListingImportFormat;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  listingsInserted: number;
  listingsUpdated: number;
  searchDocumentsSynced: number;
  errors: ListingImportRowIssue[];
  warnings: string[];
}

type ParsedImportRow = {
  rowNumber: number;
  values: ListingImportCanonicalRow;
};

type NormalizedImportedListing = {
  rowNumber: number;
  referenceCode: string;
  title: string;
  description: string | null;
  propertyType: string | null;
  listingType: string | null;
  status: string;
  price: string | null;
  currency: string;
  bedrooms: string | null;
  bathrooms: string | null;
  netM2: string | null;
  grossM2: string | null;
  floorNumber: string | null;
  buildingAge: string | null;
  dues: string | null;
  district: string | null;
  neighborhood: string | null;
  addressText: string | null;
  externalListingId: string | null;
  hasBalcony: boolean | null;
  hasParking: boolean | null;
  hasElevator: boolean | null;
};

type UpsertedListingRecord = {
  id: string;
  referenceCode: string;
};

type ExistingListingSnapshot = {
  id: string;
  referenceCode: string;
  title: string;
  description: string | null;
  propertyType: string | null;
  listingType: string | null;
  status: string;
  price: string | null;
  currency: string;
  bedrooms: string | null;
  bathrooms: string | null;
  netM2: string | null;
  grossM2: string | null;
  floorNumber: string | null;
  buildingAge: string | null;
  dues: string | null;
  district: string | null;
  neighborhood: string | null;
  addressText: string | null;
  externalListingId: string | null;
  hasBalcony: boolean | null;
  hasParking: boolean | null;
  hasElevator: boolean | null;
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function asTrimmedString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function normalizeText(value: unknown, options?: { lowercase?: boolean; uppercase?: boolean }) {
  const normalized = asTrimmedString(value);

  if (!normalized) {
    return null;
  }

  if (options?.uppercase) {
    return normalized.toUpperCase();
  }

  if (options?.lowercase) {
    return normalized.toLowerCase();
  }

  return normalized;
}

function normalizeDecimalInput(value: string): string {
  const compact = value.replace(/\s+/g, "");
  const lastCommaIndex = compact.lastIndexOf(",");
  const lastDotIndex = compact.lastIndexOf(".");

  if (lastCommaIndex !== -1 && lastDotIndex !== -1) {
    if (lastCommaIndex > lastDotIndex) {
      return compact.replace(/\./g, "").replace(",", ".");
    }

    return compact.replace(/,/g, "");
  }

  if (lastCommaIndex !== -1) {
    return compact.replace(",", ".");
  }

  return compact;
}

function parseNumericString(value: unknown, label: string): string | null {
  const normalized = asTrimmedString(value);

  if (normalized === null) {
    return null;
  }

  const numberValue = Number(normalizeDecimalInput(normalized));

  if (!Number.isFinite(numberValue)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return String(numberValue);
}

function parseBooleanValue(value: unknown, label: string): boolean | null {
  const normalized = normalizeText(value, { lowercase: true });

  if (normalized === null) {
    return null;
  }

  if (["true", "1", "yes", "y", "evet", "var"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "hayir", "hayır", "yok"].includes(normalized)) {
    return false;
  }

  throw new Error(`${label} must be a boolean-like value.`);
}

function isEmptyCanonicalRow(row: ListingImportCanonicalRow) {
  return Object.values(row).every((value) => value === null);
}

function createEmptyCanonicalRow(): ListingImportCanonicalRow {
  return {
    referenceCode: null,
    title: null,
    description: null,
    listingType: null,
    propertyType: null,
    price: null,
    currency: null,
    bedrooms: null,
    bathrooms: null,
    netM2: null,
    grossM2: null,
    district: null,
    neighborhood: null,
    addressText: null,
    externalListingId: null,
    status: null,
    floorNumber: null,
    buildingAge: null,
    dues: null,
    hasBalcony: null,
    hasParking: null,
    hasElevator: null
  };
}

function parseWorksheetRows(
  rows: unknown[][]
): {
  rowsRead: number;
  parsedRows: ParsedImportRow[];
  warnings: string[];
} {
  if (rows.length === 0) {
    throw new AppError("Listing import file is empty.", 400, "LISTING_IMPORT_EMPTY");
  }

  const headerRow = rows[0] ?? [];
  const canonicalHeaders = headerRow.map((cell) => HEADER_ALIASES[normalizeHeader(cell)] ?? null);

  const warnings: string[] = [];
  const missingRequiredHeaders = REQUIRED_COLUMNS.filter(
    (column) => !canonicalHeaders.includes(column)
  );

  if (missingRequiredHeaders.length > 0) {
    warnings.push(
      `Missing expected column headers: ${missingRequiredHeaders.join(", ")}. Rows without those values will be rejected.`
    );
  }

  const parsedRows: ParsedImportRow[] = [];

  rows.slice(1).forEach((row, index) => {
    const values = createEmptyCanonicalRow();

    canonicalHeaders.forEach((header, columnIndex) => {
      if (!header) {
        return;
      }

      values[header] = asTrimmedString(row[columnIndex]);
    });

    if (!isEmptyCanonicalRow(values)) {
      parsedRows.push({
        rowNumber: index + 2,
        values
      });
    }
  });

  return {
    rowsRead: parsedRows.length,
    parsedRows,
    warnings
  };
}

async function readImportRows(input: ListingImportInput) {
  await access(input.filePath);

  const workbook = XLSX.readFile(input.filePath, {
    raw: false
  });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new AppError("Listing import workbook has no sheets.", 400, "LISTING_IMPORT_EMPTY");
  }

  const worksheet = workbook.Sheets[firstSheetName];

  if (!worksheet) {
    throw new AppError("Listing import workbook has no readable worksheet.", 400, "LISTING_IMPORT_EMPTY");
  }

  const warnings: string[] = [];

  if (input.sourceFormat === "xlsx" && workbook.SheetNames.length > 1) {
    warnings.push(
      `Workbook contains ${workbook.SheetNames.length} sheets; using the first sheet "${firstSheetName}".`
    );
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  const parsed = parseWorksheetRows(rows);

  return {
    ...parsed,
    warnings: [...warnings, ...parsed.warnings]
  };
}

function normalizeImportedListing(
  row: ParsedImportRow
): {
  listing?: NormalizedImportedListing;
  error?: ListingImportRowIssue;
} {
  const referenceCode = normalizeText(row.values.referenceCode);
  const title = normalizeText(row.values.title);

  if (!referenceCode) {
    return {
      error: {
        rowNumber: row.rowNumber,
        referenceCode: null,
        message: "referenceCode is required."
      }
    };
  }

  if (!title) {
    return {
      error: {
        rowNumber: row.rowNumber,
        referenceCode,
        message: "title is required."
      }
    };
  }

  try {
    return {
      listing: {
        rowNumber: row.rowNumber,
        referenceCode,
        title,
        description: normalizeText(row.values.description),
        propertyType: normalizeText(row.values.propertyType, { lowercase: true }),
        listingType: normalizeText(row.values.listingType, { lowercase: true }),
        status:
          normalizeText(row.values.status, { lowercase: true }) ?? "active",
        price: parseNumericString(row.values.price, "price"),
        currency: normalizeText(row.values.currency, { uppercase: true }) ?? "TRY",
        bedrooms: parseNumericString(row.values.bedrooms, "bedrooms"),
        bathrooms: parseNumericString(row.values.bathrooms, "bathrooms"),
        netM2: parseNumericString(row.values.netM2, "netM2"),
        grossM2: parseNumericString(row.values.grossM2, "grossM2"),
        floorNumber: parseNumericString(row.values.floorNumber, "floorNumber"),
        buildingAge: parseNumericString(row.values.buildingAge, "buildingAge"),
        dues: parseNumericString(row.values.dues, "dues"),
        district: normalizeText(row.values.district),
        neighborhood: normalizeText(row.values.neighborhood),
        addressText: normalizeText(row.values.addressText),
        externalListingId: normalizeText(row.values.externalListingId),
        hasBalcony: parseBooleanValue(row.values.hasBalcony, "hasBalcony"),
        hasParking: parseBooleanValue(row.values.hasParking, "hasParking"),
        hasElevator: parseBooleanValue(row.values.hasElevator, "hasElevator")
      }
    };
  } catch (error) {
    return {
      error: {
        rowNumber: row.rowNumber,
        referenceCode,
        message: error instanceof Error ? error.message : "Invalid row."
      }
    };
  }
}

function comparableListingShape(
  listing: NormalizedImportedListing | ExistingListingSnapshot
) {
  const normalizeComparableNumeric = (value: string | null) =>
    value === null ? null : String(Number(value));

  return {
    referenceCode: listing.referenceCode,
    title: listing.title,
    description: listing.description,
    propertyType: listing.propertyType,
    listingType: listing.listingType,
    status: listing.status,
    price: normalizeComparableNumeric(listing.price),
    currency: listing.currency,
    bedrooms: normalizeComparableNumeric(listing.bedrooms),
    bathrooms: normalizeComparableNumeric(listing.bathrooms),
    netM2: normalizeComparableNumeric(listing.netM2),
    grossM2: normalizeComparableNumeric(listing.grossM2),
    floorNumber: normalizeComparableNumeric(listing.floorNumber),
    buildingAge: normalizeComparableNumeric(listing.buildingAge),
    dues: normalizeComparableNumeric(listing.dues),
    district: listing.district,
    neighborhood: listing.neighborhood,
    addressText: listing.addressText,
    externalListingId: listing.externalListingId,
    hasBalcony: listing.hasBalcony,
    hasParking: listing.hasParking,
    hasElevator: listing.hasElevator
  };
}

export function createListingsImportRepository(db: Database) {
  return {
    async officeExists(officeId: string) {
      const [office] = await db
        .select({
          id: offices.id
        })
        .from(offices)
        .where(eq(offices.id, officeId))
        .limit(1);

      return office !== undefined;
    },

    async findExistingListingReferenceCodes(
      officeId: string,
      referenceCodes: string[]
    ) {
      if (referenceCodes.length === 0) {
        return new Set<string>();
      }

      const existingRows = await db
        .select({
          referenceCode: listings.referenceCode
        })
        .from(listings)
        .where(
          and(
            eq(listings.officeId, officeId),
            inArray(listings.referenceCode, referenceCodes)
          )
        );

      return new Set(existingRows.map((row) => row.referenceCode));
    },

    async findExistingListingsByReferenceCodes(
      officeId: string,
      referenceCodes: string[]
    ) {
      if (referenceCodes.length === 0) {
        return new Map<string, ExistingListingSnapshot>();
      }

      const existingRows = await db
        .select({
          id: listings.id,
          referenceCode: listings.referenceCode,
          title: listings.title,
          description: listings.description,
          propertyType: listings.propertyType,
          listingType: listings.listingType,
          status: listings.status,
          price: listings.price,
          currency: listings.currency,
          bedrooms: listings.bedrooms,
          bathrooms: listings.bathrooms,
          netM2: listings.netM2,
          grossM2: listings.grossM2,
          floorNumber: listings.floorNumber,
          buildingAge: listings.buildingAge,
          dues: listings.dues,
          district: listings.district,
          neighborhood: listings.neighborhood,
          addressText: listings.addressText,
          externalListingId: listings.externalListingId,
          hasBalcony: listings.hasBalcony,
          hasParking: listings.hasParking,
          hasElevator: listings.hasElevator
        })
        .from(listings)
        .where(
          and(
            eq(listings.officeId, officeId),
            inArray(listings.referenceCode, referenceCodes)
          )
        );

      return new Map(
        existingRows.map((row) => [row.referenceCode, row satisfies ExistingListingSnapshot])
      );
    },

    async upsertListing(
      officeId: string,
      listing: NormalizedImportedListing
    ): Promise<UpsertedListingRecord> {
      const [record] = await db
        .insert(listings)
        .values({
          officeId,
          externalListingId: listing.externalListingId,
          referenceCode: listing.referenceCode,
          title: listing.title,
          description: listing.description,
          propertyType: listing.propertyType,
          listingType: listing.listingType,
          status: listing.status,
          price: listing.price,
          currency: listing.currency,
          bedrooms: listing.bedrooms,
          bathrooms: listing.bathrooms,
          netM2: listing.netM2,
          grossM2: listing.grossM2,
          floorNumber: listing.floorNumber,
          buildingAge: listing.buildingAge,
          dues: listing.dues,
          district: listing.district,
          neighborhood: listing.neighborhood,
          addressText: listing.addressText,
          hasBalcony: listing.hasBalcony,
          hasParking: listing.hasParking,
          hasElevator: listing.hasElevator
        })
        .onConflictDoUpdate({
          target: [listings.officeId, listings.referenceCode],
          set: {
            externalListingId: listing.externalListingId,
            title: listing.title,
            description: listing.description,
            propertyType: listing.propertyType,
            listingType: listing.listingType,
            status: listing.status,
            price: listing.price,
            currency: listing.currency,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            netM2: listing.netM2,
            grossM2: listing.grossM2,
            floorNumber: listing.floorNumber,
            buildingAge: listing.buildingAge,
            dues: listing.dues,
            district: listing.district,
            neighborhood: listing.neighborhood,
            addressText: listing.addressText,
            hasBalcony: listing.hasBalcony,
            hasParking: listing.hasParking,
            hasElevator: listing.hasElevator,
            updatedAt: new Date()
          }
        })
        .returning({
          id: listings.id,
          referenceCode: listings.referenceCode
        });

      if (!record) {
        throw new AppError("Failed to upsert listing import row.", 500, "LISTING_IMPORT_FAILED");
      }

      return record;
    }
  };
}

export type ListingsImportRepository = ReturnType<typeof createListingsImportRepository>;

export function createListingsImportService(db: Database) {
  return {
    async importFile(input: ListingImportInput): Promise<ListingImportSummary> {
      if (!SUPPORTED_LISTING_IMPORT_FORMATS.includes(input.sourceFormat)) {
        throw new AppError(
          "Unsupported listing import format.",
          400,
          "LISTING_IMPORT_FORMAT_UNSUPPORTED"
        );
      }

      const { rowsRead, parsedRows, warnings } = await readImportRows(input);
      const normalizedRows = parsedRows.map(normalizeImportedListing);
      const duplicateErrors: ListingImportRowIssue[] = [];
      const seenReferenceCodes = new Set<string>();
      const acceptedRows = normalizedRows
        .flatMap((row) => (row.listing ? [row.listing] : []))
        .sort((left, right) => left.rowNumber - right.rowNumber)
        .filter((row) => {
          if (seenReferenceCodes.has(row.referenceCode)) {
            duplicateErrors.push({
              rowNumber: row.rowNumber,
              referenceCode: row.referenceCode,
              message: "Duplicate referenceCode in import file."
            });
            return false;
          }

          seenReferenceCodes.add(row.referenceCode);
          return true;
        });
      const errors = [
        ...normalizedRows
        .flatMap((row) => (row.error ? [row.error] : []))
        .sort((left, right) => left.rowNumber - right.rowNumber),
        ...duplicateErrors
      ].sort((left, right) => left.rowNumber - right.rowNumber);

      const summary: ListingImportSummary = {
        officeId: input.officeId,
        filePath: input.filePath,
        sourceFormat: input.sourceFormat,
        rowsRead,
        rowsAccepted: acceptedRows.length,
        rowsRejected: errors.length,
        listingsInserted: 0,
        listingsUpdated: 0,
        searchDocumentsSynced: 0,
        errors,
        warnings
      };

      const repository = createListingsImportRepository(db);

      if (!(await repository.officeExists(input.officeId))) {
        throw new AppError("Office not found.", 404, "OFFICE_NOT_FOUND");
      }

      if (acceptedRows.length === 0) {
        return summary;
      }

      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        const repository = createListingsImportRepository(txDb);

        const existingReferenceCodes = await repository.findExistingListingReferenceCodes(
          input.officeId,
          acceptedRows.map((row) => row.referenceCode)
        );
        const existingListingsByReference =
          await repository.findExistingListingsByReferenceCodes(
            input.officeId,
            acceptedRows.map((row) => row.referenceCode)
          );
        const searchDocumentsService = createListingSearchDocumentsService(
          createListingSearchDocumentsRepository(txDb)
        );

        for (const row of acceptedRows) {
          const existingListing =
            existingListingsByReference.get(row.referenceCode) ?? null;
          const isChanged =
            existingListing === null ||
            JSON.stringify(comparableListingShape(existingListing)) !==
              JSON.stringify(comparableListingShape(row));
          const record = isChanged
            ? await repository.upsertListing(input.officeId, row)
            : {
                id: existingListing.id,
                referenceCode: existingListing.referenceCode
              };

          if (existingReferenceCodes.has(record.referenceCode) && isChanged) {
            summary.listingsUpdated += 1;
          } else if (!existingReferenceCodes.has(record.referenceCode)) {
            summary.listingsInserted += 1;
          }

          await searchDocumentsService.syncMainDocumentForListing(record.id);
          summary.searchDocumentsSynced += 1;
        }
      });

      return summary;
    }
  };
}
