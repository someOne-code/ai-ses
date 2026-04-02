import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { inArray } from "drizzle-orm";

import { db } from "../src/db/client.js";
import {
  LISTING_SEARCH_EMBEDDING_DIMENSION,
  listingSearchDocuments,
  listings,
  offices,
  tenants
} from "../src/db/schema/index.js";
import { createListingsRepository } from "../src/modules/listings/repository.js";

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

test("hybrid retrieval pre-filters candidates by positive anchor alias evidence", async () => {
  const repository = createListingsRepository(db);
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const metroListingId = randomUUID();
  const nonAnchorListingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Anchor Positive Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Anchor Positive Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: metroListingId,
      officeId,
      referenceCode: `REF-${metroListingId.slice(0, 8)}`,
      title: "Metro Listing",
      description: "Anchor positive retrieval fixture.",
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
      id: nonAnchorListingId,
      officeId,
      referenceCode: `REF-${nonAnchorListingId.slice(0, 8)}`,
      title: "Transit Generic Listing",
      description: "Anchor negative lexical fixture.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "64000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "94.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);
  await db.insert(listingSearchDocuments).values([
    {
      officeId,
      listingId: metroListingId,
      documentType: "main",
      content: "Metroya yakin kiralik daire.",
      embedding: createEmbedding([0, 0.8], [1, 0.6]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    },
    {
      officeId,
      listingId: nonAnchorListingId,
      documentType: "main",
      content: "Ulasimi kolay kiralik daire.",
      embedding: createEmbedding([0, 1]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    }
  ]);

  try {
    const result = await repository.search(
      {
        officeId,
        queryText: "ulasimi kolay",
        searchMode: "hybrid",
        limit: 5
      },
      {
        queryEmbedding: createEmbedding([0, 1]),
        retrievalControls: {
          mustAnchorTerms: [{ canonical: "metro", raw: "metroya" }],
          negatedTerms: [],
          viewedListingIds: []
        }
      }
    );

    assert.equal(result.matchInterpretation, "hybrid_candidate");
    assert.deepEqual(
      result.listings.map((listing) => listing.id),
      [metroListingId]
    );
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [metroListingId, nonAnchorListingId]
    });
  }
});

test("hybrid retrieval excludes negated anchor alias matches at SQL level", async () => {
  const repository = createListingsRepository(db);
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const metroListingId = randomUUID();
  const nonMetroListingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Anchor Negative Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Anchor Negative Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: metroListingId,
      officeId,
      referenceCode: `REF-${metroListingId.slice(0, 8)}`,
      title: "Metrobus Listing",
      description: "Negated anchor should be excluded.",
      propertyType: "apartment",
      listingType: "sale",
      status: "active",
      price: "9300000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "140.00",
      district: "Uskudar",
      neighborhood: "Acibadem"
    },
    {
      id: nonMetroListingId,
      officeId,
      referenceCode: `REF-${nonMetroListingId.slice(0, 8)}`,
      title: "Quiet Listing",
      description: "No rail anchor mention.",
      propertyType: "apartment",
      listingType: "sale",
      status: "active",
      price: "9100000.00",
      currency: "TRY",
      bedrooms: "3",
      bathrooms: "2",
      netM2: "138.00",
      district: "Uskudar",
      neighborhood: "Acibadem"
    }
  ]);
  await db.insert(listingSearchDocuments).values([
    {
      officeId,
      listingId: metroListingId,
      documentType: "main",
      content: "Metrobus duragina yurume mesafesi.",
      embedding: createEmbedding([0, 1]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    },
    {
      officeId,
      listingId: nonMetroListingId,
      documentType: "main",
      content: "Sessiz cevrede genis daire.",
      embedding: createEmbedding([0, 1]),
      embeddingModel: "gemini-embedding-001",
      metadata: { section: "main" }
    }
  ]);

  try {
    const result = await repository.search(
      {
        officeId,
        queryText: "ulasimi kolay daire",
        searchMode: "hybrid",
        limit: 5
      },
      {
        queryEmbedding: createEmbedding([0, 1]),
        retrievalControls: {
          mustAnchorTerms: [],
          negatedTerms: [{ canonical: "metro", raw: "metro istemiyorum" }],
          viewedListingIds: []
        }
      }
    );

    assert.equal(result.matchInterpretation, "hybrid_candidate");
    assert.deepEqual(
      result.listings.map((listing) => listing.id),
      [nonMetroListingId]
    );
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [metroListingId, nonMetroListingId]
    });
  }
});

test("retrieval excludes viewed listing ids for pagination safety", async () => {
  const repository = createListingsRepository(db);
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const firstListingId = randomUUID();
  const secondListingId = randomUUID();
  const thirdListingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Viewed Exclusion Tenant ${tenantId}`
  });
  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Viewed Exclusion Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });
  await db.insert(listings).values([
    {
      id: firstListingId,
      officeId,
      referenceCode: `REF-${firstListingId.slice(0, 8)}`,
      title: "Viewed Listing One",
      description: "Structured viewed exclusion fixture.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "52000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "90.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: secondListingId,
      officeId,
      referenceCode: `REF-${secondListingId.slice(0, 8)}`,
      title: "Viewed Listing Two",
      description: "Structured viewed exclusion fixture.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "53000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "91.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    },
    {
      id: thirdListingId,
      officeId,
      referenceCode: `REF-${thirdListingId.slice(0, 8)}`,
      title: "Unseen Listing",
      description: "Structured viewed exclusion fixture.",
      propertyType: "apartment",
      listingType: "rent",
      status: "active",
      price: "54000.00",
      currency: "TRY",
      bedrooms: "2",
      bathrooms: "1",
      netM2: "92.00",
      district: "Kadikoy",
      neighborhood: "Moda"
    }
  ]);

  try {
    const result = await repository.search(
      {
        officeId,
        district: "Kadikoy",
        listingType: "rent",
        searchMode: "structured",
        limit: 5
      },
      {
        retrievalControls: {
          mustAnchorTerms: [],
          negatedTerms: [],
          viewedListingIds: [firstListingId, secondListingId]
        }
      }
    );

    assert.equal(result.matchInterpretation, "verified_structured_match");
    assert.equal(
      result.listings.some((listing) => listing.id === firstListingId),
      false
    );
    assert.equal(
      result.listings.some((listing) => listing.id === secondListingId),
      false
    );
    assert.equal(
      result.listings.some((listing) => listing.id === thirdListingId),
      true
    );
  } finally {
    await cleanupFixture({
      tenantIds: [tenantId],
      officeIds: [officeId],
      listingIds: [firstListingId, secondListingId, thirdListingId]
    });
  }
});
