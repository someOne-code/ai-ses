import assert from "node:assert/strict";
import test from "node:test";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "../src/db/client.js";
import {
  listingSearchDocuments,
  listings,
  offices
} from "../src/db/schema/index.js";
import { createListingsRepository } from "../src/modules/listings/repository.js";
import { createListingsService } from "../src/modules/listings/service.js";
import {
  cleanupLocalDemoData,
  cleanupLocalDemoDataWithoutLock,
  LOCAL_DEMO_IDS,
  seedLocalDemoData,
  seedLocalDemoDataWithoutLock,
  withLocalDemoDataLock
} from "../scripts/seed-local-demo.js";

const listingsService = createListingsService(createListingsRepository(db));

async function getDemoState() {
  const [office] = await db
    .select({
      id: offices.id
    })
    .from(offices)
    .where(eq(offices.id, LOCAL_DEMO_IDS.officeId))
    .limit(1);

  const seededListings = await db
    .select({
      id: listings.id,
      referenceCode: listings.referenceCode
    })
    .from(listings)
    .where(eq(listings.officeId, LOCAL_DEMO_IDS.officeId))
    .orderBy(asc(listings.referenceCode));

  const searchDocuments = await db
    .select({
      listingId: listingSearchDocuments.listingId,
      documentType: listingSearchDocuments.documentType,
      hasEmbedding: sql<boolean>`${listingSearchDocuments.embedding} is not null`
    })
    .from(listingSearchDocuments)
    .where(eq(listingSearchDocuments.officeId, LOCAL_DEMO_IDS.officeId))
    .orderBy(
      asc(listingSearchDocuments.listingId),
      asc(listingSearchDocuments.documentType)
    );

  return {
    officeExists: office !== undefined,
    seededListings,
    searchDocuments
  };
}

test("local demo seed materializes app-owned main search documents and cleanup stays coherent", async () => {
  await withLocalDemoDataLock(async () => {
    const hadSeedDataBefore = (await getDemoState()).officeExists;

    try {
      await seedLocalDemoDataWithoutLock();

      const firstSeedState = await getDemoState();

      assert.equal(firstSeedState.officeExists, true);
      assert.deepEqual(
        firstSeedState.seededListings.map((listing) => listing.id),
        [...LOCAL_DEMO_IDS.listingIds]
      );
      assert.equal(firstSeedState.searchDocuments.length, 3);
      assert.deepEqual(
        firstSeedState.searchDocuments.map((document) => ({
          listingId: document.listingId,
          documentType: document.documentType,
          hasEmbedding: document.hasEmbedding
        })),
        LOCAL_DEMO_IDS.listingIds.map((listingId) => ({
          listingId,
          documentType: "main",
          hasEmbedding: false
        }))
      );

      await seedLocalDemoDataWithoutLock();

      const secondSeedState = await getDemoState();

      assert.equal(secondSeedState.searchDocuments.length, 3);
      assert.deepEqual(
        secondSeedState.searchDocuments,
        firstSeedState.searchDocuments
      );

      const results = await listingsService.searchListings({
        officeId: LOCAL_DEMO_IDS.officeId,
        queryText: "acibadem parking elevator metrobus",
        searchMode: "hybrid",
        limit: 5
      });

      assert.equal(results[0]?.referenceCode, "DEMO-IST-3402");
      assert.ok(
        results.some((listing) => listing.referenceCode === "DEMO-IST-3402"),
        "Seeded office should support hybrid lexical search over listing_search_documents"
      );

      await cleanupLocalDemoDataWithoutLock();

      const cleanedState = await getDemoState();

      assert.equal(cleanedState.officeExists, false);
      assert.equal(cleanedState.seededListings.length, 0);
      assert.equal(cleanedState.searchDocuments.length, 0);
    } finally {
      if (hadSeedDataBefore) {
        await seedLocalDemoDataWithoutLock();
      } else {
        await cleanupLocalDemoDataWithoutLock();
      }
    }
  });
});
