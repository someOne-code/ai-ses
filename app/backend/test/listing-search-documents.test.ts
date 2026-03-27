import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { eq, sql } from "drizzle-orm";

import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import {
  listingSearchDocuments,
  listings,
  offices,
  tenants
} from "../src/db/schema/index.js";
import { AppError } from "../src/lib/errors.js";
import {
  createGeminiListingEmbeddingGenerator,
  createGeminiListingQueryEmbeddingGenerator,
  GEMINI_LISTING_EMBEDDING_MODEL
} from "../src/modules/listings/embeddings.js";
import {
  buildMainListingSearchDocument,
  createListingSearchDocumentsRepository,
  createListingSearchDocumentsService,
  type ListingSearchDocumentSource
} from "../src/modules/listings/search-documents.js";

const SEARCH_DOCUMENT_REFRESH_SECRET = "listing-refresh-test-secret";

const SOURCE: ListingSearchDocumentSource = {
  listingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  officeId: "11111111-1111-4111-8111-111111111111",
  referenceCode: "REF-001",
  title: "Kadikoy Family Flat",
  description: "Metroya yakin ve aile yasamina uygun bakimli daire.",
  propertyType: "apartment",
  listingType: "rent",
  status: "active",
  price: "45000.00",
  currency: "TRY",
  bedrooms: "3",
  bathrooms: "2",
  netM2: "135.00",
  grossM2: "150.00",
  floorNumber: "4",
  buildingAge: "6",
  dues: "1500.00",
  district: "Kadikoy",
  neighborhood: "Moda",
  addressText: "Moda, Kadikoy, Istanbul",
  hasBalcony: true,
  hasParking: false,
  hasElevator: true
};

async function insertSearchDocumentTestListing(input?: {
  status?: "active" | "inactive";
}) {
  const tenantId = randomUUID();
  const officeId = randomUUID();
  const listingId = randomUUID();

  await db.insert(tenants).values({
    id: tenantId,
    name: `Listing Search Test Tenant ${tenantId}`
  });

  await db.insert(offices).values({
    id: officeId,
    tenantId,
    name: `Listing Search Test Office ${officeId}`,
    timezone: "Europe/Istanbul",
    status: "active"
  });

  await db.insert(listings).values({
    id: listingId,
    officeId,
    referenceCode: `REF-${listingId.slice(0, 8)}`,
    title: "Search Document Integration Listing",
    description: "Main listing description for integration coverage.",
    propertyType: "apartment",
    listingType: "sale",
    status: input?.status ?? "active",
    price: "7500000.00",
    currency: "TRY",
    bedrooms: "3",
    bathrooms: "2",
    netM2: "140.00",
    grossM2: "155.00",
    floorNumber: "5",
    buildingAge: "4",
    dues: "1250.00",
    district: "Kadikoy",
    neighborhood: "Moda",
    addressText: "Moda, Kadikoy, Istanbul",
    hasBalcony: true,
    hasParking: true,
    hasElevator: true
  });

  return { tenantId, officeId, listingId };
}

async function cleanupSearchDocumentTestListing(input: {
  tenantId: string;
  officeId: string;
  listingId: string;
}) {
  await db
    .delete(listingSearchDocuments)
    .where(eq(listingSearchDocuments.listingId, input.listingId));
  await db.delete(listings).where(eq(listings.id, input.listingId));
  await db.delete(offices).where(eq(offices.id, input.officeId));
  await db.delete(tenants).where(eq(tenants.id, input.tenantId));
}

test("buildMainListingSearchDocument creates deterministic content and metadata", () => {
  const document = buildMainListingSearchDocument(SOURCE);

  assert.equal(document.documentType, "main");
  assert.equal(document.listingId, SOURCE.listingId);
  assert.equal(document.embeddingInput, document.content);
  assert.match(document.content, /Kadikoy Family Flat/);
  assert.match(document.content, /Kadikoy Moda konumunda/);
  assert.match(document.content, /Fiyat 45000\.00 TRY/);
  assert.match(document.content, /3 oda/);
  assert.match(document.content, /Balkonlu/);
  assert.deepEqual(document.metadata.referenceCode, "REF-001");
  assert.deepEqual(document.metadata.embeddingDimension, 1536);
  assert.deepEqual(document.metadata.lexicalConfig, "simple");
});

