import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { inArray } from "drizzle-orm";

import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import {
  LISTING_SEARCH_EMBEDDING_DIMENSION,
  listingSearchDocuments,
  listings,
  offices,
  tenants
} from "../src/db/schema/index.js";
import { AppError } from "../src/lib/errors.js";
import { createListingsRepository } from "../src/modules/listings/repository.js";
import { createListingsService } from "../src/modules/listings/service.js";

function createEmbedding(...pairs: Array<[number, number]>) {
  const embedding = Array.from(
    { length: LISTING_SEARCH_EMBEDDING_DIMENSION },
    () => 0
  );

  for (const [index, value] of pairs) {
    embedding[index] = value;
  }

  return embedding;
}

const listingsService = createListingsService(createListingsRepository(db));

async function cleanupFixture(input: {
  tenantIds: string[];
  officeIds: string[];
  listingIds: string[];
}) {
  await db
    .delete(listingSearchDocuments)
    .where(inArray(listingSearchDocuments.listingId, input.listingIds));
  await db.delete(listings).where(inArray(listings.id, input.listingIds));
  await db.delete(offices).where(inArray(offices.id, input.officeIds));
  await db.delete(tenants).where(inArray(tenants.id, input.tenantIds));
}

test("searchListingsDetailed preserves shortlist speech fields without widening to full detail", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Shortlist Speech Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Shortlist Speech Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: "DEMO-IST-3401",
    title: "Kadikoy Moda 2+1 Search Fixture",
    description: "Shortlist speech preservation fixture.",
    propertyType: "apartment",
    listingType: "rent",
    status: "active",
    price: "65000.00",
    currency: "TRY",
    bedrooms: "2",
    bathrooms: "1",
    netM2: "95.00",
    district: "Kadikoy",
    neighborhood: "Moda",
    buildingAge: "8",
    dues: "2500.00",
    hasBalcony: true,
    hasParking: false,
    hasElevator: true,
    floorNumber: "3",
    addressText: "Moda, Kadikoy, Istanbul"
  });

  try {
    const searchResult = await listingsService.searchListingsDetailed({
      officeId,
      district: "Kadikoy",
      listingType: "rent",
      searchMode: "structured",
      limit: 5
    });
    const listing = searchResult.listings[0];

    assert.equal(searchResult.matchInterpretation, "verified_structured_match");
    assert.equal(searchResult.listings.length, 1);
    assert.equal(listing?.referenceCode, "DEMO-IST-3401");
    assert.equal(listing?.dues, 2500);
    assert.equal(listing?.buildingAge, 8);
    assert.equal(listing?.hasBalcony, true);
    assert.equal(listing?.hasParking, false);
    assert.equal(listing?.hasElevator, true);
    assert.equal("floorNumber" in (listing ?? {}), false);
    assert.equal("addressText" in (listing ?? {}), false);
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [listingId]
    });
  }
});

test("listing reference lookup resolves deterministic spoken spacing and hyphen variants", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Reference Variant Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Reference Variant Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: "DEMO-IST-3401",
    title: "Reference Variant Listing",
    description: "Reference lookup normalization fixture.",
    propertyType: "apartment",
    listingType: "rent",
    status: "active",
    price: "65000.00",
    currency: "TRY",
    bedrooms: "2",
    bathrooms: "1",
    netM2: "95.00",
    district: "Kadikoy",
    neighborhood: "Moda"
  });

  try {
    const spaced = await listingsService.getListingByReference({
      officeId,
      referenceCode: "DEMO IST 3401"
    });
    const lowercase = await listingsService.getListingByReference({
      officeId,
      referenceCode: "demo-ist-3401"
    });
    const dotted = await listingsService.getListingByReference({
      officeId,
      referenceCode: "DEMO \u0130ST 3401"
    });

    assert.equal(spaced.referenceCode, "DEMO-IST-3401");
    assert.equal(lowercase.referenceCode, "DEMO-IST-3401");
    assert.equal(dotted.referenceCode, "DEMO-IST-3401");
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [listingId]
    });
  }
});

