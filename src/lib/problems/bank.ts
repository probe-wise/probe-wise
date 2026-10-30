import "server-only";
import type { Problem } from "@/lib/problems/types";

// The problem bank (ADR 0004). Server-only: the interviewer guides must never reach a
// candidate's browser. Edit through pull requests; bump `version` on meaningful changes.
// src/lib/__tests__/problem-bank.test.ts checks structure and coverage.

const ANY_LEVEL = ["entry", "mid", "senior", "staff", "principal"] as const;
const MID_UP = ["mid", "senior", "staff", "principal"] as const;
const SENIOR_UP = ["senior", "staff", "principal"] as const;

export const PROBLEMS: readonly Problem[] = [
  // ── Fintech ─────────────────────────────────────────────────────────────
  {
    slug: "payment-ledger",
    version: 1,
    title: "Design a payment ledger that never double-charges",
    domain: "fintech",
    levels: MID_UP,
    roles: ["backend_engineer", "fullstack_engineer", "platform_sre"],
    focus: "Idempotency keys, double-entry, reconciliation",
    summary: "A ledger that records every money movement for a payments product, exactly once.",
    prompt:
      "You're building the ledger behind a payments product: customers pay merchants, merchants get payouts, refunds happen. Every movement of money must be recorded exactly once, balances must always be correct, and finance must be able to audit any balance at any point in time.",
    guide: {
      clarifications: [
        { q: "Which currencies?", a: "Multiple. Never convert inside the ledger; store amounts in minor units per currency." },
        { q: "Who calls the ledger?", a: "Internal services (checkout, payouts, refunds) through an API. Clients retry on timeouts." },
        { q: "Can entries be edited?", a: "No. Corrections are new reversing entries." },
        { q: "Consistency needs?", a: "Strong for balances on a single account. Reporting can lag by minutes." },
      ],
      scale: ["20M transactions/day, peaks of 5× at sales events", "50M accounts", "Keep everything for 7 years"],
      probes: [
        "The checkout service times out and retries. Walk me through how you avoid a double charge.",
        "How do you guarantee debits equal credits for every transaction?",
        "How do you compute an account balance as of last March 3rd?",
        "One merchant account receives 2,000 writes/sec. What breaks and how do you fix it?",
        "Your numbers disagree with the bank's settlement file. How do you find out and what do you do?",
      ],
      strongSignals: [
        "Idempotency keys stored with a unique constraint in the same transaction as the entries",
        "Double-entry: a transaction is a balanced set of postings, never a single row update",
        "Append-only entries; balances derived or cached with a version check",
        "Hot-account mitigation (sub-accounts / batching) with a clear consistency story",
      ],
      pitfalls: [
        "Updating a balance column without recording entries",
        "Dedupe in a cache that can expire or be lost",
        "Floats for money",
      ],
      reference: [
        "API: POST /transactions {idempotency_key, postings[]}; GET /accounts/{id}/balance?as_of=",
        "Tables: transactions(id, idempotency_key unique, created_at), postings(txn_id, account_id, amount, currency) with sum(amount)=0 per txn",
        "Single-region primary SQL with serializable/row-locking per account; partition by account for scale",
        "Balance snapshots + postings since snapshot for point-in-time queries",
        "Outbox for downstream events; nightly reconciliation against processor/bank files",
      ],
    },
  },
  {
    slug: "card-fraud-scoring",
    version: 1,
    title: "Design real-time card fraud scoring",
    domain: "fintech",
    levels: SENIOR_UP,
    roles: ["ml_engineer", "backend_engineer", "data_engineer"],
    focus: "Latency budgets, feature freshness, fallbacks",
    summary: "Score every card authorisation for fraud before it's approved.",
    prompt:
      "Every card authorisation must get a fraud score before the issuer approves or declines it. The score uses the cardholder's recent behaviour (spend velocity, locations, merchants) and a model the data science team retrains weekly. Design the scoring system.",
    guide: {
      clarifications: [
        { q: "Latency budget?", a: "The whole authorisation has 300 ms; fraud scoring gets 50 ms p99." },
        { q: "What if scoring is down?", a: "Authorisations must not fail. Fall back to rules." },
        { q: "How fresh must features be?", a: "Velocity features must include transactions from the last few seconds." },
      ],
      scale: ["8k authorisations/sec average, 25k peak", "300M cards", "~200 features per request"],
      probes: [
        "How do you compute 'number of transactions in the last 10 minutes' within the latency budget?",
        "The model service p99 jumps to 200 ms. What happens to authorisations?",
        "How do you roll out a new model safely?",
        "How do you make sure training features match serving features?",
      ],
      strongSignals: [
        "Online feature store with streaming aggregates (sliding windows) keyed by card",
        "Explicit latency budget per hop and timeouts with rule-based fallback",
        "Shadow / canary deployment of models; feature logging for training-serving parity",
      ],
      pitfalls: ["Querying the transaction database for aggregates on the hot path", "No fallback when the model is slow"],
      reference: [
        "Auth path: gateway → scoring service (feature fetch + model) → decision, all under 50 ms",
        "Kafka of authorisations → stream processor (Flink) → online store (Redis/Aerospike) of windowed features",
        "Model served in-process or via low-latency service; versioned; shadow scoring",
        "Log features + scores at decision time for training; labels from chargebacks arrive weeks later",
      ],
    },
  },

  // ── E-commerce ──────────────────────────────────────────────────────────
  {
    slug: "flash-sale-inventory",
    version: 1,
    title: "Design inventory reservation for a flash sale",
    domain: "ecommerce",
    levels: MID_UP,
    roles: [],
    focus: "Contention, overselling, hot keys",
    summary: "Sell 10,000 units to a million people at once without overselling.",
    prompt:
      "Your store runs flash sales: a limited number of units go on sale at a fixed time and a huge crowd tries to buy them at once. Shoppers add an item to their cart, have a few minutes to pay, and must never be sold something that's out of stock. Design inventory reservation for these sales.",
    guide: {
      clarifications: [
        { q: "How long is a reservation held?", a: "10 minutes, then released if unpaid." },
        { q: "Limit per customer?", a: "Yes, 2 units per customer per sale." },
        { q: "Is a fair queue required?", a: "Nice to have; overselling is the hard requirement." },
      ],
      scale: ["10k units, 1M concurrent shoppers at T=0", "Peak 200k add-to-cart requests/sec in the first minute"],
      probes: [
        "Two requests for the last unit arrive at the same millisecond. Who gets it and how?",
        "A single SKU row is now your hottest key. How do you scale writes to it?",
        "The payment succeeds but your reservation already expired. What happens?",
        "How do you stop bots from taking all the stock?",
      ],
      strongSignals: [
        "Atomic decrement (conditional update / Redis DECR with floor) as the source of truth for availability",
        "Sharded counters or token buckets for a hot SKU, with a reconciliation story",
        "Reservation TTL with an expiry sweeper and an idempotent payment callback",
        "Admission control / virtual waiting room in front",
      ],
      pitfalls: ["Read-then-write availability checks", "Holding database locks across the payment"],
      reference: [
        "Waiting room + rate limiter at the edge",
        "Inventory service: reserve(sku, user, qty) → atomic decrement on available, insert reservation with expires_at",
        "Split stock into N buckets to spread hot-key writes; fall through to other buckets",
        "Expiry worker returns stock; payment webhook converts reservation to order idempotently",
      ],
    },
  },
  {
    slug: "product-search",
    version: 1,
    title: "Design product search with filters",
    domain: "ecommerce",
    levels: MID_UP,
    roles: ["backend_engineer", "fullstack_engineer", "data_engineer"],
    focus: "Indexing, ranking, faceting at scale",
    summary: "Search 100M products with text, filters and facet counts.",
    prompt:
      "Shoppers search a catalogue of products by text and narrow the results with filters (brand, price range, size, rating), seeing counts next to each filter value. Sellers update prices and stock constantly. Design product search.",
    guide: {
      clarifications: [
        { q: "How fresh must results be?", a: "Price and stock within a minute; new products within 10 minutes." },
        { q: "Personalised ranking?", a: "Out of scope; relevance plus popularity is enough." },
        { q: "Languages?", a: "English only for now." },
      ],
      scale: ["100M products", "20k searches/sec peak", "5k catalogue updates/sec"],
      probes: [
        "How do you keep the index in sync with the catalogue database?",
        "Facet counts for 'brand' over 2M matching products: how are they computed fast?",
        "Price updates are 80% of writes. Do you reindex the whole document?",
        "How do you shard the index and what does a query fan out to?",
      ],
      strongSignals: [
        "Inverted index (Elasticsearch/OpenSearch) fed by CDC from the source of truth",
        "Partial updates or a separate fast-changing field store for price/stock",
        "Sharding by document with scatter-gather and a coordinator; replicas for read scale",
      ],
      pitfalls: ["SQL LIKE queries over the catalogue", "Dual writes from the app to DB and index"],
      reference: [
        "Catalogue DB → CDC (Debezium) → Kafka → indexer → search cluster",
        "Query service: parse, filter, BM25 + popularity boost, aggregations for facets",
        "Cache popular queries; autocomplete via separate prefix index",
      ],
    },
  },

  // ── Social ──────────────────────────────────────────────────────────────
  {
    slug: "home-timeline",
    version: 1,
    title: "Design a home timeline for 300M users",
    domain: "social",
    levels: MID_UP,
    roles: [],
    focus: "Fan-out on write vs read, celebrity accounts",
    summary: "Show each user the latest posts from everyone they follow.",
    prompt:
      "Users follow other users and see a home timeline of recent posts from the accounts they follow, newest first. Some accounts have tens of millions of followers. Design the timeline.",
    guide: {
      clarifications: [
        { q: "Ranked or chronological?", a: "Reverse chronological for this interview." },
        { q: "How fresh?", a: "A new post should appear for followers within 5 seconds." },
        { q: "Media?", a: "Stored separately; timeline holds post ids." },
      ],
      scale: ["300M DAU, 200 follows on average", "500M posts/day", "Timeline reads 100× post writes"],
      probes: [
        "An account with 50M followers posts. What happens under your design?",
        "How big is the timeline cache and what do you store per entry?",
        "A user who hasn't logged in for a year opens the app. What do they see and how fast?",
        "How do you handle unfollows and deleted posts?",
      ],
      strongSignals: [
        "Hybrid fan-out: push for normal accounts, pull-and-merge for celebrities",
        "Per-user timeline lists of post ids in a cache, capped length",
        "Lazy rebuild for inactive users",
      ],
      pitfalls: ["Pure fan-out on write ignoring celebrities", "Joining follows × posts at read time for everyone"],
      reference: [
        "Post service writes post; fan-out workers push ids into Redis lists for followers",
        "Celebrity posts fetched at read time and merged",
        "Timeline service: read cached list, hydrate posts from post cache, paginate by id",
      ],
    },
  },
  {
    slug: "notification-service",
    version: 1,
    title: "Design a notification service",
    domain: "social",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Delivery guarantees, batching, user preferences",
    summary: "Deliver push, email and in-app notifications, respecting preferences.",
    prompt:
      "Many product teams need to notify users through push, email and in-app messages. Users control which notifications they get and through which channels, and nobody wants to be spammed. Design a shared notification service.",
    guide: {
      clarifications: [
        { q: "Delivery guarantee?", a: "At least once, but users shouldn't see duplicates." },
        { q: "Quiet hours?", a: "Yes, per user time zone." },
        { q: "Priority?", a: "Security alerts must go out immediately; marketing can wait." },
      ],
      scale: ["1B notifications/day", "Bursts of 10M from one campaign", "Third-party providers (APNs, FCM, email) rate-limit you"],
      probes: [
        "A campaign enqueues 10M notifications. How do you avoid delaying a password-reset email?",
        "APNs is returning errors for 10 minutes. What happens?",
        "How do you avoid sending the same push twice after a worker crash?",
        "How would you collapse 50 'X liked your post' into one?",
      ],
      strongSignals: [
        "Separate queues by priority; per-provider rate limiting and retries with backoff",
        "Idempotency/dedupe key per notification",
        "Preference and quiet-hours check at send time, digest/batching",
      ],
      pitfalls: ["One FIFO queue for everything", "Synchronous calls to providers from product services"],
      reference: [
        "API: notify(user, template, data, priority, dedupe_key)",
        "Preferences service + template rendering; per-channel priority queues",
        "Channel workers with circuit breakers; delivery log for status and dedupe",
      ],
    },
  },

  // ── Media & streaming ───────────────────────────────────────────────────
  {
    slug: "video-transcoding",
    version: 1,
    title: "Design a video upload and transcoding pipeline",
    domain: "media_streaming",
    levels: MID_UP,
    roles: ["backend_engineer", "platform_sre"],
    focus: "Chunking, job orchestration, retries",
    summary: "Accept large uploads and produce streamable renditions.",
    prompt:
      "Creators upload videos up to several GB from phones and browsers on flaky connections. Each video must be transcoded into multiple resolutions for adaptive streaming and be watchable as soon as possible. Design the upload and transcoding pipeline.",
    guide: {
      clarifications: [
        { q: "Max size / length?", a: "10 GB, up to 4 hours." },
        { q: "Time to playable?", a: "Low resolution within 2 minutes for a 10-minute video." },
        { q: "Formats?", a: "HLS with 5 renditions from 240p to 4K." },
      ],
      scale: ["500k uploads/day", "Average 300 MB", "Transcoding is CPU/GPU heavy and expensive"],
      probes: [
        "The upload drops at 80%. What does the client do?",
        "How do you make a 4-hour video playable quickly?",
        "A transcoding worker dies halfway through. How is the job recovered?",
        "How do you control cost when uploads spike 10×?",
      ],
      strongSignals: [
        "Resumable multipart uploads directly to object storage via pre-signed URLs",
        "Split into segments and transcode in parallel (DAG of tasks), publish low res first",
        "Idempotent tasks with leases/heartbeats; autoscaling worker pools; priority",
      ],
      pitfalls: ["Proxying uploads through API servers", "One monolithic job per video"],
      reference: [
        "Client → pre-signed multipart upload to S3 → completion event",
        "Orchestrator splits into GOP-aligned chunks → queue → transcoders → stitch per rendition",
        "Manifest + segments to CDN origin; status updates to metadata DB",
      ],
    },
  },
  {
    slug: "live-sports-streaming",
    version: 1,
    title: "Design live streaming for a sports final",
    domain: "media_streaming",
    levels: SENIOR_UP,
    roles: ["backend_engineer", "platform_sre"],
    focus: "CDNs, latency vs scale, origin protection",
    summary: "Stream one live event to 20 million concurrent viewers.",
    prompt:
      "You're streaming a cup final live to tens of millions of viewers worldwide on phones, TVs and browsers. Viewers want it as close to real time as possible, and the stream can't fall over at kick-off. Design the live streaming system.",
    guide: {
      clarifications: [
        { q: "Target latency?", a: "Under 10 seconds glass-to-glass; lower is a bonus." },
        { q: "Concurrent viewers?", a: "20M peak, most joining in the 5 minutes before kick-off." },
        { q: "DRM / geo-blocking?", a: "Geo-restrictions apply per country." },
      ],
      scale: ["20M concurrent, average 5 Mbps → ~100 Tbps", "One ingest feed, backup feed available"],
      probes: [
        "Where does 100 Tbps come from and where does it go?",
        "Kick-off: 15M players request the manifest in 2 minutes. What protects the origin?",
        "How do you get latency from 30 s down to 5 s and what does it cost?",
        "The primary encoder fails mid-match. What do viewers see?",
      ],
      strongSignals: [
        "Multi-CDN with tiered caching / origin shield and request collapsing",
        "Short segments / LL-HLS chunked transfer with clear latency vs stability trade-off",
        "Redundant ingest and encoding, failover without manifest discontinuity",
      ],
      pitfalls: ["Serving from origin", "Ignoring the thundering herd at start time"],
      reference: [
        "Venue → redundant contribution feeds → cloud encoders (ABR ladder) → packager → origin",
        "Origin shield → multiple CDNs → players with CDN switching",
        "Pre-warm CDN, staggered joins, manifest caching with short TTL",
      ],
    },
  },

  // ── Mobility & logistics ────────────────────────────────────────────────
  {
    slug: "ride-dispatch",
    version: 1,
    title: "Design driver dispatch for a ride-hailing app",
    domain: "mobility_logistics",
    levels: MID_UP,
    roles: [],
    focus: "Geo-indexing, matching, location updates",
    summary: "Match riders with nearby drivers in seconds.",
    prompt:
      "Riders request a ride and should be matched with a nearby available driver within seconds. Drivers' phones send their location continuously. A driver must never be given two rides at once. Design dispatch.",
    guide: {
      clarifications: [
        { q: "How often do drivers send location?", a: "Every 4 seconds while online." },
        { q: "Matching quality?", a: "Closest by ETA, not straight-line distance, ideally." },
        { q: "Can a driver decline?", a: "Yes, 15 seconds to accept, then try the next driver." },
      ],
      scale: ["5M drivers online at peak", "1.2M location updates/sec", "50k ride requests/min at peak"],
      probes: [
        "Where do 1.2M location updates/sec go, and do you store them all?",
        "How do you find available drivers within 2 km quickly?",
        "Two riders are offered the same driver at once. How do you prevent a double assignment?",
        "A city is in a downtown event surge. Which component is the bottleneck?",
      ],
      strongSignals: [
        "In-memory geo index (geohash/H3 cells) partitioned by region, not a SQL table",
        "Atomic driver state transition (available → offered) with a lease/timeout",
        "Location stream to a time-series store separately from matching",
      ],
      pitfalls: ["Writing every location update to the main database", "Scanning all drivers"],
      reference: [
        "Location ingest (WebSocket/UDP) → Kafka → location service updating geo-cell index",
        "Dispatch: candidate cells → ETA ranking → offer with compare-and-set on driver state",
        "Regional sharding by city; trip service owns ride lifecycle",
      ],
    },
  },
  {
    slug: "delivery-eta",
    version: 1,
    title: "Design delivery ETA prediction",
    domain: "mobility_logistics",
    levels: SENIOR_UP,
    roles: ["ml_engineer", "data_engineer", "backend_engineer"],
    focus: "Streaming features, model serving, accuracy feedback",
    summary: "Predict and keep updating when a food delivery will arrive.",
    prompt:
      "Customers of a food delivery app see an estimated arrival time when they order, and it updates until the food arrives. The estimate depends on the restaurant's prep time, courier availability, traffic and distance. Design the ETA system.",
    guide: {
      clarifications: [
        { q: "How accurate?", a: "80% of deliveries within ±5 minutes of the first estimate." },
        { q: "Update frequency?", a: "Every 30 seconds while the order is active." },
      ],
      scale: ["2M orders/day, 60k active at peak", "ETA requests also from browsing (500k/min)"],
      probes: [
        "Which features are real time and how do they reach the model?",
        "How do you measure whether the ETA is good, and per what segment?",
        "Browsing traffic asks for ETAs for 50 restaurants at once. Same model?",
        "A restaurant is suddenly slow tonight. How quickly does the ETA reflect it?",
      ],
      strongSignals: [
        "Decomposed ETA (prep + pickup + travel) with separate signals",
        "Streaming aggregates of recent prep times per restaurant",
        "Offline evaluation + online monitoring of error distribution; cheaper model for browse",
      ],
      pitfalls: ["Only static distance-based estimates", "No feedback loop"],
      reference: [
        "Order events → stream features (restaurant prep p50 last 30 min, courier supply per zone)",
        "Feature store → ETA service with versioned models; cache for browse",
        "Actual times logged for retraining and accuracy dashboards",
      ],
    },
  },

  // ── Healthcare ──────────────────────────────────────────────────────────
  {
    slug: "clinic-booking",
    version: 1,
    title: "Design an appointment booking system for clinics",
    domain: "healthcare",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Double-booking, time zones, reminders",
    summary: "Let patients book appointments with clinicians across many clinics.",
    prompt:
      "Patients book appointments with clinicians across thousands of clinics. Clinicians set their availability, appointment types have different lengths, patients get reminders, and nobody should ever be double-booked. Design the booking system.",
    guide: {
      clarifications: [
        { q: "Time zones?", a: "Clinics in multiple time zones; patients may book from elsewhere." },
        { q: "Holds while paying?", a: "Some appointment types need a deposit; hold the slot for 5 minutes." },
        { q: "Data sensitivity?", a: "Appointment reasons are health data." },
      ],
      scale: ["20k clinicians", "1M bookings/month", "Read-heavy: availability searches 50× bookings"],
      probes: [
        "Two patients click the same 10:00 slot simultaneously. What happens?",
        "Do you store slots or compute them from availability rules?",
        "How do daylight-saving changes affect a recurring weekly availability?",
        "How are reminders sent exactly once, 24 hours before?",
      ],
      strongSignals: [
        "Unique constraint or exclusion constraint on (clinician, time range) for confirmed bookings",
        "Store times in UTC with the clinic's IANA zone; expand recurrence in local time",
        "Scheduled job/queue for reminders with idempotency; minimal PHI in notifications",
      ],
      pitfalls: ["Availability check then insert without a constraint", "Storing local times without zones"],
      reference: [
        "Availability rules + exceptions → computed slots cached per clinician/day",
        "Bookings table with exclusion constraint on tstzrange; holds with expiry",
        "Reminder scheduler; audit log of access to records",
      ],
    },
  },
  {
    slug: "patient-record-audit",
    version: 1,
    title: "Design an audit trail for patient record access",
    domain: "healthcare",
    levels: SENIOR_UP,
    roles: ["backend_engineer", "platform_sre", "data_engineer"],
    focus: "Immutability, retention, compliance queries",
    summary: "Record every access to patient records in a tamper-evident way.",
    prompt:
      "Regulations require a record of every time anyone views or changes a patient's record: who, what, when, from where and why. Compliance officers investigate suspicious access, and patients can ask who looked at their data. Design the audit trail.",
    guide: {
      clarifications: [
        { q: "Retention?", a: "At least 6 years." },
        { q: "Can audit events be lost?", a: "No. If you can't audit, you can't serve the read." },
        { q: "Queries?", a: "By patient, by staff member, by time range; anomaly reports nightly." },
      ],
      scale: ["300 hospitals", "2B access events/year", "Investigations query years of data"],
      probes: [
        "How do you guarantee every read is audited without slowing every read?",
        "An admin with database access wants to delete their own access records. What stops them?",
        "How do you answer 'who viewed my record in 2023' quickly?",
        "How do you detect a nurse snooping on a celebrity patient?",
      ],
      strongSignals: [
        "Audit write in the access path with fail-closed semantics, async durable pipeline (outbox)",
        "Append-only storage with hash chaining or WORM object storage, separate admin domain",
        "Secondary indexes / partitioning by patient and actor; tiered storage",
      ],
      pitfalls: ["Best-effort logging to application logs", "Audit store writable by the same admins"],
      reference: [
        "Access gateway emits audit event (outbox) before returning data",
        "Kafka → immutable store (WORM S3 + hash chain) and query store partitioned by month",
        "Anomaly detection batch jobs; patient-facing access report API",
      ],
    },
  },

  // ── AI / ML ─────────────────────────────────────────────────────────────
  {
    slug: "rag-assistant",
    version: 1,
    title: "Design a RAG assistant over company documents",
    domain: "ai_ml",
    levels: MID_UP,
    roles: ["ml_engineer", "backend_engineer", "fullstack_engineer"],
    focus: "Chunking, retrieval quality, access control",
    summary: "An assistant that answers employees' questions from internal documents.",
    prompt:
      "Employees ask questions in natural language and get answers grounded in the company's documents (wikis, PDFs, tickets) with citations. Documents change daily, and people must only get answers from documents they're allowed to see. Design the assistant.",
    guide: {
      clarifications: [
        { q: "Corpus size?", a: "20M documents, 5 TB of text, 50k updated per day." },
        { q: "Latency?", a: "First token within 2 seconds." },
        { q: "Permissions?", a: "Per-document ACLs from the source systems, changing frequently." },
      ],
      scale: ["50k employees, 200k questions/day", "LLM calls cost real money"],
      probes: [
        "How do you enforce that a user never sees content from a document they can't access?",
        "How do you chunk a 300-page PDF with tables?",
        "How do you know retrieval is good? What do you measure?",
        "A document is deleted. How long until it can't be cited?",
        "How do you keep cost per question under control?",
      ],
      strongSignals: [
        "ACL filtering at retrieval time (pre-filter in the vector store), not after generation",
        "Hybrid retrieval (BM25 + vectors) with re-ranking; evaluation set with recall@k and groundedness",
        "Incremental indexing pipeline with deletes; caching and model routing for cost",
      ],
      pitfalls: ["Filtering permissions after the LLM answers", "No evaluation strategy"],
      reference: [
        "Connectors → parse/chunk → embed → vector + keyword index with ACL metadata",
        "Query: rewrite → hybrid search with ACL filter → re-rank → prompt with citations → stream",
        "Offline eval harness, feedback capture, token budget per user",
      ],
    },
  },
  {
    slug: "model-serving-platform",
    version: 1,
    title: "Design a low-latency model serving platform",
    domain: "ai_ml",
    levels: SENIOR_UP,
    roles: ["ml_engineer", "platform_sre"],
    focus: "Batching, GPU utilisation, canary rollouts",
    summary: "A shared platform that serves many teams' models on GPUs.",
    prompt:
      "Many teams train models and need to serve them behind an API with low latency. GPUs are expensive and scarce, traffic is spiky, and teams ship new model versions weekly. Design a model serving platform.",
    guide: {
      clarifications: [
        { q: "Model sizes?", a: "From small rankers (CPU) to 7B-parameter LLMs (GPU)." },
        { q: "Latency targets?", a: "Per model SLOs, e.g. 50 ms p99 for rankers." },
        { q: "Multi-tenancy?", a: "Teams share clusters; one team must not starve another." },
      ],
      scale: ["300 models", "200k requests/sec total", "400 GPUs"],
      probes: [
        "How do you raise GPU utilisation without breaking latency SLOs?",
        "How do you roll out v2 of a model and roll back automatically?",
        "A model takes 3 minutes to load. Traffic spikes 5×. Now what?",
        "How do you stop one team's traffic spike starving another team?",
      ],
      strongSignals: [
        "Dynamic batching with max-wait tied to SLO; model packing/multiplexing",
        "Canary/shadow with automated metric-based rollback",
        "Warm pools / predictive scaling; per-tenant quotas and priority",
      ],
      pitfalls: ["One model per GPU forever", "Scaling on CPU utilisation for GPU workloads"],
      reference: [
        "Model registry → deploy controller → inference servers (Triton/vLLM) on k8s",
        "Router with per-model queues, batching, quotas; autoscaling on queue depth/latency",
        "Telemetry: latency, GPU utilisation, prediction drift",
      ],
    },
  },

  // ── Ad tech ─────────────────────────────────────────────────────────────
  {
    slug: "real-time-bidding",
    version: 1,
    title: "Design a real-time bidding system",
    domain: "adtech",
    levels: SENIOR_UP,
    roles: ["backend_engineer", "ml_engineer"],
    focus: "Sub-100ms budgets, budget pacing, fan-out",
    summary: "A bidder that answers ad exchange bid requests in under 100 ms.",
    prompt:
      "You run a demand-side platform. Ad exchanges send bid requests for ad slots; for each one you must decide within 100 ms whether to bid, for which advertiser's campaign, and how much, without overspending any campaign's daily budget. Design the bidder.",
    guide: {
      clarifications: [
        { q: "Hard deadline?", a: "Responses after 100 ms are discarded; aim for 50 ms in your system." },
        { q: "Budget accuracy?", a: "Overspend under 1% of daily budget." },
        { q: "Campaign count?", a: "50k active campaigns with targeting rules." },
      ],
      scale: ["2M bid requests/sec", "Win rate ~5%", "Global, 4 regions"],
      probes: [
        "How do you evaluate 50k campaigns' targeting in a few milliseconds?",
        "Spend happens in 4 regions. How do you enforce one daily budget?",
        "How do you pace a budget so it doesn't run out by 9am?",
        "Win notices arrive late or never. How does that affect spend tracking?",
      ],
      strongSignals: [
        "In-memory indexed campaign targeting (inverted index on attributes)",
        "Budget allocation to regions/servers in slices with periodic rebalancing",
        "Pacing via throttling probability; reconcile spend from win/impression logs",
      ],
      pitfalls: ["Database lookups per bid request", "Central synchronous budget counter"],
      reference: [
        "Edge bidder fleet per region with local campaign index refreshed from control plane",
        "Budget service hands out spend leases; bidders decrement locally",
        "Event pipeline for bids/wins/impressions → reporting and budget reconciliation",
      ],
    },
  },
  {
    slug: "ad-click-attribution",
    version: 1,
    title: "Design ad click attribution",
    domain: "adtech",
    levels: MID_UP,
    roles: ["data_engineer", "backend_engineer"],
    focus: "Deduplication, late events, privacy windows",
    summary: "Attribute purchases to the ad clicks that led to them.",
    prompt:
      "Advertisers pay per conversion and want to know which ad clicks led to purchases on their sites. You receive click events from your ad servers and conversion events from advertisers' sites. Design an attribution system that produces trustworthy reports.",
    guide: {
      clarifications: [
        { q: "Attribution model?", a: "Last click within a 7-day window." },
        { q: "Report freshness?", a: "Hourly for dashboards; billing is daily and must be exact." },
        { q: "Duplicates?", a: "Both clicks and conversions can be sent more than once." },
      ],
      scale: ["5B clicks/day", "50M conversions/day", "Conversions can arrive up to 3 days late"],
      probes: [
        "How do you join a conversion with a click from 6 days ago?",
        "How do you make sure a conversion is billed exactly once?",
        "A conversion arrives two days late, after the daily report shipped. What happens?",
        "How does this change if user identifiers are hashed or unavailable?",
      ],
      strongSignals: [
        "Dedup by event id with a windowed state store",
        "Streaming join with state TTL ≥ attribution window, plus batch recompute for billing",
        "Late data handling: watermarks, corrections/restatements",
      ],
      pitfalls: ["Assuming events arrive in order", "Counting at-least-once deliveries directly"],
      reference: [
        "Clicks & conversions → Kafka → Flink keyed join on user/click id with 7-day state",
        "Attributed conversions → OLAP store for hourly dashboards",
        "Daily batch (Spark) over the lake is the billing source of truth",
      ],
    },
  },

  // ── B2B SaaS ────────────────────────────────────────────────────────────
  {
    slug: "multi-tenant-isolation",
    version: 1,
    title: "Design multi-tenant data isolation",
    domain: "b2b_saas",
    levels: SENIOR_UP,
    roles: ["backend_engineer", "platform_sre"],
    focus: "Noisy neighbours, sharding by tenant, RBAC",
    summary: "Isolate customers' data and load in a SaaS product.",
    prompt:
      "Your SaaS product serves tens of thousands of business customers, from 5-person startups to enterprises with 50k users. A data leak between customers would be fatal, and one customer's heavy usage must not slow others down. Design how tenants are isolated.",
    guide: {
      clarifications: [
        { q: "Enterprise requirements?", a: "Some want data residency in the EU and their own encryption keys." },
        { q: "Tenant sizes?", a: "Top 1% of tenants generate 40% of load." },
      ],
      scale: ["30k tenants", "Largest tenant 2 TB", "50k requests/sec total"],
      probes: [
        "What guarantees a query can never return another tenant's rows?",
        "Your biggest tenant is outgrowing its shard. How do you move it without downtime?",
        "One tenant runs a huge export that saturates the database. What protects others?",
        "How do you support customer-managed encryption keys?",
      ],
      strongSignals: [
        "Clear isolation model choice (shared schema with tenant_id + RLS, schema/db per tenant) with reasons",
        "Tenant → shard directory enabling moves; cell-based architecture",
        "Per-tenant rate limits/quotas and workload isolation",
      ],
      pitfalls: ["Relying only on application-level WHERE clauses", "No plan for whale tenants"],
      reference: [
        "Tenant directory service mapping tenant → cell/shard",
        "Shared DB with tenant_id + row-level security for small tenants; dedicated for large/regulated",
        "Per-tenant quotas at gateway, async queues per tenant, envelope encryption per tenant",
      ],
    },
  },
  {
    slug: "usage-based-billing",
    version: 1,
    title: "Design usage-based billing",
    domain: "b2b_saas",
    levels: MID_UP,
    roles: ["backend_engineer", "data_engineer"],
    focus: "Metering accuracy, aggregation, invoicing",
    summary: "Meter API usage and invoice customers accurately every month.",
    prompt:
      "Your platform charges customers per API call and per GB stored, with tiered pricing and monthly invoices. Customers want to see their usage in near real time, and invoices must be exactly right. Design metering and billing.",
    guide: {
      clarifications: [
        { q: "Freshness of usage dashboard?", a: "Within 5 minutes." },
        { q: "Correctness?", a: "Never bill an event twice; missing events are lost revenue." },
        { q: "Plan changes mid-month?", a: "Prorated." },
      ],
      scale: ["10k customers", "3B metered events/day", "Monthly invoicing within 24 h of month end"],
      probes: [
        "Where are usage events emitted and how are they never lost?",
        "How do you deduplicate 3B events/day?",
        "An event from March 31 23:59 arrives on April 2. Which invoice?",
        "A customer disputes their invoice. How do you prove the number?",
      ],
      strongSignals: [
        "Durable emission (outbox / local buffer) with event ids; dedupe in aggregation",
        "Pre-aggregation into time buckets; immutable rated usage records",
        "Close period with grace window and adjustments; traceability to raw events",
      ],
      pitfalls: ["Incrementing counters in the request path database", "Recomputing invoices from mutable data"],
      reference: [
        "Services → usage events (id, customer, metric, qty, ts) → Kafka",
        "Aggregator: dedupe, roll up per customer/metric/hour into OLAP + ledger",
        "Rating engine applies price plan → invoice drafts → billing provider",
      ],
    },
  },

  // ── Gaming ──────────────────────────────────────────────────────────────
  {
    slug: "game-matchmaking",
    version: 1,
    title: "Design matchmaking for an online game",
    domain: "gaming",
    levels: MID_UP,
    roles: [],
    focus: "Skill rating, queue fairness, regions",
    summary: "Put players into fair matches quickly.",
    prompt:
      "Players of a competitive 5v5 online game join a queue and expect to be put into a fair match quickly, on a server close to them. Parties of friends can queue together. Design matchmaking.",
    guide: {
      clarifications: [
        { q: "Fairness vs wait time?", a: "Prefer fair, but nobody should wait more than 3 minutes." },
        { q: "Rating system?", a: "Existing skill rating (like Elo) per player." },
        { q: "Regions?", a: "6 regions; latency under 60 ms to the game server." },
      ],
      scale: ["2M concurrent players at peak", "40k matches started/min"],
      probes: [
        "How do you widen the acceptable skill range as someone waits longer?",
        "A party has one pro and four beginners. How do you rate it?",
        "A matchmaker instance crashes holding 5,000 queued players. What happens?",
        "How do you allocate game servers fast enough at peak?",
      ],
      strongSignals: [
        "Queue partitioned by region/mode/skill bucket; widening windows over time",
        "Match-forming as a periodic batch over a bucket, atomic claim of players",
        "Server allocation from warm fleet; queue state recoverable",
      ],
      pitfalls: ["Global single queue scanned linearly", "No upper bound on wait"],
      reference: [
        "Queue service (Redis sorted sets per region/mode by rating)",
        "Matchmaker workers form matches, claim tickets atomically",
        "Game server allocator (Agones-style), match result → rating update",
      ],
    },
  },
  {
    slug: "global-leaderboard",
    version: 1,
    title: "Design a global leaderboard",
    domain: "gaming",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Sorted sets, sharding, update frequency",
    summary: "Rank 100M players and show each one their position.",
    prompt:
      "A mobile game has a global leaderboard: the top 100 players worldwide, plus each player's own rank and the players just above and below them. Scores change after every game. Design the leaderboard.",
    guide: {
      clarifications: [
        { q: "Exact rank for everyone?", a: "Exact for the top 10k; approximate (e.g. top 3%) is fine below." },
        { q: "Seasons?", a: "Monthly seasons reset the board." },
      ],
      scale: ["100M players", "50k score updates/sec", "200k rank reads/sec"],
      probes: [
        "Why not ORDER BY score LIMIT 100 on the main database?",
        "One Redis sorted set can't hold the load. How do you shard and still get global ranks?",
        "How do you compute 'you are in the top 3%' cheaply?",
        "Two players have the same score. Who ranks higher?",
      ],
      strongSignals: [
        "Sorted set (Redis ZSET) for top-N, with tie-breaking by time",
        "Score-range sharding or bucketed histograms for approximate ranks",
        "Durable score store separate from the ranking cache; seasonal keys",
      ],
      pitfalls: ["Counting rows above a score in SQL per request at this scale"],
      reference: [
        "Scores in durable DB; updates stream to ranking service",
        "Exact ZSET for top 10k; histogram buckets for percentile of everyone else",
        "Cache the top-100 page; per-season key namespace",
      ],
    },
  },

  // ── Dev tools & infra ───────────────────────────────────────────────────
  {
    slug: "distributed-ci",
    version: 1,
    title: "Design a distributed CI system",
    domain: "devtools_infra",
    levels: SENIOR_UP,
    roles: ["platform_sre", "backend_engineer"],
    focus: "Scheduling, caching, flaky test isolation",
    summary: "Run builds and tests for thousands of engineers, fast.",
    prompt:
      "Engineers push code and a CI system builds it and runs the tests in isolated environments, reporting results back on the pull request. The monorepo is large, builds are slow, and some tests are flaky. Design the CI system.",
    guide: {
      clarifications: [
        { q: "Target time?", a: "p90 under 15 minutes from push to result." },
        { q: "Isolation?", a: "Each job in a fresh container; no secrets for untrusted forks." },
      ],
      scale: ["3k engineers", "40k pipeline runs/day", "Each run: 200 jobs, 30 min of CPU on average"],
      probes: [
        "How do you schedule 200 jobs per run across a shared fleet fairly?",
        "How do you avoid rebuilding what hasn't changed?",
        "A test fails 1 time in 50. What does your system do about it?",
        "A runner dies mid-job. How is the job retried safely?",
      ],
      strongSignals: [
        "DAG scheduler with priorities/quotas, autoscaled ephemeral runners",
        "Content-addressed build/test caching and affected-target analysis",
        "Flake detection with quarantine and retries tracked separately",
      ],
      pitfalls: ["Running every test on every commit", "Long-lived shared runners"],
      reference: [
        "Webhook → pipeline service builds job DAG → queue per pool",
        "Runners pull jobs with leases, heartbeat, upload logs/artifacts to object storage",
        "Remote cache (Bazel-style CAS); results service updates PR checks",
      ],
    },
  },
  {
    slug: "metrics-alerting",
    version: 1,
    title: "Design a metrics and alerting pipeline",
    domain: "devtools_infra",
    levels: SENIOR_UP,
    roles: ["platform_sre", "data_engineer", "backend_engineer"],
    focus: "Cardinality, downsampling, alert fatigue",
    summary: "Collect metrics from every service and alert on problems.",
    prompt:
      "Every service in the company emits metrics (counters, gauges, histograms with labels). Engineers build dashboards and define alert rules, and on-call gets paged when something breaks. Design the metrics and alerting system.",
    guide: {
      clarifications: [
        { q: "Retention?", a: "Raw 15 days, downsampled 13 months." },
        { q: "Alert latency?", a: "Page within 1 minute of a condition holding." },
      ],
      scale: ["50M active time series", "10M samples/sec ingest", "2k alert rules evaluated every 15 s"],
      probes: [
        "Someone adds user_id as a label. What happens and how do you protect the system?",
        "How do you store 10M samples/sec cheaply?",
        "The metrics pipeline itself is down. How does on-call find out?",
        "How do you reduce noisy pages without missing real incidents?",
      ],
      strongSignals: [
        "Time-series storage with compression (Gorilla-style), sharded by series hash",
        "Cardinality limits per tenant/metric at ingest",
        "Independent meta-monitoring; SLO-based alerting with burn rates",
      ],
      pitfalls: ["Relational DB for raw samples", "Alerting that depends on the thing it monitors"],
      reference: [
        "Agents/scrapers → ingest gateways (limits) → sharded TSDB (Mimir/M3-like)",
        "Downsampling jobs to object storage; query frontend with caching",
        "Rule evaluators → alert manager (dedupe, grouping, routing) → pager",
      ],
    },
  },

  // ── Travel ──────────────────────────────────────────────────────────────
  {
    slug: "hotel-reservations",
    version: 1,
    title: "Design a hotel reservation system",
    domain: "travel_hospitality",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Overbooking, holds, consistency across partners",
    summary: "Book hotel rooms by night without double-booking.",
    prompt:
      "Travellers search for hotels by city and dates and book a room type. Hotels also sell the same rooms through other channels, and some allow a small amount of overbooking. Design the reservation system.",
    guide: {
      clarifications: [
        { q: "Inventory unit?", a: "Room type per night, not specific rooms." },
        { q: "Overbooking?", a: "Hotels can allow up to 5% over capacity per room type." },
        { q: "Other channels?", a: "A channel manager syncs availability every few minutes." },
      ],
      scale: ["1M hotels", "500k bookings/day", "Search 1,000× bookings"],
      probes: [
        "Model inventory for a 3-night stay. What exactly is decremented?",
        "How do you prevent two people booking the last room?",
        "Another channel sells the last room while your customer is paying. Now what?",
        "Search is 1,000× bookings. What serves search?",
      ],
      strongSignals: [
        "Inventory rows per (hotel, room_type, date) updated atomically for all nights",
        "Conditional update with overbooking threshold; idempotent booking API",
        "Separate search index with eventually consistent availability",
      ],
      pitfalls: ["One row per hotel", "Searching the transactional DB"],
      reference: [
        "room_type_inventory(hotel, type, date, total, reserved) with check reserved ≤ total × 1.05",
        "Booking: transaction updating all nights + reservation row; holds expire",
        "Availability cache/index for search; channel manager sync with reconciliation",
      ],
    },
  },
  {
    slug: "flight-search",
    version: 1,
    title: "Design flight search across airlines",
    domain: "travel_hospitality",
    levels: SENIOR_UP,
    roles: ["backend_engineer"],
    focus: "Aggregation, caching stale fares, pricing",
    summary: "Search fares from many airlines and show accurate prices.",
    prompt:
      "Travellers search for flights between two cities on given dates and see options from many airlines, sorted by price. Fares come from slow, expensive external provider APIs, and prices change constantly. Design flight search.",
    guide: {
      clarifications: [
        { q: "Provider latency?", a: "1–10 seconds per provider call; each call costs money." },
        { q: "Price accuracy?", a: "Shown prices may be slightly stale but must be re-confirmed before booking." },
      ],
      scale: ["30 providers", "5k searches/sec", "Look-to-book ratio 1,000:1"],
      probes: [
        "You can't call 30 providers for every search. What do you do?",
        "How long can you cache a fare and what decides it?",
        "How do you return results in 2 seconds when providers take 10?",
        "The price changed at booking time. What does the user see?",
      ],
      strongSignals: [
        "Fare cache keyed by route/date with TTL based on volatility; popularity-driven prefetch",
        "Scatter-gather with per-provider timeouts and streaming partial results",
        "Price re-validation at selection/booking",
      ],
      pitfalls: ["Synchronous fan-out on every search", "Treating cached fares as bookable"],
      reference: [
        "Search API → cache lookup → async provider fan-out for misses, stream results",
        "Fare cache (Redis/Aerospike) with adaptive TTLs; background refresh of hot routes",
        "Pricing service re-quotes before booking; provider quotas/cost tracking",
      ],
    },
  },

  // ── General classics ────────────────────────────────────────────────────
  {
    slug: "url-shortener",
    version: 1,
    title: "Design a URL shortener",
    domain: "general",
    levels: ["entry", "mid"],
    roles: [],
    focus: "ID generation, read-heavy caching, redirects",
    summary: "Turn long URLs into short links and redirect fast.",
    prompt:
      "Users paste a long URL and get a short link. Anyone opening the short link is redirected to the original. Users can see how many times their links were clicked. Design the service.",
    guide: {
      clarifications: [
        { q: "Custom aliases?", a: "Optional, for signed-in users." },
        { q: "Expiry?", a: "Links can have an optional expiry." },
        { q: "Analytics?", a: "Click counts per day, can lag by an hour." },
      ],
      scale: ["100M new links/month", "Reads 100× writes", "Keep links 5 years"],
      probes: [
        "How long do the short codes need to be? Show the math.",
        "How do you generate unique codes across many servers?",
        "301 or 302, and why does it matter for analytics?",
        "How do you count clicks without slowing redirects?",
      ],
      strongSignals: [
        "Base62 sizing from the numbers; counter ranges or random with collision check",
        "Cache-heavy read path; async click events",
      ],
      pitfalls: ["Hashing the URL and truncating without handling collisions"],
      reference: [
        "POST /links → code generator (pre-allocated ranges) → key-value store",
        "GET /{code} → cache → store → 302; emit click event to queue → aggregator",
      ],
    },
  },
  {
    slug: "api-rate-limiter",
    version: 1,
    title: "Design an API rate limiter",
    domain: "general",
    levels: ANY_LEVEL,
    roles: ["backend_engineer", "platform_sre"],
    focus: "Algorithms, distributed counters, failure modes",
    summary: "Limit how often each client can call your APIs.",
    prompt:
      "Your public API needs per-customer rate limits (for example 1,000 requests per minute, with short bursts allowed), enforced across a fleet of API servers in several regions. Design the rate limiter.",
    guide: {
      clarifications: [
        { q: "Precision?", a: "A few percent over the limit briefly is acceptable." },
        { q: "Added latency budget?", a: "Under 2 ms per request." },
        { q: "If the limiter is down?", a: "Fail open, but alert." },
      ],
      scale: ["300k requests/sec", "1M API keys", "3 regions"],
      probes: [
        "Compare token bucket, fixed window and sliding window for this case.",
        "Where does the counter live, and how many network calls per request?",
        "Limits are global but traffic is in 3 regions. How do you enforce them?",
        "What headers do clients get back?",
      ],
      strongSignals: [
        "Token bucket or sliding window counter with justification",
        "Atomic increments in Redis (Lua) or local counters with periodic sync",
        "Clear fail-open/closed policy and Retry-After / RateLimit headers",
      ],
      pitfalls: ["A database row per request"],
      reference: [
        "Gateway middleware → limiter (local cache + Redis cluster) keyed by api_key:window",
        "Per-region budgets with periodic reconciliation for global limits",
      ],
    },
  },
  {
    slug: "chat-messaging",
    version: 1,
    title: "Design 1:1 and group chat",
    domain: "general",
    levels: MID_UP,
    roles: [],
    focus: "Connections, ordering, delivery receipts",
    summary: "Real-time messaging with groups, offline delivery and receipts.",
    prompt:
      "Users send messages to each other and to groups of up to 500 people, on phones that are often offline. Messages must arrive in order, and senders see delivered and read receipts. Design the chat system.",
    guide: {
      clarifications: [
        { q: "History?", a: "Stored on the server, synced across a user's devices." },
        { q: "End-to-end encryption?", a: "Out of scope for this interview." },
      ],
      scale: ["500M DAU", "60B messages/day", "Average 3 devices per user"],
      probes: [
        "How does a message reach a recipient who's connected to a different server?",
        "How do you guarantee order within a conversation?",
        "The recipient is offline for 3 days. What happens?",
        "A message goes to a 500-person group. Fan-out on write or read?",
      ],
      strongSignals: [
        "Persistent connections (WebSocket) with a session registry",
        "Per-conversation sequence numbers assigned by a single owner/partition",
        "Store-then-deliver with per-device sync cursors; push notifications when offline",
      ],
      pitfalls: ["Relying on client timestamps for order"],
      reference: [
        "Gateway (WebSocket) ↔ chat service; conversation partition assigns seq",
        "Messages in wide-column store partitioned by conversation",
        "Device inbox/cursor; receipts as messages; push for offline devices",
      ],
    },
  },
  {
    slug: "web-crawler",
    version: 1,
    title: "Design a web crawler",
    domain: "general",
    levels: MID_UP,
    roles: ["backend_engineer", "data_engineer"],
    focus: "Politeness, frontier, deduplication",
    summary: "Crawl a billion pages politely and keep them fresh.",
    prompt:
      "You need to crawl a large part of the public web to feed a search index: fetch pages, extract links, keep crawling, and revisit pages as they change, without overloading anyone's website. Design the crawler.",
    guide: {
      clarifications: [
        { q: "Freshness?", a: "Popular pages daily, the long tail monthly." },
        { q: "Robots.txt?", a: "Must be respected." },
      ],
      scale: ["1B pages per month", "~400 pages/sec sustained, average 100 KB"],
      probes: [
        "How do you avoid hitting one site with 1,000 requests at once?",
        "How do you know you've already seen this URL, or this content?",
        "How do you prioritise what to crawl next?",
        "A site generates infinite URLs (calendars). What protects you?",
      ],
      strongSignals: [
        "URL frontier with per-host queues and politeness delays",
        "URL dedupe (Bloom filter / KV) and content dedupe (simhash)",
        "Priority and recrawl scheduling; trap detection limits",
      ],
      pitfalls: ["Single global FIFO queue", "Ignoring DNS as a bottleneck"],
      reference: [
        "Frontier (priority + per-host back queues) → fetchers (DNS cache) → parser",
        "Seen-URL store, content store (object storage), link extractor back into frontier",
      ],
    },
  },
  {
    slug: "job-scheduler",
    version: 1,
    title: "Design a distributed job scheduler",
    domain: "general",
    levels: SENIOR_UP,
    roles: ["backend_engineer", "platform_sre"],
    focus: "Exactly-once execution, leases, time",
    summary: "Run millions of scheduled and recurring jobs reliably.",
    prompt:
      "Teams schedule jobs to run at a specific time or on a recurring cron schedule (send a report every Monday at 9:00, expire trials at midnight). Jobs must run on time, and must not run twice. Design the scheduler.",
    guide: {
      clarifications: [
        { q: "Precision?", a: "Within 5 seconds of the scheduled time." },
        { q: "Job duration?", a: "Seconds to an hour; the scheduler triggers, workers execute." },
      ],
      scale: ["50M scheduled jobs", "Peaks of 200k jobs due in the same minute (midnight)"],
      probes: [
        "How do you find jobs due in the next second among 50M?",
        "Two scheduler nodes both see the job is due. How do you avoid running it twice?",
        "A worker crashes mid-job. Is the job retried, and how does the job avoid double effects?",
        "200k jobs are due at midnight. What happens?",
      ],
      strongSignals: [
        "Time-bucketed storage / index on next_run_at, partitioned across scheduler shards",
        "Leases with fencing tokens; at-least-once plus idempotent jobs",
        "Smoothing/jitter and queue buffering for spikes",
      ],
      pitfalls: ["Polling the whole table every second", "Claiming 'exactly once' without idempotency"],
      reference: [
        "Jobs table partitioned by time bucket; scheduler shards own partitions",
        "Due jobs → queue with lease; workers ack; next_run computed for recurring",
      ],
    },
  },
  {
    slug: "typeahead",
    version: 1,
    title: "Design search autocomplete",
    domain: "general",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Tries, top-k, freshness",
    summary: "Suggest completions as users type, in under 100 ms.",
    prompt:
      "As users type in a search box, they see the top suggestions for what they've typed so far, based on what's popular. Suggestions should reflect trending searches within the hour. Design autocomplete.",
    guide: {
      clarifications: [
        { q: "Personalisation?", a: "No, global popularity per language." },
        { q: "Latency?", a: "Under 100 ms end to end per keystroke." },
      ],
      scale: ["10M DAU, 20 keystrokes per search", "~5B distinct historical queries"],
      probes: [
        "What data structure serves top-10 for a prefix fast?",
        "How do you update popularity without rebuilding everything?",
        "How do you avoid suggesting offensive or private queries?",
        "How much load do keystrokes create and how do you cut it?",
      ],
      strongSignals: [
        "Trie (or prefix map) with precomputed top-k per node",
        "Batch rebuild plus a streaming trending layer merged at query time",
        "Client debouncing, CDN/browser caching of short prefixes, filtering list",
      ],
      pitfalls: ["Scanning all queries per keystroke"],
      reference: [
        "Query logs → aggregation (hourly) → trie builder → sharded serving nodes",
        "Trending stream overlay; edge cache for 1–2 character prefixes",
      ],
    },
  },
];

const BY_SLUG = new Map(PROBLEMS.map((p) => [p.slug, p]));

export const getProblem = (slug: string) => BY_SLUG.get(slug) ?? null;