test("listing_search_documents uses the pgvector embedding type in the configured database", async () => {
  const result = await db.execute(sql`
    select format_type(a.atttypid, a.atttypmod) as embedding_type
    from pg_attribute a
    inner join pg_class c on c.oid = a.attrelid
    inner join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'listing_search_documents'
      and a.attname = 'embedding'
      and a.attnum > 0
      and not a.attisdropped
  `);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.embedding_type, "vector(1536)");
});

test("syncMainDocumentForListing builds and upserts the main document", async () => {
  const drafts = [];
  const service = createListingSearchDocumentsService({
    async findListingSourceById(listingId) {
      assert.equal(listingId, SOURCE.listingId);
      return SOURCE;
    },
    async findMainDocumentByListingId() {
      return null;
    },
    async upsertMainDocument(draft) {
      drafts.push(draft);

      return {
        id: "doc-1",
        officeId: draft.officeId,
        listingId: draft.listingId,
        documentType: draft.documentType,
        content: draft.content,
        metadata: draft.metadata,
        hasEmbedding: draft.embedding !== null,
        embeddingModel: draft.embeddingModel,
        embeddingUpdatedAt: draft.embeddingUpdatedAt,
        createdAt: new Date("2026-03-24T12:00:00.000Z"),
        updatedAt: new Date("2026-03-24T12:00:00.000Z")
      };
    }
  });

  const document = await service.syncMainDocumentForListing(SOURCE.listingId);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.documentType, "main");
  assert.equal(document.id, "doc-1");
  assert.equal(document.officeId, SOURCE.officeId);
  assert.equal(document.listingId, SOURCE.listingId);
  assert.equal(document.hasEmbedding, false);
});

test("syncMainDocumentForListing fails safely when the listing is missing", async () => {
  const service = createListingSearchDocumentsService({
    async findListingSourceById() {
      return null;
    },
    async findMainDocumentByListingId() {
      return null;
    },
    async upsertMainDocument() {
      throw new Error("should not be called");
    }
  });

  await assert.rejects(
    () => service.syncMainDocumentForListing(SOURCE.listingId),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "LISTING_NOT_FOUND"
  );
});

test("syncMainDocumentForListing clears stale embeddings when content changes", async () => {
  const drafts = [];
  const service = createListingSearchDocumentsService({
    async findListingSourceById() {
      return {
        ...SOURCE,
        description: "Yeni aciklama ile belge icerigi degisti."
      };
    },
    async findMainDocumentByListingId() {
      return {
        content: "Eski arama dokumani",
        embedding: Array.from({ length: 1536 }, () => 0.1),
        embeddingModel: "text-embedding-3-small",
        embeddingUpdatedAt: new Date("2026-03-24T10:00:00.000Z")
      };
    },
    async upsertMainDocument(draft) {
      drafts.push(draft);

      return {
        id: "doc-2",
        officeId: draft.officeId,
        listingId: draft.listingId,
        documentType: draft.documentType,
        content: draft.content,
        metadata: draft.metadata,
        hasEmbedding: draft.embedding !== null,
        embeddingModel: draft.embeddingModel,
        embeddingUpdatedAt: draft.embeddingUpdatedAt,
        createdAt: new Date("2026-03-24T12:00:00.000Z"),
        updatedAt: new Date("2026-03-24T12:05:00.000Z")
      };
    }
  });

  const document = await service.syncMainDocumentForListing(SOURCE.listingId);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.embedding, null);
  assert.equal(drafts[0]?.embeddingModel, null);
  assert.equal(drafts[0]?.embeddingUpdatedAt, null);
  assert.equal(document.hasEmbedding, false);
});

test("syncMainDocumentForListing accepts embedding payload when dimension and model are valid", async () => {
  const embedding = Array.from({ length: 1536 }, (_, index) => index / 1000);
  const drafts = [];
  const service = createListingSearchDocumentsService({
    async findListingSourceById() {
      return SOURCE;
    },
    async findMainDocumentByListingId() {
      return null;
    },
    async upsertMainDocument(draft) {
      drafts.push(draft);

      return {
        id: "doc-3",
        officeId: draft.officeId,
        listingId: draft.listingId,
        documentType: draft.documentType,
        content: draft.content,
        metadata: draft.metadata,
        hasEmbedding: draft.embedding !== null,
        embeddingModel: draft.embeddingModel,
        embeddingUpdatedAt: draft.embeddingUpdatedAt,
        createdAt: new Date("2026-03-24T12:00:00.000Z"),
        updatedAt: new Date("2026-03-24T12:00:00.000Z")
      };
    }
  });

  const document = await service.syncMainDocumentForListing(SOURCE.listingId, {
    embedding,
    embeddingModel: "text-embedding-3-small"
  });

  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0]?.embedding, embedding);
  assert.equal(drafts[0]?.embeddingModel, "text-embedding-3-small");
  assert.ok(drafts[0]?.embeddingUpdatedAt instanceof Date);
  assert.equal(document.hasEmbedding, true);
});

