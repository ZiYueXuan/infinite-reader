import { atlasPrefix } from './cache';

export const textExclusionPrefix = (userId: string, bookId: string) => `${atlasPrefix(userId, bookId)}text-excluded/`;

/** One immutable marker per place avoids lost updates between concurrent removals. */
export async function excludedTextPlaces(bucket: R2Bucket, userId: string, bookId: string) {
  const prefix = textExclusionPrefix(userId, bookId), ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects) ids.push(decodeURIComponent(object.key.slice(prefix.length, -5)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return ids;
}
