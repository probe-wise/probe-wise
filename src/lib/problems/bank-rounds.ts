import "server-only";
import type { Problem } from "@/lib/problems/types";

// Built-in coding problems and behavioural question sets (ADR 0010). Same rules as the
// system design bank: server-only, because the guides are confidential.

const ANY_LEVEL = ["entry", "mid", "senior", "staff", "principal"] as const;
const MID_UP = ["mid", "senior", "staff", "principal"] as const;
const SENIOR_UP = ["senior", "staff", "principal"] as const;

export const CODING_PROBLEMS: readonly Problem[] = [
  {
    roundType: "coding",
    slug: "coding-rate-limiter",
    version: 1,
    title: "Implement a sliding-window rate limiter",
    domain: "general",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Data structure choice, time windows, edge cases",
    summary: "A class that decides whether each request from a client is allowed.",
    prompt:
      "Implement a RateLimiter with a method allow(client_id, timestamp) that returns true if the request is allowed. Each client may make at most N requests in any rolling window of W seconds. Timestamps arrive in non-decreasing order, in seconds.",
    language: "python",
    starterCode: `class RateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        pass

    def allow(self, client_id: str, timestamp: int) -> bool:
        pass
`,
    guide: {
      clarifications: [
        { q: "Are timestamps sorted?", a: "Non-decreasing overall, so per client too." },
        { q: "Is the window inclusive?", a: "A request at t counts for the window (t - W, t]." },
        { q: "How many clients?", a: "Millions over time, but only a few thousand active at once." },
      ],
      scale: ["limit up to 10,000; window up to 3,600 seconds"],
      probes: [
        "Why a deque rather than a list?",
        "How does memory grow with idle clients? How would you clean them up?",
        "How would you make this thread-safe?",
        "What changes if timestamps can arrive out of order?",
      ],
      strongSignals: ["Per-client deque, evicting old timestamps on each call", "Mentions cleaning up idle clients", "Tests the boundary at exactly W seconds"],
      pitfalls: ["Fixed windows that allow 2N at the boundary", "Scanning all timestamps every call"],
      reference: [
        "dict[client] → deque of timestamps; pop left while ts <= t - W; allow if len < limit, then append",
        "O(1) amortised per call, O(limit) memory per active client",
        "Alternative: token bucket with O(1) memory but different semantics",
      ],
    },
  },
  {
    roundType: "coding",
    slug: "coding-lru-cache",
    version: 1,
    title: "Build an LRU cache",
    domain: "general",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Hash map plus linked list, O(1) operations",
    summary: "A fixed-capacity cache that evicts the least recently used entry.",
    prompt:
      "Implement an LRUCache with a fixed capacity, get(key) that returns the value or -1, and put(key, value). When the cache is full, put evicts the least recently used key. Both operations should run in O(1).",
    language: "python",
    starterCode: `class LRUCache:
    def __init__(self, capacity: int):
        pass

    def get(self, key: int) -> int:
        pass

    def put(self, key: int, value: int) -> None:
        pass
`,
    guide: {
      clarifications: [
        { q: "Does get count as a use?", a: "Yes, it makes the key most recently used." },
        { q: "Can capacity be zero?", a: "Assume at least 1, but good to ask." },
      ],
      scale: ["capacity up to 100,000; a million operations"],
      probes: [
        "Why is a plain dict not enough on its own?",
        "Walk me through put when the key already exists.",
        "How would you add a time-to-live per entry?",
      ],
      strongSignals: ["Doubly linked list with sentinel nodes plus a hash map", "Handles updating an existing key", "Can explain OrderedDict as a shortcut and what it does underneath"],
      pitfalls: ["O(n) eviction by scanning", "Forgetting to move a key on get"],
      reference: ["Map key → node; list ordered by recency; move-to-front on get/put; evict tail when over capacity"],
    },
  },
  {
    roundType: "coding",
    slug: "coding-merge-intervals",
    version: 1,
    title: "Find free time across calendars",
    domain: "general",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Sorting, merging intervals, edge cases",
    summary: "Given several people's busy times, return the slots when everyone is free.",
    prompt:
      "You're given the busy intervals of several people for one day, as lists of [start, end) in minutes since midnight. Return the intervals when everyone is free between a given day start and day end, sorted, with no zero-length slots.",
    language: "python",
    starterCode: `def free_slots(busy: list[list[list[int]]], day_start: int, day_end: int) -> list[list[int]]:
    pass
`,
    guide: {
      clarifications: [
        { q: "Are each person's intervals sorted or overlapping?", a: "Neither is guaranteed." },
        { q: "Are touching intervals free in between?", a: "No: [60,90) and [90,120) leave no gap." },
      ],
      scale: ["Up to 50 people with 100 intervals each"],
      probes: [
        "What's the complexity of your approach?",
        "Could you avoid sorting everything at once if each list were already sorted?",
        "How would you return only slots of at least 30 minutes?",
      ],
      strongSignals: ["Flattens, sorts, merges, then takes the gaps clipped to the day", "Considers touching intervals and busy time outside the day"],
      pitfalls: ["Off-by-one with half-open intervals", "Forgetting the gap before the first and after the last interval"],
      reference: ["Flatten → sort by start → merge overlapping → walk gaps within [day_start, day_end); O(n log n)", "With sorted inputs: k-way merge with a heap"],
    },
  },
  {
    roundType: "coding",
    slug: "coding-top-k-log",
    version: 1,
    title: "Top endpoints from an access log",
    domain: "general",
    levels: MID_UP,
    roles: [],
    focus: "Parsing, counting, heaps, streaming",
    summary: "Parse log lines and report the k slowest or most-hit endpoints.",
    prompt:
      "Each line of an access log looks like: '2026-10-31T10:00:01Z GET /api/orders/123 200 87ms'. Write a function that returns the k endpoints with the highest p95 latency, where an endpoint is the method plus the path with numeric IDs replaced by ':id'. Ignore lines that don't parse.",
    language: "python",
    starterCode: `def slowest_endpoints(lines: list[str], k: int) -> list[tuple[str, int]]:
    pass
`,
    guide: {
      clarifications: [
        { q: "How do you compute p95?", a: "Nearest-rank on the sorted latencies for that endpoint." },
        { q: "Ties?", a: "Break ties by endpoint name." },
      ],
      scale: ["Tests use 10,000 lines; production logs are 100 GB a day"],
      probes: [
        "What if the log doesn't fit in memory?",
        "How would you test the ID normalisation?",
        "Can you compute p95 without keeping every latency?",
      ],
      strongSignals: ["Robust parsing that skips bad lines", "Clean normalisation with a regex or segment check", "Mentions streaming quantile sketches for scale"],
      pitfalls: ["Averages instead of p95", "Crashing on a malformed line"],
      reference: ["Parse → normalise path → group latencies per endpoint → p95 each → heapq.nlargest(k)", "At scale: t-digest per endpoint, map-reduce by endpoint"],
    },
  },
];