test("createGeminiListingEmbeddingGenerator requests retrieval-document embeddings at 1536 dimensions", async () => {
  const calls = [];
  const generator = createGeminiListingEmbeddingGenerator({
    models: {
      async embedContent(input) {
        calls.push(input);

        return {
          embeddings: [
            {
              values: Array.from({ length: 1536 }, () => 0.25)
            }
          ]
        };
      }
    }
  });

  const embedding = await generator.generateDocumentEmbedding(
    "Kadikoy Moda kiralik daire. Metroya yakin."
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    model: GEMINI_LISTING_EMBEDDING_MODEL,
    contents: "Kadikoy Moda kiralik daire. Metroya yakin.",
    config: {
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 1536
    }
  });
  assert.equal(embedding.model, GEMINI_LISTING_EMBEDDING_MODEL);
  assert.equal(embedding.values.length, 1536);
});

test("createGeminiListingQueryEmbeddingGenerator requests retrieval-query embeddings at 1536 dimensions", async () => {
  let capturedInput:
    | {
        model: string;
        contents: string;
        config: {
          taskType: string;
          outputDimensionality: number;
        };
      }
    | undefined;
  const generator = createGeminiListingQueryEmbeddingGenerator({
    models: {
      async embedContent(input) {
        capturedInput = input;

        return {
          embeddings: [
            {
              values: Array.from({ length: 1536 }, (_, index) => index / 1000)
            }
          ]
        };
      }
    }
  });

  const embedding = await generator.generateQueryEmbedding(
    "metroya yakin aile icin uygun"
  );

  assert.deepEqual(capturedInput, {
    model: GEMINI_LISTING_EMBEDDING_MODEL,
    contents: "metroya yakin aile icin uygun",
    config: {
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 1536
    }
  });
  assert.equal(embedding.model, GEMINI_LISTING_EMBEDDING_MODEL);
  assert.equal(embedding.values.length, 1536);
});

