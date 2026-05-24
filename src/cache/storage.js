import { pickHeaders } from "../utils.js";
import { UpstreamFetchError } from "../errors.js";

/**
 * Creates a signed upstream request with the cache-relevant request headers.
 */
export async function createStorageRequest(upstreamUrl, method, requestHeaders, storageClient) {
  const headers = pickHeaders(requestHeaders, ["range", "if-none-match", "if-modified-since"]);

  return storageClient.signedObjectRequest("", { url: upstreamUrl, method, headers });
}

/**
 * Fetches the upstream object and normalizes transport failures.
 */
export async function fetchStorageResponse(upstreamUrl, method, requestHeaders, storageClient) {
  const storageRequest = await createStorageRequest(upstreamUrl, method, requestHeaders, storageClient);

  try {
    return await fetch(storageRequest);
  } catch (error) {
    throw new UpstreamFetchError("Failed to fetch upstream object", { cause: error });
  }
}
