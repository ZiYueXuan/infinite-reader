import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { extractBibliography, addCopyrightIdentifiers } from './bibliography';
import type { BookBibliography } from '../../../shared/bibliography';

export interface TocEntry {
  title: string;
  href: string;
  level: number;
}

export interface ParsedChapter {
  html?: string;
  index: number;
  href: string;
  title: string;
  text: string;
}

export interface ParsedEpub {
  bibliography: BookBibliography;
  title: string | null;
  author: string | null;
  language: string | null;
  description: string | null;
  toc: TocEntry[];
  chapters: ParsedChapter[];
  cover: { mime: string; bytes: Uint8Array } | null;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  htmlEntities: true,
  isArray: (name) => ["item", "itemref", "rootfile", "meta", "creator", "navPoint", "li", "ol", "a", "nav"].includes(name),
});

const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object") {
    return Object.entries(node as Record<string, unknown>)
      .filter(([k]) => !k.startsWith("@_"))
      .map(([, v]) => textOf(v))
      .join(" ");
  }
  return "";
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}

/** Resolve `href` (possibly with ../ and %-escapes) against a base directory inside the zip. */
export function resolvePath(baseDir: string, href: string): string {
  let h = href;
  try {
    h = decodeURIComponent(href);
  } catch {
    /* keep raw */
  }
  const parts = (h.startsWith("/") ? h.slice(1) : baseDir + h).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  laquo: "«",
  raquo: "»",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oelig: "œ",
  OElig: "Œ",
  oslash: "ø",
  Oslash: "Ø",
  times: "×",
  middot: "·",
  bull: "•",
  trade: "™",
  euro: "€",
  deg: "°",
  sect: "§",
  para: "¶",
  iexcl: "¡",
  iquest: "¿",
  shy: "",
  zwnj: "",
  zwj: "",
};

const COMBINING: Record<string, string> = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  uml: "\u0308",
  tilde: "\u0303",
  cedil: "\u0327",
  ring: "\u030a",
};

function namedEntity(e: string): string | undefined {
  if (e in NAMED) return NAMED[e];
  const lower = NAMED[e.toLowerCase()];
  if (lower !== undefined && e === e.toLowerCase()) return lower;
  const m = e.match(/^([A-Za-z])(acute|grave|circ|uml|tilde|cedil|ring)$/);
  if (m) return (m[1]! + COMBINING[m[2]!]).normalize("NFC");
  return undefined;
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return "";
      }
    }
    return namedEntity(e) ?? m;
  });
}

const BLOCK_TAGS =
  "p|div|section|article|aside|header|footer|blockquote|pre|h[1-6]|li|ul|ol|dl|dt|dd|tr|table|figure|figcaption|hr|body";

