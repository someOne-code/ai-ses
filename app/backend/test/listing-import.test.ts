import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as XLSX from "xlsx";

import { db } from "../src/db/client.js";
import {
  listingSearchDocuments,
  listings,
  offices,
  tenants
} from "../src/db/schema/index.js";
import { createListingsImportService } from "../src/modules/listings/import.js";

XLSX.set_fs(fs);

const importService = createListingsImportService(db);
const sampleCsvPath = path.resolve(
  "C:\\Users\\umut\\Desktop\\ai-ses\\app\\backend\\test\\fixtures\\listings-import-sample.csv"
);

async function createOfficeFixture() {
  const tenantId = randomUUID();
  const officeId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Listing Import Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Listing Import Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });

  return { tenantId, officeId };
}

async function cleanupOfficeFixture(input: { tenantId: string; officeId: string }) {
  await db
    .delete(listingSearchDocuments)
    .where(eq(listingSearchDocuments.officeId, input.officeId));
  await db.delete(listings).where(eq(listings.officeId, input.officeId));
  await db.delete(offices).where(eq(offices.id, input.officeId));
  await db.delete(tenants).where(eq(tenants.id, input.tenantId));
}

async function createTempFile(
  filename: string,
  contents: string | Uint8Array
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-ses-listing-import-"));
  const filePath = path.join(tempDir, filename);

  if (typeof contents === "string") {
    await writeFile(filePath, contents, "utf8");
  } else {
    await writeFile(filePath, contents);
  }

  return {
    filePath,
    async cleanup() {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function createTempWorkbook(rows: string[][]) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-ses-listing-import-xlsx-"));
  const filePath = path.join(tempDir, "import.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  XLSX.utils.book_append_sheet(workbook, worksheet, "Listings");
  XLSX.writeFile(workbook, filePath);

  return {
    filePath,
    async cleanup() {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function getOfficeListings(officeId: string) {
  return db
    .select({
      referenceCode: listings.referenceCode,
      title: listings.title,
      status: listings.status,
      currency: listings.currency
    })
    .from(listings)
    .where(eq(listings.officeId, officeId))
    .orderBy(asc(listings.referenceCode));
}

async function getOfficeSearchDocuments(officeId: string) {
  return db
    .select({
      listingId: listingSearchDocuments.listingId,
      documentType: listingSearchDocuments.documentType,
      content: listingSearchDocuments.content,
      hasEmbedding: sql<boolean>`${listingSearchDocuments.embedding} is not null`
    })
    .from(listingSearchDocuments)
    .where(eq(listingSearchDocuments.officeId, officeId))
    .orderBy(asc(listingSearchDocuments.listingId));
}

test("listing import supports CSV happy path and syncs main search documents", async () => {
  const fixture = await createOfficeFixture();

  try {
    const summary = await importService.importFile({
      officeId: fixture.officeId,
      filePath: sampleCsvPath,
      sourceFormat: "csv"
    });

    assert.equal(summary.rowsRead, 2);
    assert.equal(summary.rowsAccepted, 2);
    assert.equal(summary.rowsRejected, 0);
    assert.equal(summary.listingsInserted, 2);
    assert.equal(summary.listingsUpdated, 0);
    assert.equal(summary.searchDocumentsSynced, 2);
    assert.deepEqual(summary.errors, []);

    const importedListings = await getOfficeListings(fixture.officeId);
    const searchDocuments = await getOfficeSearchDocuments(fixture.officeId);

    assert.deepEqual(
      importedListings.map((listing) => listing.referenceCode),
      ["IMP-1001", "IMP-1002"]
    );
    assert.equal(searchDocuments.length, 2);
    assert.ok(
      searchDocuments.every(
        (document) =>
          document.documentType === "main" && document.hasEmbedding === false
      )
    );
    assert.ok(
      searchDocuments.some((document) =>
        document.content.includes("Kadikoy 2+1 Apartment")
      )
    );
  } finally {
    await cleanupOfficeFixture(fixture);
  }
});

test("listing import supports XLSX happy path", async () => {
  const fixture = await createOfficeFixture();
  const workbook = await createTempWorkbook([
    [
      "referenceCode",
      "title",
      "listingType",
      "propertyType",
      "price",
      "currency",
      "district",
      "neighborhood"
    ],
    [
      "XLSX-2001",
      "Bebek Sea View Apartment",
      "sale",
      "apartment",
      "12500000",
      "TRY",
      "Besiktas",
      "Bebek"
    ]
  ]);

  try {
    const summary = await importService.importFile({
      officeId: fixture.officeId,
      filePath: workbook.filePath,
      sourceFormat: "xlsx"
    });

    assert.equal(summary.rowsRead, 1);
    assert.equal(summary.rowsAccepted, 1);
    assert.equal(summary.rowsRejected, 0);
    assert.equal(summary.listingsInserted, 1);
    assert.equal(summary.searchDocumentsSynced, 1);

    const importedListings = await getOfficeListings(fixture.officeId);

    assert.equal(importedListings[0]?.referenceCode, "XLSX-2001");
    assert.equal(importedListings[0]?.title, "Bebek Sea View Apartment");
  } finally {
    await workbook.cleanup();
    await cleanupOfficeFixture(fixture);
  }
});

test("listing import rejects invalid rows clearly and still imports valid rows", async () => {
  const fixture = await createOfficeFixture();
  const tempFile = await createTempFile(
    "invalid-listings.csv",
    [
      "referenceCode,title,price,currency",
      "INV-3001,Valid Listing,4500000,TRY",
      "INV-3002,Bad Price,abc,TRY",
      ",Missing Reference,100000,TRY"
    ].join("\n")
  );

  try {
    const summary = await importService.importFile({
      officeId: fixture.officeId,
      filePath: tempFile.filePath,
      sourceFormat: "csv"
    });

    assert.equal(summary.rowsRead, 3);
    assert.equal(summary.rowsAccepted, 1);
    assert.equal(summary.rowsRejected, 2);
    assert.equal(summary.listingsInserted, 1);
    assert.equal(summary.searchDocumentsSynced, 1);
    assert.equal(summary.errors.length, 2);
    assert.deepEqual(
      summary.errors.map((error) => ({
        rowNumber: error.rowNumber,
        referenceCode: error.referenceCode
      })),
      [
        {
          rowNumber: 3,
          referenceCode: "INV-3002"
        },
        {
          rowNumber: 4,
          referenceCode: null
        }
      ]
    );

    const importedListings = await getOfficeListings(fixture.officeId);

    assert.deepEqual(
      importedListings.map((listing) => listing.referenceCode),
      ["INV-3001"]
    );
  } finally {
    await tempFile.cleanup();
    await cleanupOfficeFixture(fixture);
  }
});

test("listing import is idempotent on re-import for the same office", async () => {
  const fixture = await createOfficeFixture();

  try {
    const firstSummary = await importService.importFile({
      officeId: fixture.officeId,
      filePath: sampleCsvPath,
      sourceFormat: "csv"
    });
    const secondSummary = await importService.importFile({
      officeId: fixture.officeId,
      filePath: sampleCsvPath,
      sourceFormat: "csv"
    });

    assert.equal(firstSummary.listingsInserted, 2);
    assert.equal(firstSummary.listingsUpdated, 0);
    assert.equal(secondSummary.listingsInserted, 0);
    assert.equal(secondSummary.listingsUpdated, 0);
    assert.equal(secondSummary.searchDocumentsSynced, 2);

    const importedListings = await getOfficeListings(fixture.officeId);
    const searchDocuments = await getOfficeSearchDocuments(fixture.officeId);

    assert.equal(importedListings.length, 2);
    assert.equal(searchDocuments.length, 2);
  } finally {
    await cleanupOfficeFixture(fixture);
  }
});

test("listing import recreates missing main search documents through the app-owned sync path", async () => {
  const fixture = await createOfficeFixture();

  try {
    await importService.importFile({
      officeId: fixture.officeId,
      filePath: sampleCsvPath,
      sourceFormat: "csv"
    });

    const existingListings = await db
      .select({
        id: listings.id
      })
      .from(listings)
      .where(eq(listings.officeId, fixture.officeId));

    await db
      .delete(listingSearchDocuments)
      .where(
        and(
          eq(listingSearchDocuments.officeId, fixture.officeId),
          inArray(
            listingSearchDocuments.listingId,
            existingListings.map((listing) => listing.id)
          )
        )
      );

    const summary = await importService.importFile({
      officeId: fixture.officeId,
      filePath: sampleCsvPath,
      sourceFormat: "csv"
    });

    assert.equal(summary.listingsInserted, 0);
    assert.equal(summary.listingsUpdated, 0);
    assert.equal(summary.searchDocumentsSynced, 2);

    const recreatedDocuments = await getOfficeSearchDocuments(fixture.officeId);

    assert.equal(recreatedDocuments.length, 2);
    assert.ok(
      recreatedDocuments.every((document) => document.documentType === "main")
    );
  } finally {
    await cleanupOfficeFixture(fixture);
  }
});

test("listing import stays office-scoped even when reference codes overlap across offices", async () => {
  const fixtureA = await createOfficeFixture();
  const fixtureB = await createOfficeFixture();

  try {
    await db.insert(listings).values({
      id: randomUUID(),
      officeId: fixtureB.officeId,
      referenceCode: "IMP-1001",
      title: "Existing Other Office Listing",
      status: "active",
      currency: "TRY"
    });

    await importService.importFile({
      officeId: fixtureA.officeId,
      filePath: sampleCsvPath,
      sourceFormat: "csv"
    });

    const officeAListings = await getOfficeListings(fixtureA.officeId);
    const officeBListings = await getOfficeListings(fixtureB.officeId);
    const officeADocuments = await getOfficeSearchDocuments(fixtureA.officeId);
    const officeBDocuments = await getOfficeSearchDocuments(fixtureB.officeId);

    assert.equal(officeAListings.length, 2);
    assert.equal(officeBListings.length, 1);
    assert.equal(officeBListings[0]?.title, "Existing Other Office Listing");
    assert.equal(officeADocuments.length, 2);
    assert.equal(officeBDocuments.length, 0);
  } finally {
    await cleanupOfficeFixture(fixtureA);
    await cleanupOfficeFixture(fixtureB);
  }
});
