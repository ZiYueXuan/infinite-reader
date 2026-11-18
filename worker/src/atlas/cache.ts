import type { AtlasRecognition } from "../../../shared/atlas";

/** A confident negative is durable; uncertain results must remain retryable. */
export function reusableAtlasResult(result: AtlasRecognition, currentVersion: boolean, now = Date.now()): boolean {
  if (result.status === "not_map") return true;
  const ttl = (result.status === "recognized" ? 30 : 1) * 86400_000;
  return currentVersion && now - result.recognizedAt < ttl;
}

export const atlasPrefix = (userId: string, bookId: string) => `users/${userId}/books/${bookId}/atlas/`;

export async function deleteAtlasCache(bucket: R2Bucket, userId: string, bookId: string) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: atlasPrefix(userId, bookId), cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