test("listing reference lookup preserves correctness boundaries for missing prefixes and ambiguous canonical forms", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const primaryListingId = randomUUID();
  const ambiguousListingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Reference Boundary Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Reference Boundary Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: primaryListingId,
      officeId,
      referenceCode: "DEMO-IST-3401",
      title: "Reference Boundary Primary Listing",
      description: "Primary reference lookup boundary fixture.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "65000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "95.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: ambiguousListingId,
      officeId,
      referenceCode: "DEMO IST 3401",
      title: "Reference Boundary Ambiguous Listing",
      description: "Normalized collision fixture.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "66000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "96.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);

  try {
    await assert.rejects(
      () =>
        listingsService.getListingByReference({
          officeId,
          referenceCode: "IST 3401"
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "LISTING_NOT_FOUND" &&
        error.statusCode === 404
    );

    await assert.rejects(
      () =>
        listingsService.getListingByReference({
          officeId,
          referenceCode: "demoist3401"
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "LISTING_REFERENCE_AMBIGUOUS" &&
        error.statusCode === 409
    );
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [primaryListingId, ambiguousListingId]
    });
  }
});

test("hybrid lexical search uses main documents, preserves office plus active isolation, and marks results as hybrid candidates", async () => {
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const officeAId = randomUUID();
  const officeBId = randomUUID();
  const matchingListingId = randomUUID();
  const amenitiesOnlyListingId = randomUUID();
  const inactiveListingId = randomUUID();
  const otherOfficeListingId = randomUUID();

  await db.insert(tenants).values([
    { id: tenantAId, name: `Hybrid Test Tenant A ${tenantAId}` },
    { id: tenantBId, name: `Hybrid Test Tenant B ${tenantBId}` }
  ]);
  await db.insert(offices).values([
    {
      id: officeAId,
      tenantId: tenantAId,
      name: `Hybrid Test Office A ${officeAId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    },
    {
      id: officeBId,
      tenantId: tenantBId,
      name: `Hybrid Test Office B ${officeBId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    }
  ]);
  await db.insert(listings).values([
    {
      id: matchingListingId,
      officeId: officeAId,
      referenceCode: `REF-${matchingListingId.slice(0, 8)}`,
      title: "Moda Family Rental",
      description: "Bakimli aile dairesi.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "55000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "140.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: amenitiesOnlyListingId,
      officeId: officeAId,
      referenceCode: `REF-${amenitiesOnlyListingId.slice(0, 8)}`,
      title: "Structured Match Without Main Lexical Match",
      description: "Ayni filtrelere uyan ikinci ilan.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "53000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "135.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: inactiveListingId,
      officeId: officeAId,
      referenceCode: `REF-${inactiveListingId.slice(0, 8)}`,
      title: "Inactive Hybrid Candidate",
      description: "Inactive kayit geri donmemeli.",
      propertyType: "apartment",
      listingType: "rent",
      status: "inactive",
      price: "52000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "1",
      netM2: "120.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: otherOfficeListingId,
      officeId: officeBId,
      referenceCode: `REF-${otherOfficeListingId.slice(0, 8)}`,
      title: "Other Office Hybrid Candidate",
      description: "Baska ofisten kayit geri donmemeli.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "51000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "130.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);
  await db.insert(listingSearchDocuments).values([
    {
      officeId: officeAId,
      listingId: matchingListingId,
      documentType: "main",
      content:
        "Kadikoy Moda kiralik daire. Metroya yakin. Aile icin uygun. Sessiz sokakta.",
      metadata: { section: "main" }
    },
    {
      officeId: officeAId,
      listingId: amenitiesOnlyListingId,
      documentType: "main",
      content: "Kadikoy Moda kiralik daire. Ferah salon. Genis mutfak.",
      metadata: { section: "main" }
    },
    {
      officeId: officeAId,
      listingId: amenitiesOnlyListingId,
      documentType: "amenities",
      content: "Metroya yakin. Aile icin uygun. Cocuklu aileye hitap eder.",
      metadata: { section: "amenities" }
    },
    {
      officeId: officeAId,
      listingId: inactiveListingId,
      documentType: "main",
      content: "Metroya yakin. Aile icin uygun. Inactive ilan.",
      metadata: { section: "main" }
    },
    {
      officeId: officeBId,
      listingId: otherOfficeListingId,
      documentType: "main",
      content: "Metroya yakin. Aile icin uygun. Baska ofis kaydi.",
      metadata: { section: "main" }
    }
  ]);

  try {
    const searchResult = await listingsService.searchListingsDetailed({
      officeId: officeAId,
      district: "Kadikoy",
      listingType: "rent",
      queryText: "metroya yakin aile icin uygun",
      searchMode: "hybrid",
      limit: 5
    });
    const results = searchResult.listings;

    assert.deepEqual(
      results.map((listing) => listing.id),
      [matchingListingId]
    );
    assert.equal(searchResult.matchInterpretation, "hybrid_candidate");
    assert.equal(results[0]?.referenceCode, `REF-${matchingListingId.slice(0, 8)}`);
    assert.equal(results[0]?.status, "active");
    assert.equal(results[0]?.price, 55000);
  } finally {
    await cleanupFixture({
      tenantIds: [tenantAId, tenantBId],
      officeIds: [officeAId, officeBId],
      listingIds: [
        matchingListingId,
        amenitiesOnlyListingId,
        inactiveListingId,
        otherOfficeListingId
      ]
    });
  }
});

test("structured fallback still works without queryText even when no search document exists", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Structured Fallback Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Structured Fallback Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: `REF-${listingId.slice(0, 8)}`,
    title: "Structured Only Listing",
    description: "Search document olmadan da structured aramada gelmeli.",
    propertyType: "apartment",
    listingType: "sale",
    status: "active",
    price: "7800000.00",
    currency: "TRY",
    bedrooms: "3",
    bathrooms: "2",
    netM2: "145.00",
    district: "Kadikoy",
    neighborhood: "Suadiye"
  });

  try {
    const searchResult = await listingsService.searchListingsDetailed({
      officeId,
      district: "Kadikoy",
      listingType: "sale",
      searchMode: "structured",
      limit: 5
    });
    const results = searchResult.listings;

    assert.deepEqual(
      results.map((listing) => listing.id),
      [listingId]
    );
    assert.equal(searchResult.matchInterpretation, "verified_structured_match");
    assert.equal(results[0]?.referenceCode, `REF-${listingId.slice(0, 8)}`);
    assert.equal(results[0]?.price, 7800000);
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [listingId]
    });
  }
});

