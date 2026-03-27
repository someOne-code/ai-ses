import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import {
  LISTING_SEARCH_EMBEDDING_DIMENSION,
  LISTING_SEARCH_TSVECTOR_CONFIG,
  listingSearchDocuments,
  listings
} from "../../db/schema/index.js";
import { AppError } from "../../lib/errors.js";
import type { ListingEmbeddingGenerator } from "./embeddings.js";

export interface ListingSearchDocumentSource {
  listingId: string;
  officeId: string;
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
  hasBalcony: boolean | null;
  hasParking: boolean | null;
  hasElevator: boolean | null;
}

export interface ListingSearchDocumentDraft {
  officeId: string;
  listingId: string;
  documentType: "main";
  content: string;
  embeddingInput: string;
  metadata: Record<string, unknown>;
}

export interface ListingSearchDocumentRecord {
  id: string;
  officeId: string;
  listingId: string;
  documentType: string;
  content: string;
  metadata: Record<string, unknown>;
  hasEmbedding: boolean;
  embeddingModel: string | null;
  embeddingUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ExistingListingSearchDocument {
  content: string;
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingUpdatedAt: Date | null;
}

const MAIN_LISTING_SEARCH_DOCUMENT_TYPE = "main" as const;

function normalizeNumericLabel(
  value: string | null,
  label: string
): string | null {
  return value === null ? null : `${value} ${label}`;
}

function normalizeBooleanAmenity(
  value: boolean | null,
  label: string
): string | null {
  return value ? label : null;
}

function compactSentences(parts: Array<string | null>): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(". ");
}

export function buildMainListingSearchDocument(
  source: ListingSearchDocumentSource
): ListingSearchDocumentDraft {
  const location = [source.district, source.neighborhood]
    .filter((value): value is string => value !== null && value.trim() !== "")
    .join(" ");
  const price =
    source.price === null ? null : `Fiyat ${source.price} ${source.currency}`;
  const facts = [
    normalizeNumericLabel(source.bedrooms, "oda"),
    normalizeNumericLabel(source.bathrooms, "banyo"),
    normalizeNumericLabel(source.netM2, "net m2"),
    normalizeNumericLabel(source.grossM2, "brut m2"),
    normalizeNumericLabel(source.floorNumber, "kat"),
    normalizeNumericLabel(source.buildingAge, "bina yasi"),
    source.dues === null ? null : `Aidat ${source.dues} ${source.currency}`
  ]
    .filter((value): value is string => value !== null)
    .join(". ");
  const amenities = [
    normalizeBooleanAmenity(source.hasBalcony, "Balkonlu"),
    normalizeBooleanAmenity(source.hasParking, "Otoparkli"),
    normalizeBooleanAmenity(source.hasElevator, "Asansorlu")
  ]
    .filter((value): value is string => value !== null)
    .join(". ");

  const content = compactSentences([
    source.title,
    source.listingType ? `${source.listingType} ilan` : null,
    source.propertyType ? `${source.propertyType} tipinde` : null,
    location === "" ? null : `${location} konumunda`,
    price,
    facts === "" ? null : facts,
    amenities === "" ? null : amenities,
    source.addressText,
    source.description
  ]);

  return {
    officeId: source.officeId,
    listingId: source.listingId,
    documentType: MAIN_LISTING_SEARCH_DOCUMENT_TYPE,
    content,
    embeddingInput: content,
    metadata: {
      builderVersion: 1,
      embeddingDimension: LISTING_SEARCH_EMBEDDING_DIMENSION,
      lexicalConfig: LISTING_SEARCH_TSVECTOR_CONFIG,
      listingStatus: source.status,
      referenceCode: source.referenceCode,
      district: source.district,
      neighborhood: source.neighborhood,
      propertyType: source.propertyType,
      listingType: source.listingType,
      amenities: {
        hasBalcony: source.hasBalcony,
        hasParking: source.hasParking,
        hasElevator: source.hasElevator
      }
    }
  };
}

