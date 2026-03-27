import { GoogleGenAI } from "@google/genai";

import { env } from "../../config/env.js";
import { LISTING_SEARCH_EMBEDDING_DIMENSION } from "../../db/schema/index.js";
import { AppError } from "../../lib/errors.js";

export const GEMINI_LISTING_EMBEDDING_MODEL = "gemini-embedding-001";
const GEMINI_RETRIEVAL_DOCUMENT_TASK_TYPE = "RETRIEVAL_DOCUMENT";
const GEMINI_RETRIEVAL_QUERY_TASK_TYPE = "RETRIEVAL_QUERY";

export interface ListingEmbeddingResult {
  values: number[];
  model: string;
}

export interface ListingEmbeddingGenerator {
  generateDocumentEmbedding(input: string): Promise<ListingEmbeddingResult>;
}

export interface ListingQueryEmbeddingGenerator {
  generateQueryEmbedding(input: string): Promise<ListingEmbeddingResult>;
}

interface GeminiEmbeddingClient {
  models: {
    embedContent(input: {
      model: string;
      contents: string;
      config: {
        taskType: string;
        outputDimensionality: number;
      };
    }): Promise<{
      embeddings?: Array<{
        values?: number[] | null;
      }>;
    }>;
  };
}

function createGeminiListingTextEmbeddingGenerator(
  client: GeminiEmbeddingClient,
  input?: {
    model?: string;
    outputDimensionality?: number;
    taskType?: string;
  }
): (text: string) => Promise<ListingEmbeddingResult> {
  const model = input?.model ?? GEMINI_LISTING_EMBEDDING_MODEL;
  const outputDimensionality =
    input?.outputDimensionality ?? LISTING_SEARCH_EMBEDDING_DIMENSION;
  const taskType = input?.taskType ?? GEMINI_RETRIEVAL_DOCUMENT_TASK_TYPE;

  return async (text: string): Promise<ListingEmbeddingResult> => {
    const response = await client.models.embedContent({
      model,
      contents: text,
      config: {
        taskType,
        outputDimensionality
      }
    });
    const values = response.embeddings?.[0]?.values;

    if (!Array.isArray(values) || values.length !== outputDimensionality) {
      throw new AppError(
        "Embedding provider returned an invalid embedding vector.",
        502,
        "EMBEDDING_GENERATION_FAILED"
      );
    }

    return {
      values,
      model
    };
  };
}

export function createGeminiListingEmbeddingGenerator(
  client: GeminiEmbeddingClient,
  input?: {
    model?: string;
    outputDimensionality?: number;
  }
): ListingEmbeddingGenerator {
  const generateEmbedding = createGeminiListingTextEmbeddingGenerator(client, {
    ...input,
    taskType: GEMINI_RETRIEVAL_DOCUMENT_TASK_TYPE
  });

  return {
    async generateDocumentEmbedding(text: string): Promise<ListingEmbeddingResult> {
      return generateEmbedding(text);
    }
  };
}

export function createGeminiListingQueryEmbeddingGenerator(
  client: GeminiEmbeddingClient,
  input?: {
    model?: string;
    outputDimensionality?: number;
  }
): ListingQueryEmbeddingGenerator {
  const generateEmbedding = createGeminiListingTextEmbeddingGenerator(client, {
    ...input,
    taskType: GEMINI_RETRIEVAL_QUERY_TASK_TYPE
  });

  return {
    async generateQueryEmbedding(text: string): Promise<ListingEmbeddingResult> {
      return generateEmbedding(text);
    }
  };
}

export function createGeminiListingEmbeddingGeneratorFromEnv(): ListingEmbeddingGenerator {
  const client = createGeminiClientFromEnv();

  return createGeminiListingEmbeddingGenerator(client);
}

export function createGeminiListingQueryEmbeddingGeneratorFromEnv(): ListingQueryEmbeddingGenerator {
  const client = createGeminiClientFromEnv();

  return createGeminiListingQueryEmbeddingGenerator(client);
}

function createGeminiClientFromEnv(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) {
    throw new AppError(
      "GEMINI_API_KEY is required for listing embedding generation.",
      500,
      "GEMINI_API_KEY_MISSING"
    );
  }

  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY
  });
}
