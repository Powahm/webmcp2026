import "dotenv/config";

/**
 * The Companies House API key is used ONLY here, in scripts/, during offline
 * ingestion. It is never imported by src/ and never reaches the client bundle.
 */
export function requireApiKey(): string {
  const key = process.env.CH_API_KEY?.trim();
  if (!key) {
    console.error(
      [
        "",
        "  CH_API_KEY is not set.",
        "",
        "  1. Register for a free key at:",
        "       https://developer.company-information.service.gov.uk/",
        "     Create an application, then generate a REST API key",
        "     (a REST key, not a streaming key).",
        "",
        "  2. Copy .env.example to .env and put the key in it:",
        "       cp .env.example .env",
        "",
        "  .env is gitignored. The key is used only by scripts/ and never",
        "  appears in the client bundle.",
        "",
      ].join("\n")
    );
    process.exit(1);
  }
  return key;
}
