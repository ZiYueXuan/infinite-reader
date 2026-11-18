export interface CostPart { label: string; quantity: number; unit: string; usd: number }
export interface CostItem {
  id: string; operationId: string; category: string; label: string; bookId: string | null; bookTitle: string | null
  startedAt: number; status: string; model: string | null
  usd: number | null; lowUsd: number | null; basis: 'reported' | 'estimated' | 'unavailable'; reason: string
  parts: CostPart[]; tokens?: { input: number | null; output: number | null; cached: number | null }
  search?: { requests: number | null; attempts: number | null; billedRequests?: number | null; httpStatus: number | null; providerRequestId: string | null; errorCode: string | null; pricingVersion: string }
}
export interface CostSnapshot {
  feature?: 'web_search'
  since: number; asOf: number; pricingVersion: string; currency: 'USD'; truncated: boolean
  totalUsd: number; lowUsd: number; unknown: number; estimated: number; count: number
  groups: { label: string; usd: number; count: number; unknown: number; latestStartedAt: number }[]
  items: CostItem[]
  storage: { bytes: number; books: number; usdPerMonth: number }
  sources: { label: string; url: string }[]
  exclusions: string[]
}