/** Convert XHTML/HTML to plain text, preserving paragraph breaks. */
export function htmlToText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const s = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|svg|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})(?:\\s[^>]*)?>`, "gi"), "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstHeading(html: string): string | null {
  const m = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i) ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = clean(decodeEntities(m[1]!.replace(/<[^>]+>/g, " ")));
  return t || null;
}

interface ManifestItem {
  id: string;
  href: string;
  type: string;
  props: string;
}

function parseNav(doc: any, navDir: string): TocEntry[] {
  const out: TocEntry[] = [];
  const html = doc?.html ?? doc;
  const navs = arr<any>(html?.body?.nav ?? html?.body?.section?.nav ?? html?.body?.div?.nav);
  const toc = navs.find((n) => String(n["@_type"] ?? "").includes("toc")) ?? navs[0];
  const walk = (ol: any, level: number) => {
    for (const li of arr<any>(ol?.li)) {
      const a = arr<any>(li.a)[0];
      if (a) out.push({ title: clean(textOf(a)), href: resolvePath(navDir, String(a["@_href"] ?? "")), level });
      for (const sub of arr<any>(li.ol)) walk({ li: sub.li }, level + 1);
    }
  };
  for (const ol of arr<any>(toc?.ol)) walk(ol, 0);
  return out.filter((e) => e.title && e.href);
}

function parseNcx(doc: any, ncxDir: string): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (points: any[], level: number) => {
    for (const p of points) {
      const src = p.content?.["@_src"];
      const title = clean(textOf(p.navLabel?.text ?? p.navLabel));
      if (src && title) out.push({ title, href: resolvePath(ncxDir, String(src)), level });
      walk(arr<any>(p.navPoint), level + 1);
    }
  };
  walk(arr<any>(doc?.ncx?.navMap?.navPoint), 0);
  return out;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function parseEpub(data: Uint8Array, options: { includeSource?: boolean; skipCover?: boolean; includeAllText?: boolean } = {}): ParsedEpub {
  // Only inflate text-like entries up front; cover image is extracted in a second, targeted pass.
  const files = unzipSync(data, {
    filter: (f) => /\.(opf|ncx|xml|x?html?)$/i.test(f.name) || f.name === "mimetype",
  });
  const read = (path: string): string | null => {
    const f = files[path] ?? files[Object.keys(files).find((k) => k.toLowerCase() === path.toLowerCase()) ?? ""];
    return f ? strFromU8(f) : null;
  };

  const container = read("META-INF/container.xml");
  if (!container) throw new Error("not an EPUB: missing META-INF/container.xml");
  const rootfile = arr<any>(xml.parse(container)?.container?.rootfiles?.rootfile)[0];
  const opfPath: string | undefined = rootfile?.["@_full-path"];
  if (!opfPath) throw new Error("EPUB container has no rootfile");
  const opfText = read(opfPath);
  if (!opfText) throw new Error(`EPUB package document not found: ${opfPath}`);
  const opfDir = dirname(opfPath);
  const pkg = xml.parse(opfText).package;
  if (!pkg) throw new Error("invalid OPF package document");

  const md = pkg.metadata ?? {};
  const first = (v: unknown) => {
    const t = clean(textOf(arr(v)[0]));
    return t || null;
  };
  const title = first(md.title);
  const author = first(md.creator);
  const language = first(md.language);
  const description = first(md.description);
  const bibliography = extractBibliography(opfText, opfPath);

  const manifest = new Map<string, ManifestItem>();
  for (const it of arr<any>(pkg.manifest?.item)) {
    manifest.set(String(it["@_id"]), {
      id: String(it["@_id"]),
      href: resolvePath(opfDir, String(it["@_href"] ?? "")),
      type: String(it["@_media-type"] ?? ""),
      props: String(it["@_properties"] ?? ""),
    });
  }

  let toc: TocEntry[] = [];
  const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes("nav"));
  if (navItem) {
    const t = read(navItem.href);
    if (t) {
      try {
        toc = parseNav(xml.parse(t), dirname(navItem.href));
      } catch {
        /* fall through to NCX */
      }
    }
  }
  if (toc.length === 0) {
    const ncxId = pkg.spine?.["@_toc"];
    const ncxItem = (ncxId && manifest.get(String(ncxId))) || [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml");
    const t = ncxItem && read(ncxItem.href);
    if (t) toc = parseNcx(xml.parse(t), dirname(ncxItem.href));
  }
  const titleByHref = new Map<string, string>();
  for (const e of toc) {
    const key = e.href.split("#")[0]!;
    if (!titleByHref.has(key)) titleByHref.set(key, e.title);
  }

  const chapters: ParsedChapter[] = [];
  const readingOrder = arr<any>(pkg.spine?.itemref).map(ref => String(ref["@_idref"]));
  // Whole-book analysis also needs auxiliary endnotes/reference files outside the spine.
  // Normal indexing/navigation retains its original chapter order and filtering.
  if (options.includeAllText) {
    const inSpine = new Set(readingOrder);
    for (const item of manifest.values()) {
      if (!inSpine.has(item.id) && /x?html/i.test(item.type) && !item.props.split(/\s+/).includes('nav')) readingOrder.push(item.id);
    }
  }
  for (const id of readingOrder) {
    const item = manifest.get(id);
    if (!item || !/x?html/i.test(item.type)) continue;
    const html = read(item.href);
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < 20 && !options.includeSource && !options.includeAllText) continue;
    chapters.push({
      index: chapters.length,
      href: item.href,
      title: titleByHref.get(item.href) ?? firstHeading(html) ?? `Section ${chapters.length + 1}`,
      text,
      ...(options.includeSource ? { html } : {}),
    });
  }

  let coverItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes("cover-image"));
  if (!coverItem) {
    const meta = arr<any>(md.meta).find((m) => m["@_name"] === "cover");
    if (meta) coverItem = manifest.get(String(meta["@_content"]));
  }
  let cover: ParsedEpub["cover"] = null;
  if (!options.skipCover && coverItem && coverItem.type.startsWith("image/")) {
    const coverFiles = unzipSync(data, { filter: (f) => f.name === coverItem!.href });
    const bytes = coverFiles[coverItem.href];
    if (bytes && bytes.length < 5 * 1024 * 1024) {
      const ext = coverItem.href.split(".").pop()?.toLowerCase() ?? "";
      cover = { mime: coverItem.type || MIME_BY_EXT[ext] || "image/jpeg", bytes };
    }
  }

  addCopyrightIdentifiers(bibliography, chapters);
  return { title, author, language, description, toc, chapters, cover, bibliography };
}