export const BEHAVIOURAL_PROBLEMS: readonly Problem[] = [
  {
    roundType: "behavioural",
    slug: "behavioural-ownership",
    version: 1,
    title: "Ownership and delivery",
    domain: "general",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Owning outcomes, handling setbacks, getting things done",
    summary: "How the candidate takes responsibility for results, especially when things go wrong.",
    prompt:
      "We'll talk about your past work: projects you owned, what went well and what didn't. Specific examples are best: what the situation was, what you did, and what happened.",
    guide: {
      clarifications: [],
      scale: [],
      probes: [
        "Tell me about the project you're most proud of. What was your part in it?",
        "Tell me about a time you missed a deadline or a commitment. What happened next?",
        "Describe a time you took on something nobody asked you to do.",
        "What was the hardest problem you solved in the last year?",
        "If you did it again, what would you change?",
      ],
      strongSignals: ["Specific, first-person examples with outcomes", "Owns failures and describes what they changed", "Raises problems early"],
      pitfalls: ["Only 'we' with no clear personal role", "Hypothetical answers to experience questions", "Blames others"],
      reference: ["Look for situation → action → result → reflection in each story", "Probe at least one story to the third 'why'"],
    },
  },
  {
    roundType: "behavioural",
    slug: "behavioural-collaboration",
    version: 1,
    title: "Collaboration and conflict",
    domain: "general",
    levels: ANY_LEVEL,
    roles: [],
    focus: "Working with others, disagreement, feedback",
    summary: "How the candidate works with teammates, handles disagreement and gives and takes feedback.",
    prompt:
      "This conversation is about working with other people: teammates, managers and other teams. Please use real examples from your experience.",
    guide: {
      clarifications: [],
      scale: [],
      probes: [
        "Tell me about a time you strongly disagreed with a teammate. How was it resolved?",
        "Describe a time you had to work with someone difficult.",
        "Tell me about feedback you received that changed how you work.",
        "Tell me about a time you helped a colleague grow.",
        "How do you decide when to push back and when to commit?",
      ],
      strongSignals: ["Seeks to understand the other side", "Disagrees then commits", "Gives credit, takes responsibility"],
      pitfalls: ["Every conflict ends with them being right", "No examples of receiving feedback"],
      reference: ["Look for empathy, directness and follow-through", "Ask what the other person would say about the situation"],
    },
  },
  {
    roundType: "behavioural",
    slug: "behavioural-leadership",
    version: 1,
    title: "Technical leadership",
    domain: "general",
    levels: SENIOR_UP,
    roles: [],
    focus: "Influence without authority, setting direction, scope",
    summary: "How a senior candidate leads technical work and influences beyond their team.",
    prompt:
      "We'll talk about times you've led technical work: setting direction, aligning people and making hard calls. Please use specific examples.",
    guide: {
      clarifications: [],
      scale: [],
      probes: [
        "Tell me about a technical direction you set that others followed. How did you get buy-in?",
        "Describe a hard trade-off you made between speed and quality. How did you decide?",
        "Tell me about a time you changed your mind on a technical decision.",
        "How have you grown other engineers on your team?",
        "Tell me about a cross-team project that went badly. What did you learn?",
      ],
      strongSignals: ["Scope beyond their own team", "Uses data and writing to align people", "Develops others"],
      pitfalls: ["Leadership only by title", "Decisions made alone without input"],
      reference: ["Calibrate scope to the level: team (senior), several teams (staff), org (principal)"],
    },
  },
];