test("structured search matches Turkish diacritics against ASCII stored district and neighborhood", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Accent Normalization Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Accent Normalization Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: `REF-${listingId.slice(0, 8)}`,
    title: "Accent Normalization Listing",
    description: "ASCII stored district and neighborhood should still match.",
    propertyType: "apartment",
    listingType: "rent",
    status: "active",
    price: "64000.00",
    currency: "TRY",
    bedrooms: "2",
    bathrooms: "1",
    netM2: "100.00",
    district: "Kadikoy",
    neighborhood: "Fenerbahce"
  });

  try {
    const results = await listingsService.searchListings({
      officeId,
      district: "Kadıköy",
      neighborhood: "Fenerbahçe",
      listingType: "rent",
      searchMode: "structured",
      limit: 5
    });

    assert.deepEqual(
      results.map((listing) => listing.id),
      [listingId]
    );
    assert.equal(results[0]?.referenceCode, `REF-${listingId.slice(0, 8)}`);
    assert.equal(results[0]?.district, "Kadikoy");
    assert.equal(results[0]?.neighborhood, "Fenerbahce");
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [listingId]
    });
  }
});

test("hybrid search stays empty and marks no_match when queryText misses even if hard filters still match", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const fallbackListingId = randomUUID();
  const inactiveListingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Hybrid Fallback Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Hybrid Fallback Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: fallbackListingId,
      officeId,
      referenceCode: `REF-${fallbackListingId.slice(0, 8)}`,
      title: "Structured Fallback Candidate",
      description: "Hard filtrelere uyan ilan.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "49000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "95.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: inactiveListingId,
      officeId,
      referenceCode: `REF-${inactiveListingId.slice(0, 8)}`,
      title: "Inactive Structured Fallback Candidate",
      description: "Inactive oldugu icin geri donmemeli.",
      propertyType: "apartment",
      listingType: "rent",
      status: "inactive",
      price: "47000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "90.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);
  await db.insert(listingSearchDocuments).values([
    {
      officeId,
      listingId: fallbackListingId,
      documentType: "main",
      content: "Kadikoy Moda kiralik daire. Ferah salon. Genis balkon.",
      metadata: { section: "main" }
    },
    {
      officeId,
      listingId: inactiveListingId,
      documentType: "main",
      content: "Kadikoy Moda kiralik daire. Ferah salon. Genis balkon.",
      metadata: { section: "main" }
    }
  ]);

  try {
    const searchResult = await listingsService.searchListingsDetailed({
      officeId,
      district: "Kadikoy",
      listingType: "rent",
      queryText: "metroya yakin aile icin uygun",
      searchMode: "hybrid",
      limit: 5
    });
    const results = searchResult.listings;

    assert.deepEqual(results, []);
    assert.equal(searchResult.matchInterpretation, "no_match");
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [fallbackListingId, inactiveListingId]
    });
  }
});

