import { unzipSync } from "fflate";
import { HttpError } from "../lib/util";

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Only extract the requested archive member, with a pre-inflation size limit. No URL fetching. */
export function extractAtlasImage(epub: Uint8Array, path: string) {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(epub, { filter: (file) => {
      if (file.name !== path) return false;
      if (file.originalSize > MAX_IMAGE_BYTES) throw new HttpError(413, "image_too_large", "图片超过 6 MB，暂不支持识别。");
      return true;
    } });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "invalid_epub", "无法从书籍中读取图片。");
  }
  const bytes = files[path];
  if (!bytes) throw new HttpError(404, "image_not_found", "书籍中没有这张图片。");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, "image_too_large", "图片超过 6 MB，暂不支持识别。");
  const starts = (...magic: number[]) => magic.every((value, i) => bytes[i] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const mime = starts(0xff, 0xd8, 0xff) ? "image/jpeg"
    : starts(137, 80, 78, 71, 13, 10, 26, 10) ? "image/png"
    : ["GIF87a", "GIF89a"].includes(ascii(0, 6)) ? "image/gif"
    : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" ? "image/webp" : null;
  if (!mime) throw new HttpError(415, "unsupported_image", "自动识别支持 JPEG、PNG、WebP 和 GIF 图片。");
  return { bytes, mime };
}
