import type { Domain } from "@/lib/profile-options";

/**
 * Placeholder problem set shown on the dashboard until the problem bank lands (milestone 2).
 * Two per domain so a member always sees something specific to what they picked.
 */
export const PROBLEM_PREVIEWS: Record<Domain, { title: string; focus: string }[]> = {
  fintech: [
    { title: "Design a payment ledger that never double-charges", focus: "Idempotency keys, double-entry, reconciliation" },
    { title: "Design real-time card fraud scoring", focus: "Latency budgets, feature freshness, fallbacks" },
  ],
  ecommerce: [
    { title: "Design inventory reservation for a flash sale", focus: "Contention, overselling, hot keys" },
    { title: "Design product search with filters", focus: "Indexing, ranking, faceting at scale" },
  ],
  social: [
    { title: "Design a home timeline for 300M users", focus: "Fan-out on write vs read, celebrity accounts" },
    { title: "Design a notification service", focus: "Delivery guarantees, batching, user preferences" },
  ],
  media_streaming: [
    { title: "Design a video upload and transcoding pipeline", focus: "Chunking, job orchestration, retries" },
    { title: "Design live streaming for a sports final", focus: "CDNs, latency vs scale, origin protection" },
  ],
  mobility_logistics: [
    { title: "Design driver dispatch for a ride-hailing app", focus: "Geo-indexing, matching, location updates" },
    { title: "Design delivery ETA prediction", focus: "Streaming features, model serving, accuracy feedback" },
  ],
  healthcare: [
    { title: "Design an appointment booking system for clinics", focus: "Double-booking, time zones, reminders" },
    { title: "Design an audit trail for patient record access", focus: "Immutability, retention, compliance queries" },
  ],
  ai_ml: [
    { title: "Design a RAG assistant over company documents", focus: "Chunking, retrieval quality, access control" },
    { title: "Design a low-latency model serving platform", focus: "Batching, GPU utilisation, canary rollouts" },
  ],
  adtech: [
    { title: "Design a real-time bidding system", focus: "Sub-100ms budgets, budget pacing, fan-out" },
    { title: "Design ad click attribution", focus: "Deduplication, late events, privacy windows" },
  ],
  b2b_saas: [
    { title: "Design multi-tenant data isolation", focus: "Noisy neighbours, sharding by tenant, RBAC" },
    { title: "Design usage-based billing", focus: "Metering accuracy, aggregation, invoicing" },
  ],
  gaming: [
    { title: "Design matchmaking for an online game", focus: "Skill rating, queue fairness, regions" },
    { title: "Design a global leaderboard", focus: "Sorted sets, sharding, update frequency" },
  ],
  devtools_infra: [
    { title: "Design a distributed CI system", focus: "Scheduling, caching, flaky test isolation" },
    { title: "Design a metrics and alerting pipeline", focus: "Cardinality, downsampling, alert fatigue" },
  ],
  travel_hospitality: [
    { title: "Design a hotel reservation system", focus: "Overbooking, holds, consistency across partners" },
    { title: "Design flight search across airlines", focus: "Aggregation, caching stale fares, pricing" },
  ],
};

export function previewsFor(domains: string[], limit = 4) {
  const out: { domain: Domain; title: string; focus: string }[] = [];
  // Interleave so each chosen domain is represented before any repeats.
  for (let round = 0; out.length < limit && round < 2; round++) {
    for (const d of domains) {
      const item = PROBLEM_PREVIEWS[d as Domain]?.[round];
      if (item && out.length < limit) out.push({ domain: d as Domain, ...item });
    }
  }
  return out;
}