test("hybrid search stays empty when queryText misses and there are no hard filters", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Hybrid Query Only Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Hybrid Query Only Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: `REF-${listingId.slice(0, 8)}`,
    title: "Query Only Candidate",
    description: "Lexical olarak eslesmeyen ama aktif ilan.",
    propertyType: "apartment",
    listingType: "sale",
    status: "active",
    price: "8000000.00",
    currency: "TRY",
    bedrooms: "3",
    bathrooms: "2",
    netM2: "150.00",
    district: "Kadikoy",
    neighborhood: "Bostanci"
  });
  await db.insert(listingSearchDocuments).values({
    officeId,
    listingId,
    documentType: "main",
    content: "Kadikoy Bostanci satilik daire. Ferah salon. Deniz esintili balkon.",
    metadata: { section: "main" }
  });

  try {
    const results = await listingsService.searchListings({
      officeId,
      queryText: "metroya yakin aile icin uygun",
      searchMode: "hybrid",
      limit: 5
    });

    assert.deepEqual(results, []);
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [listingId]
    });
  }
});

test("hybrid search returns vector candidates when lexical search misses", async () => {
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const officeAId = randomUUID();
  const officeBId = randomUUID();
  const vectorMatchListingId = randomUUID();
  const otherOfficeListingId = randomUUID();
  const inactiveListingId = randomUUID();
  const distractorListingId = randomUUID();
  const vectorSearchService = createListingsService(
    createListingsRepository(db),
    {
      queryEmbeddingGenerator: {
        async generateQueryEmbedding(input) {
          assert.equal(input, "ulasim kolay aile evi");

          return {
            values: createEmbedding([0, 1], [1, 0]),
            model: "gemini-embedding-001"
          };
        }
      }
    }
  );

  await db.insert(tenants).values([
    { id: tenantAId, name: `Vector Tenant A ${tenantAId}` },
    { id: tenantBId, name: `Vector Tenant B ${tenantBId}` }
  ]);
  await db.insert(offices).values([
    {
      id: officeAId,
      tenantId: tenantAId,
      name: `Vector Office A ${officeAId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    },
    {
      id: officeBId,
      tenantId: tenantBId,
      name: `Vector Office B ${officeBId}`,
      timezone: "Europe/Istanbul",
      status: "active"
    }
  ]);
  await db.insert(listings).values([
    {
      id: vectorMatchListingId,
      officeId: officeAId,
      referenceCode: `REF-${vectorMatchListingId.slice(0, 8)}`,
      title: "Vector Match Listing",
      description: "Lexical olarak ayni degil ama semantic olarak yakin.",
      propertyType: "apartment",
      listingType: "sale",
      status: "active",
      price: "9200000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "145.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: distractorListingId,
      officeId: officeAId,
      referenceCode: `REF-${distractorListingId.slice(0, 8)}`,
      title: "Vector Distractor Listing",
      description: "Ayni ofiste ama semantic olarak uzak.",
      propertyType: "apartment",
      listingType: "sale",
      status: "active",
      price: "8700000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "138.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: inactiveListingId,
      officeId: officeAId,
      referenceCode: `REF-${inactiveListingId.slice(0, 8)}`,
      title: "Inactive Vector Candidate",
      description: "Semantic olarak yakin olsa da inactive.",
      propertyType: "apartment",
      listingType: "sale",
      status: "inactive",
      price: "9100000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "143.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: otherOfficeListingId,
      officeId: officeBId,
      referenceCode: `REF-${otherOfficeListingId.slice(0, 8)}`,
      title: "Other Office Vector Candidate",
      description: "Semantic olarak yakin olsa da baska ofiste.",
      propertyType: "apartment",
      listingType: "sale",
      status: "active",
      price: "9300000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "147.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);
  await db.insert(listingSearchDocuments).values([
    {
      officeId: officeAId,
      listingId: vectorMatchListingId,
      documentType: "main",
      content: "Ferah salon. Gunes alan daire. Sessiz cevre.",
      embedding: createEmbedding([0, 1], [1, 0]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    },
    {
      officeId: officeAId,
      listingId: distractorListingId,
      documentType: "main",
      content: "Ferah salon. Gunes alan daire. Sessiz cevre.",
      embedding: createEmbedding([0, -1], [1, 0]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    },
    {
      officeId: officeAId,
      listingId: inactiveListingId,
      documentType: "main",
      content: "Ferah salon. Gunes alan daire. Sessiz cevre.",
      embedding: createEmbedding([0, 1], [1, 0]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    },
    {
      officeId: officeBId,
      listingId: otherOfficeListingId,
      documentType: "main",
      content: "Ferah salon. Gunes alan daire. Sessiz cevre.",
      embedding: createEmbedding([0, 1], [1, 0]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    }
  ]);

  try {
    const results = await vectorSearchService.searchListings({
      officeId: officeAId,
      queryText: "ulasim kolay aile evi",
      searchMode: "hybrid",
      limit: 5
    });

    assert.deepEqual(
      results.map((listing) => listing.id),
      [vectorMatchListingId]
    );
    assert.equal(results[0]?.status, "active");
    assert.equal(results[0]?.referenceCode, `REF-${vectorMatchListingId.slice(0, 8)}`);
  } finally {
    await cleanupFixture({
      tenantIds: [tenantAId, tenantBId],
      officeIds: [officeAId, officeBId],
      listingIds: [
        vectorMatchListingId,
        distractorListingId,
        inactiveListingId,
        otherOfficeListingId
      ]
    });
  }
});

test("hybrid search combines lexical and vector candidates without duplication", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const lexicalListingId = randomUUID();
  const vectorOnlyListingId = randomUUID();
  const combinedSearchService = createListingsService(
    createListingsRepository(db),
    {
      queryEmbeddingGenerator: {
        async generateQueryEmbedding(input) {
          assert.equal(input, "metroya yakin aile icin uygun");

          return {
            values: createEmbedding([0, 1], [1, 0]),
            model: "gemini-embedding-001"
          };
        }
      }
    }
  );

  await db.insert(tenants).values({
    id: tenantId,
    name: `Hybrid Combined Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Hybrid Combined Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: lexicalListingId,
      officeId,
      referenceCode: `REF-${lexicalListingId.slice(0, 8)}`,
      title: "Lexical Match Listing",
      description: "Hem lexical hem vector ile bulunur.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "61000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "140.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: vectorOnlyListingId,
      officeId,
      referenceCode: `REF-${vectorOnlyListingId.slice(0, 8)}`,
      title: "Vector Only Listing",
      description: "Sadece vector ile gelir.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "59000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "136.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);
  await db.insert(listingSearchDocuments).values([
    {
      officeId,
      listingId: lexicalListingId,
      documentType: "main",
      content: "Metroya yakin. Aile icin uygun. Sessiz sokakta.",
      embedding: createEmbedding([0, 1], [1, 0]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    },
    {
      officeId,
      listingId: vectorOnlyListingId,
      documentType: "main",
      content: "Ferah salon. Gunes alan mutfak. Acik manzara.",
      embedding: createEmbedding([0, 1], [1, 0]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    }
  ]);

  try {
    const results = await combinedSearchService.searchListings({
      officeId,
      queryText: "metroya yakin aile icin uygun",
      searchMode: "hybrid",
      limit: 5
    });

    assert.deepEqual(
      results.map((listing) => listing.id),
      [lexicalListingId, vectorOnlyListingId]
    );
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [lexicalListingId, vectorOnlyListingId]
    });
  }
});

test("hybrid search reranks lexical and vector candidates with reciprocal rank fusion", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const lexicalAndVectorListingId = randomUUID();
  const lexicalOnlyListingId = randomUUID();
  const vectorOnlyListingId = randomUUID();
  const rerankedSearchService = createListingsService(
    createListingsRepository(db),
    {
      queryEmbeddingGenerator: {
        async generateQueryEmbedding(input) {
          assert.equal(input, "metroya yakin aile icin uygun");

          return {
            values: createEmbedding([0, 1]),
            model: "gemini-embedding-001"
          };
        }
      }
    }
  );

  await db.insert(tenants).values({
    id: tenantId,
    name: `Hybrid RRF Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Hybrid RRF Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: lexicalAndVectorListingId,
      officeId,
      referenceCode: `REF-${lexicalAndVectorListingId.slice(0, 8)}`,
      title: "Lexical And Vector Listing",
      description: "Hem lexical hem vector ile bulunur ve ilk sirada kalir.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "62000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "142.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: lexicalOnlyListingId,
      officeId,
      referenceCode: `REF-${lexicalOnlyListingId.slice(0, 8)}`,
      title: "Lexical Only Listing",
      description: "Sadece lexical aday olarak kalir.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "61000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "139.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: vectorOnlyListingId,
      officeId,
      referenceCode: `REF-${vectorOnlyListingId.slice(0, 8)}`,
      title: "Vector Only Listing",
      description: "Sadece vector ile gelip lexical-only adayi geride birakir.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "60000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "137.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);
  await db.insert(listingSearchDocuments).values([
    {
      officeId,
      listingId: lexicalAndVectorListingId,
      documentType: "main",
      content:
        "Metroya yakin aile icin uygun daire. Sessiz sokakta. Metroya yakin aile icin uygun.",
      embedding: createEmbedding([0, 0.8], [1, 0.6]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    },
    {
      officeId,
      listingId: lexicalOnlyListingId,
      documentType: "main",
      content: "Metroya yakin aile icin uygun daire.",
      embedding: null,
      embeddingModel: null,
      metadata: { section: "main" }
    },
    {
      officeId,
      listingId: vectorOnlyListingId,
      documentType: "main",
      content: "Ferah salon. Acik mutfak. Gunes alan cephe.",
      embedding: createEmbedding([0, 1]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    }
  ]);

  try {
    const results = await rerankedSearchService.searchListings({
      officeId,
      queryText: "metroya yakin aile icin uygun",
      searchMode: "hybrid",
      limit: 5
    });

    assert.deepEqual(
      results.map((listing) => listing.id),
      [lexicalAndVectorListingId, vectorOnlyListingId, lexicalOnlyListingId]
    );
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [
        lexicalAndVectorListingId,
        lexicalOnlyListingId,
        vectorOnlyListingId
      ]
    });
  }
});

test("GET listings search uses the backend-owned vector path when hybrid query embeddings are available", async () => {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const vectorListingId = randomUUID();
  const app = await createApp({
    listingQueryEmbeddingGenerator: {
      async generateQueryEmbedding(input) {
        assert.equal(input, "ulasim kolay aile evi");

        return {
          values: createEmbedding([0, 1], [1, 0]),
          model: "gemini-embedding-001"
        };
      }
    }
  });

  await db.insert(tenants).values({
    id: tenantId,
    name: `Vector Route Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Vector Route Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values({
    id: vectorListingId,
    officeId,
    referenceCode: `REF-${vectorListingId.slice(0, 8)}`,
    title: "Route Vector Listing",
    description: "Route uzerinden vector retrieval ile bulunur.",
    propertyType: "apartment",
    listingType: "sale",
    status: "active",
    price: "8800000.00",
    currency: "TRY",
    bedrooms: "3",
    bathrooms: "2",
    netM2: "142.00",
    district: "Kadikoy",
    neighborhood: "Moda"
  });
  await db.insert(listingSearchDocuments).values({
    officeId,
    listingId: vectorListingId,
    documentType: "main",
    content: "Ferah salon. Gunes alan daire. Sessiz cevre.",
    embedding: createEmbedding([0, 1], [1, 0]),
    embeddingModel: "gemini-embedding-001",
    metadata: { section: "main" }
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/v1/offices/${officeId}/listings/search?queryText=ulasim%20kolay%20aile%20evi&searchMode=hybrid`
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json().data.map((listing: { id: string }) => listing.id),
      [vectorListingId]
    );
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [vectorListingId]
    });
  }
});
