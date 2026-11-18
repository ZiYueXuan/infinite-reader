/** Extracted evidence, not externally verified catalogue data. */
export interface MetadataSource {
  kind: 'opf' | 'copyright-page';
  path: string;
  field: string;
  index: number;
}

export interface MetadataValue {
  value: string;
  source: MetadataSource;
  type?: string;
}

export interface BookIdentifier {
  raw: string;
  scheme: string | null;
  normalized: string | null;
  valid: boolean | null;
  relation: 'publication' | 'source' | 'unknown';
  primary: boolean;
  source: MetadataSource;
}

export interface BookContributor {
  name: string;
  roles: string[];
  sortAs: string | null;
  source: MetadataSource;
}

export interface BookBibliography {
  schemaVersion: 1;
  extractorVersion: 1;
  format: 'epub';
  extractedAt: number;
  titles: MetadataValue[];
  contributors: BookContributor[];
  publishers: MetadataValue[];
  dates: MetadataValue[];
  languages: MetadataValue[];
  descriptions: MetadataValue[];
  subjects: MetadataValue[];
  rights: MetadataValue[];
  editions: MetadataValue[];
  identifiers: BookIdentifier[];
  /** Bounded original OPF values/attributes, including unsupported extensions. */
  raw: { field: string; value: string; attributes: Record<string, string>; source: MetadataSource }[];
  warnings: string[];
}
