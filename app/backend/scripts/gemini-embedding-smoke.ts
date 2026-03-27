import { createGeminiListingEmbeddingGeneratorFromEnv } from "../src/modules/listings/embeddings.js";

const SAMPLE_INPUT =
  "Kadikoy Moda kiralik aile dairesi. Metroya yakin. Balkonlu. Sessiz sokakta.";

async function main() {
  const startedAt = Date.now();
  const generator = createGeminiListingEmbeddingGeneratorFromEnv();
  const result = await generator.generateDocumentEmbedding(SAMPLE_INPUT);

  console.log(
    JSON.stringify(
      {
        ok: result.values.length === 1536,
        model: result.model,
        vectorLength: result.values.length,
        elapsedMs: Date.now() - startedAt
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(
    JSON.stringify(
      {
        ok: false,
        message,
        stack
      },
      null,
      2
    )
  );

  process.exitCode = 1;
});