test("syncMainDocumentForListing rejects invalid embedding payloads", async () => {
  const service = createListingSearchDocumentsService({
    async findListingSourceById() {
      return SOURCE;
    },
    async findMainDocumentByListingId() {
      return null;
    },
    async upsertMainDocument() {
      throw new Error("should not be called");
    }
  });

  await assert.rejects(
    () =>
      service.syncMainDocumentForListing(SOURCE.listingId, {
        embedding: [0.1, 0.2],
        embeddingModel: "text-embedding-3-small"
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR"
  );

  await assert.rejects(
    () =>
      service.syncMainDocumentForListing(SOURCE.listingId, {
        embedding: Array.from({ length: 1536 }, () => 0.1)
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR"
  );
});

test("syncMainDocumentForListing reuses the stored embedding when content is unchanged", async () => {
  const existingEmbedding = Array.from({ length: 1536 }, () => 0.2);
  let generatorCallCount = 0;
  const drafts = [];
  const service = createListingSearchDocumentsService(
    {
      async findListingSourceById() {
        return SOURCE;
      },
      async findMainDocumentByListingId() {
        return {
          content: buildMainListingSearchDocument(SOURCE).content,
          embedding: existingEmbedding,
          embeddingModel: GEMINI_LISTING_EMBEDDING_MODEL,
          embeddingUpdatedAt: new Date("2026-03-24T10:00:00.000Z")
        };
      },
      async upsertMainDocument(draft) {
        drafts.push(draft);

        return {
          id: "doc-4",
          officeId: draft.officeId,
          listingId: draft.listingId,
          documentType: draft.documentType,
          content: draft.content,
          metadata: draft.metadata,
          hasEmbedding: draft.embedding !== null,
          embeddingModel: draft.embeddingModel,
          embeddingUpdatedAt: draft.embeddingUpdatedAt,
          createdAt: new Date("2026-03-24T12:00:00.000Z"),
          updatedAt: new Date("2026-03-24T12:00:00.000Z")
        };
      }
    },
    {
      embeddingGenerator: {
        async generateDocumentEmbedding() {
          generatorCallCount += 1;

          return {
            values: Array.from({ length: 1536 }, () => 0.5),
            model: GEMINI_LISTING_EMBEDDING_MODEL
          };
        }
      }
    }
  );

  const document = await service.syncMainDocumentForListing(SOURCE.listingId);

  assert.equal(generatorCallCount, 0);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0]?.embedding, existingEmbedding);
  assert.equal(drafts[0]?.embeddingModel, GEMINI_LISTING_EMBEDDING_MODEL);
  assert.equal(document.hasEmbedding, true);
});

test("findMainDocumentByListingId only reads the main document when other document types exist", async () => {
  const fixture = await insertSearchDocumentTestListing();
  const repository = createListingSearchDocumentsRepository(db);
  const amenitiesEmbedding = Array.from({ length: 1536 }, () => 0.8);
  const mainEmbedding = Array.from({ length: 1536 }, () => 0.2);

  try {
    await db.insert(listingSearchDocuments).values([
      {
        officeId: fixture.officeId,
        listingId: fixture.listingId,
        documentType: "amenities",
        content: "Amenity details document",
        embedding: amenitiesEmbedding,
        embeddingModel: "text-embedding-3-small",
        embeddingUpdatedAt: new Date("2026-03-24T10:00:00.000Z"),
        metadata: { section: "amenities" }
      },
      {
        officeId: fixture.officeId,
        listingId: fixture.listingId,
        documentType: "main",
        content: "Canonical main listing document",
        embedding: mainEmbedding,
        embeddingModel: "text-embedding-3-small",
        embeddingUpdatedAt: new Date("2026-03-24T11:00:00.000Z"),
        metadata: { section: "main" }
      }
    ]);

    const document = await repository.findMainDocumentByListingId(
      fixture.listingId
    );

    assert.ok(document);
    assert.equal(document.content, "Canonical main listing document");
    assert.deepEqual(document.embedding, mainEmbedding);
    assert.equal(document.embeddingModel, "text-embedding-3-small");
    assert.equal(
      document.embeddingUpdatedAt?.toISOString(),
      "2026-03-24T11:00:00.000Z"
    );
  } finally {
    await cleanupSearchDocumentTestListing(fixture);
  }
});

test("syncMainDocumentForListing ignores non-main documents instead of inheriting their embeddings", async () => {
  const fixture = await insertSearchDocumentTestListing();
  const repository = createListingSearchDocumentsRepository(db);
  const service = createListingSearchDocumentsService(repository);
  const amenitiesEmbedding = Array.from({ length: 1536 }, () => 0.5);

  try {
    await db.insert(listingSearchDocuments).values({
      officeId: fixture.officeId,
      listingId: fixture.listingId,
      documentType: "amenities",
      content: "Amenity details document",
      embedding: amenitiesEmbedding,
      embeddingModel: "text-embedding-3-small",
      embeddingUpdatedAt: new Date("2026-03-24T10:00:00.000Z"),
      metadata: { section: "amenities" }
    });

    const syncedDocument = await service.syncMainDocumentForListing(
      fixture.listingId
    );

    assert.equal(syncedDocument.documentType, "main");
    assert.equal(syncedDocument.hasEmbedding, false);
    assert.equal(syncedDocument.embeddingModel, null);
    assert.equal(syncedDocument.embeddingUpdatedAt, null);

    const persistedDocuments = await db
      .select({
        documentType: listingSearchDocuments.documentType,
        embedding: listingSearchDocuments.embedding,
        embeddingModel: listingSearchDocuments.embeddingModel
      })
      .from(listingSearchDocuments)
      .where(eq(listingSearchDocuments.listingId, fixture.listingId));

    const amenitiesDocument = persistedDocuments.find(
      (document) => document.documentType === "amenities"
    );
    const mainDocument = persistedDocuments.find(
      (document) => document.documentType === "main"
    );

    assert.ok(amenitiesDocument);
    assert.deepEqual(amenitiesDocument.embedding, amenitiesEmbedding);
    assert.equal(amenitiesDocument.embeddingModel, "text-embedding-3-small");
    assert.ok(mainDocument);
    assert.equal(mainDocument.embedding, null);
    assert.equal(mainDocument.embeddingModel, null);
  } finally {
    await cleanupSearchDocumentTestListing(fixture);
  }
});

test("syncMainDocumentForListing generates and persists a Gemini embedding when refreshing the main document", async () => {
  const fixture = await insertSearchDocumentTestListing();
  const repository = createListingSearchDocumentsRepository(db);
  const service = createListingSearchDocumentsService(
    repository,
    {
      embeddingGenerator: {
        async generateDocumentEmbedding(input) {
          assert.match(input, /Search Document Integration Listing/);

          return {
            values: Array.from({ length: 1536 }, (_, index) => index / 1000),
            model: GEMINI_LISTING_EMBEDDING_MODEL
          };
        }
      }
    }
  );

  try {
    const document = await service.syncMainDocumentForListing(fixture.listingId);

    assert.equal(document.documentType, "main");
    assert.equal(document.hasEmbedding, true);
    assert.equal(document.embeddingModel, GEMINI_LISTING_EMBEDDING_MODEL);
    assert.ok(document.embeddingUpdatedAt instanceof Date);

    const [persistedDocument] = await db
      .select({
        embedding: listingSearchDocuments.embedding,
        embeddingModel: listingSearchDocuments.embeddingModel
      })
      .from(listingSearchDocuments)
      .where(eq(listingSearchDocuments.listingId, fixture.listingId));

    assert.ok(persistedDocument);
    assert.equal(
      persistedDocument.embedding?.length,
      1536
    );
    assert.equal(
      persistedDocument.embeddingModel,
      GEMINI_LISTING_EMBEDDING_MODEL
    );
  } finally {
    await cleanupSearchDocumentTestListing(fixture);
  }
});

test("POST main search document refresh uses the app-owned default wiring to persist a generated embedding", async () => {
  const fixture = await insertSearchDocumentTestListing();
  const app = await createApp({
    listingSearchDocumentRefreshSecret: SEARCH_DOCUMENT_REFRESH_SECRET,
    listingEmbeddingGenerator: {
      async generateDocumentEmbedding(input) {
        assert.match(input, /Search Document Integration Listing/);

        return {
          values: Array.from({ length: 1536 }, (_, index) => index / 1000),
          model: GEMINI_LISTING_EMBEDDING_MODEL
        };
      }
    }
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/v1/offices/${fixture.officeId}/listings/${fixture.listingId}/search-documents/main/refresh`,
      headers: {
        "x-search-document-refresh-secret": SEARCH_DOCUMENT_REFRESH_SECRET
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.listingId, fixture.listingId);
    assert.equal(response.json().data.documentType, "main");
    assert.equal(response.json().data.hasEmbedding, true);
    assert.equal(
      response.json().data.embeddingModel,
      GEMINI_LISTING_EMBEDDING_MODEL
    );

    const [persistedDocument] = await db
      .select({
        officeId: listingSearchDocuments.officeId,
        listingId: listingSearchDocuments.listingId,
        embedding: listingSearchDocuments.embedding,
        embeddingModel: listingSearchDocuments.embeddingModel
      })
      .from(listingSearchDocuments)
      .where(eq(listingSearchDocuments.listingId, fixture.listingId));

    assert.ok(persistedDocument);
    assert.equal(persistedDocument.officeId, fixture.officeId);
    assert.equal(persistedDocument.listingId, fixture.listingId);
    assert.equal(persistedDocument.embedding?.length, 1536);
    assert.equal(
      persistedDocument.embeddingModel,
      GEMINI_LISTING_EMBEDDING_MODEL
    );
  } finally {
    await cleanupSearchDocumentTestListing(fixture);
  }
});

test("POST main search document refresh preserves active listing isolation in the app-owned path", async () => {
  const fixture = await insertSearchDocumentTestListing({
    status: "inactive"
  });
  const app = await createApp({
    listingSearchDocumentRefreshSecret: SEARCH_DOCUMENT_REFRESH_SECRET,
    listingEmbeddingGenerator: {
      async generateDocumentEmbedding() {
        assert.fail("inactive listings must not trigger embedding generation");
      }
    }
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/v1/offices/${fixture.officeId}/listings/${fixture.listingId}/search-documents/main/refresh`,
      headers: {
        "x-search-document-refresh-secret": SEARCH_DOCUMENT_REFRESH_SECRET
      }
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "LISTING_NOT_FOUND");

    const persistedDocuments = await db
      .select({ id: listingSearchDocuments.id })
      .from(listingSearchDocuments)
      .where(eq(listingSearchDocuments.listingId, fixture.listingId));

    assert.equal(persistedDocuments.length, 0);
  } finally {
    await cleanupSearchDocumentTestListing(fixture);
  }
});
