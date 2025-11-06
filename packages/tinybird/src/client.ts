import { Tinybird } from "@chronark/zod-bird";

// Initialize Tinybird only if token is provided
// Otherwise, analytics will be skipped
export const tb = process.env.TINYBIRD_TOKEN
  ? new Tinybird({
      token: process.env.TINYBIRD_TOKEN,
      baseUrl: process.env.TINYBIRD_BASE_URL,
    })
  : null;