export function createListingSearchDocumentsRepository(db: Database) {
  return {
    async findListingSourceById(
      listingId: string
    ): Promise<ListingSearchDocumentSource | null> {
      const [listing] = await db
        .select({
          listingId: listings.id,
          officeId: listings.officeId,
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
          hasBalcony: listings.hasBalcony,
          hasParking: listings.hasParking,
          hasElevator: listings.hasElevator
        })
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      return listing ?? null;
    },

    async findMainDocumentByListingId(
      listingId: string
    ): Promise<ExistingListingSearchDocument | null> {
      const [document] = await db
        .select({
          content: listingSearchDocuments.content,
          embedding: listingSearchDocuments.embedding,
          embeddingModel: listingSearchDocuments.embeddingModel,
          embeddingUpdatedAt: listingSearchDocuments.embeddingUpdatedAt
        })
        .from(listingSearchDocuments)
        .where(
          and(
            eq(listingSearchDocuments.listingId, listingId),
            eq(
              listingSearchDocuments.documentType,
              MAIN_LISTING_SEARCH_DOCUMENT_TYPE
            )
          )
        )
        .limit(1);

      return document ?? null;
    },

    async upsertMainDocument(
      draft: ListingSearchDocumentDraft & {
        embedding: number[] | null;
        embeddingModel: string | null;
        embeddingUpdatedAt: Date | null;
      }
    ): Promise<ListingSearchDocumentRecord> {
      const [document] = await db
        .insert(listingSearchDocuments)
        .values({
          officeId: draft.officeId,
          listingId: draft.listingId,
          documentType: draft.documentType,
          content: draft.content,
          embedding: draft.embedding,
          embeddingModel: draft.embeddingModel,
          embeddingUpdatedAt: draft.embeddingUpdatedAt,
          metadata: draft.metadata
        })
        .onConflictDoUpdate({
          target: [
            listingSearchDocuments.listingId,
            listingSearchDocuments.documentType
          ],
          set: {
            content: draft.content,
            embedding: draft.embedding,
            embeddingModel: draft.embeddingModel,
            embeddingUpdatedAt: draft.embeddingUpdatedAt,
            metadata: draft.metadata,
            updatedAt: new Date()
          }
        })
        .returning({
          id: listingSearchDocuments.id,
          officeId: listingSearchDocuments.officeId,
          listingId: listingSearchDocuments.listingId,
          documentType: listingSearchDocuments.documentType,
          content: listingSearchDocuments.content,
          metadata: listingSearchDocuments.metadata,
          hasEmbedding: sql<boolean>`${listingSearchDocuments.embedding} is not null`,
          embeddingModel: listingSearchDocuments.embeddingModel,
          embeddingUpdatedAt: listingSearchDocuments.embeddingUpdatedAt,
          createdAt: listingSearchDocuments.createdAt,
          updatedAt: listingSearchDocuments.updatedAt
        });

      if (!document) {
        throw new AppError("Failed to upsert listing search document.", 500);
      }

      return document;
    }
  };
}

export type ListingSearchDocumentsRepository = ReturnType<
  typeof createListingSearchDocumentsRepository
>;

export function createListingSearchDocumentsService(
  repository: ListingSearchDocumentsRepository,
  options?: {
    embeddingGenerator?: ListingEmbeddingGenerator;
  }
) {
  const embeddingGenerator = options?.embeddingGenerator;

  return {
    buildMainDocument(source: ListingSearchDocumentSource) {
      return buildMainListingSearchDocument(source);
    },

    async syncMainDocumentForListing(
      listingId: string,
      input?: {
        embedding?: number[];
        embeddingModel?: string;
      }
    ): Promise<ListingSearchDocumentRecord> {
      const source = await repository.findListingSourceById(listingId);

      if (!source) {
        throw new AppError("Listing not found.", 404, "LISTING_NOT_FOUND");
      }

      if (input?.embedding && input.embedding.length !== LISTING_SEARCH_EMBEDDING_DIMENSION) {
        throw new AppError(
          `Embedding must contain ${LISTING_SEARCH_EMBEDDING_DIMENSION} values.`,
          400,
          "VALIDATION_ERROR"
        );
      }

      if (input?.embedding && !input.embeddingModel) {
        throw new AppError(
          "Embedding model is required when embedding is provided.",
          400,
          "VALIDATION_ERROR"
        );
      }

      const existingDocument = await repository.findMainDocumentByListingId(listingId);
      const draft = buildMainListingSearchDocument(source);
      const contentChanged =
        existingDocument !== null && existingDocument.content !== draft.content;
      const shouldGenerateEmbedding =
        input?.embedding === undefined &&
        embeddingGenerator !== undefined &&
        (existingDocument?.embedding === null ||
          existingDocument === null ||
          contentChanged);

      let embedding =
        input?.embedding ??
        (contentChanged ? null : (existingDocument?.embedding ?? null));
      let embeddingModel =
        input?.embedding !== undefined
          ? (input.embeddingModel ?? null)
          : contentChanged
            ? null
            : (existingDocument?.embeddingModel ?? null);
      let embeddingUpdatedAt =
        input?.embedding !== undefined
          ? new Date()
          : contentChanged
            ? null
            : (existingDocument?.embeddingUpdatedAt ?? null);

      if (shouldGenerateEmbedding) {
        const generatedEmbedding = await embeddingGenerator.generateDocumentEmbedding(
          draft.embeddingInput
        );

        embedding = generatedEmbedding.values;
        embeddingModel = generatedEmbedding.model;
        embeddingUpdatedAt = new Date();
      }

      return repository.upsertMainDocument(
        {
          ...draft,
          embedding,
          embeddingModel,
          embeddingUpdatedAt
        }
      );
    }
  };
}

export type ListingSearchDocumentsService = ReturnType<
  typeof createListingSearchDocumentsService
>;
