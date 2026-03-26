# paper-atproto — Architecture

> **North Star:** A modernised, local-first social reader combining the best of Facebook Paper (gesture-driven, immersive cards), Neeva Gist (entity-first, story-assembled search), and Apple's Human Interface Guidelines — built on the decentralised AT Protocol.

---

## Design Principles

| Principle | Application |
|---|---|
| **Deterministic first** | All ATProto object resolution (AT URIs, DIDs, facets, labels, embeds) is pure and synchronous — no inference required for the base layer |
| **Inference off the main thread** | All Transformers.js model calls run in a dedicated web worker via `InferenceClient`. The UI thread is never blocked by model inference |
| **Local-first** | PGlite (Postgres in WASM) stores all synced posts, embeddings, and cluster signals in IndexedDB/OPFS. The app works offline after initial sync |
| **Progressive enrichment** | Posts are useful immediately (deterministic layer). Embeddings and scoring are added asynchronously. NER/Wikidata enrichment is deferred to on-demand story opening |
| **Apple HIG** | All UI follows iOS/macOS conventions: spring physics, safe areas, system colours, bottom sheets, gesture dismissal |

---

## Dual Pipeline Architecture

### Pipeline A — Entity / Story Search (Gist-style)

Inspired by Neeva Gist's approach of assembling a *story* from multiple signals rather than returning a ranked list of documents.

```
Feed post arrives
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 1: Deterministic ATProto Resolution               │
│  src/lib/resolver/atproto.ts                            │
│                                                         │
│  • parseAtUri()        — AT URI → { repo, collection,  │
│                          rkey }                         │
│  • resolveFacets()     — byte-accurate mention/tag/link │
│  • resolveEmbed()      — typed embed (image, external,  │
│                          record, recordWithMedia)        │
│  • resolveLabels()     — { src, val, neg, cts }         │
│  • canonicalDomain()   — URL → hostname (no www.)       │
│  • extractClusterSignals() — hashtags, domains,         │
│                          mentionedDids, quotedUris,      │
│                          labelValues                     │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 2: Semantic Embedding (off-thread)                │
│  src/workers/inference.worker.ts                        │
│  src/workers/InferenceClient.ts                         │
│                                                         │
│  • Model: Xenova/all-MiniLM-L6-v2 (quantized ONNX)     │
│  • 384-d embeddings stored in PGlite pgvector column    │
│  • Worker warm-up on app start; lazy model download     │
│  • Promise-based API: inferenceClient.embed(text)       │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 3: Clustering (Phase 2)                           │
│                                                         │
│  Group posts by shared cluster signals:                 │
│  • Shared quoted AT URI                                 │
│  • Shared canonical domain                             │
│  • Shared hashtag                                       │
│  • Cosine similarity of embeddings (pgvector <=>)       │
│  • Mentioned DID overlap                                │
│                                                         │
│  Output: StoryCluster { rootUri, members[], signals }   │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 4: Story Card Assembly                            │
│  src/components/StoryMode.tsx                           │
│                                                         │
│  Cards rendered in order:                               │
│  0. Overview   — stats, gist summary, author, media     │
│  1. Source     — full text with byte-accurate facets,   │
│                  labels, AT URI                         │
│  2. Conversation — scored replies (see Pipeline B)      │
│  3. Signals    — deterministic cluster signals          │
│  4. Interpolator — Pipeline B rolling state             │
└─────────────────────────────────────────────────────────┘
```

---

### Pipeline B — Rolling Conversation Interpolation (Narwhal-style)

Inspired by Narwhal's approach of maintaining a *rolling state* of a conversation that updates as new replies arrive and as user feedback is collected.

```
Thread opened in StoryMode
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 1: Thread Resolution                              │
│  resolveThread(ThreadViewPost) → ThreadNode tree        │
│                                                         │
│  Each node: { uri, text, facets, embed, labels,         │
│               likeCount, replyCount, replies[] }        │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: Usefulness Scoring                             │
│  src/store/threadStore.ts                               │
│                                                         │
│  Phase 1 (current): heuristicScoreReply()               │
│  • Signals: question mark, link presence, word count,   │
│    agreement/disagreement keywords, repetition check    │
│  • Output: ContributionRole + usefulnessScore (0–1)     │
│                                                         │
│  Phase 2 (planned): SetFit few-shot classifier          │
│  • 8–16 labelled examples per role                      │
│  • Runs in inference worker                             │
│  • Roles: clarifying | new_information | direct_response│
│    | repetitive | provocative | useful_counterpoint     │
│    | story_worthy                                        │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: Rolling State Update                           │
│  useThreadStore (Zustand)                               │
│                                                         │
│  ThreadState per root URI:                              │
│  • summaryText        — human-readable summary          │
│  • salientClaims[]    — key claims from the thread      │
│  • clarificationsAdded[] — clarifying replies           │
│  • newAnglesAdded[]   — new-information replies         │
│  • repetitionLevel    — 0–1 fraction of repetitive      │
│  • heatLevel          — 0–1 conflict/derailment signal  │
│  • sourceSupportPresent — any external links cited      │
│  • replyScores{}      — per-reply score + user feedback │
│  • version            — incremented on each update      │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: User Feedback Loop                             │
│                                                         │
│  Per-reply feedback buttons in ConversationCard:        │
│  • Clarifying | New to me | Provocative | AHA!          │
│                                                         │
│  Feedback stored in threadStore.replyScores[uri]        │
│  → Phase 2: used to fine-tune SetFit classifier         │
└─────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 5: Interpolator Card                              │
│  StoryMode card index 4                                 │
│                                                         │
│  Displays:                                              │
│  • AI-generated rolling summary                         │
│  • Heat level + repetition meters                       │
│  • New angles introduced                                │
│  • Top 3 most useful replies                            │
│  • Source support indicator                             │
└─────────────────────────────────────────────────────────┘
```

---

## Module Map

```
src/
├── lib/
│   ├── atproto/
│   │   ├── errors.ts       — typed error kinds + retryability
│   │   ├── retry.ts        — decorrelated jitter backoff
│   │   ├── client.ts       — atpCall / atpMutate (all API calls)
│   │   └── queries.ts      — TanStack Query hooks
│   └── resolver/
│       ├── mappers.ts      — ATProto object to UI model mappers
│       └── atproto.ts      — Pipeline A Tier 1: deterministic resolver
│
├── workers/
│   ├── inference.worker.ts — Transformers.js worker (off main thread)
│   └── InferenceClient.ts  — Promise-based worker API
│
├── store/
│   ├── sessionStore.ts     — Zustand: BskyAgent + session + profile
│   ├── uiStore.ts          — Zustand: active tab, compose, story
│   └── threadStore.ts      — Zustand: Pipeline B rolling thread state
│
├── atproto/
│   └── AtpContext.tsx      — React context (delegates to sessionStore)
│
├── shell/
│   ├── TabBar.tsx          — bottom nav with unread badge
│   └── OverlayHost.tsx     — ComposeSheet + StoryMode overlay manager
│
├── components/
│   ├── StoryMode.tsx       — 5-card story reader (both pipelines)
│   ├── PostCard.tsx        — feed card with tappable body + RichText
│   ├── ComposeSheet.tsx    — live-preview composer with facet detection
│   ├── LoginScreen.tsx     — app-password login
│   └── EntitySheet.tsx     — entity details (Phase 3: live ATProto data)
│
└── tabs/
    ├── HomeTab.tsx         — timeline + author feed + discover (TanStack Query)
    ├── ExploreTab.tsx      — search + suggested feeds + suggested actors
    ├── InboxTab.tsx        — live notifications + mark-as-read
    └── LibraryTab.tsx      — liked posts + my feeds + my packs
```

### Composer Tone Analysis Architecture

- Analyzer module: `src/lib/sentiment.ts`
- UI surface: `src/components/ComposeSheet.tsx`
- Levels: `alert`, `warn`, `positive`, `ok`
- Positive architecture contains both:
       - `supportiveReplySignals[]` (empathy/validation/support language)
       - `constructiveSignals[]` (practical help/context-building language)
- Reply-context inputs include parent text plus thread activity context:
       - `parentReplyCount`
       - `parentThreadCount`
- Thread-aware context inputs include full conversation snippets when available:
       - `threadTexts[]` (root/threaded post bodies)
       - `commentTexts[]` (reply/comment bodies)
       - `totalCommentCount`
- High-activity reply threads lower the threshold for showing constructive/supportive guidance to reduce pile-on tone and encourage helpful replies to the original poster.

---

## Phase Roadmap

### Phase 1 (complete)
- Deterministic ATProto resolver (`lib/resolver/atproto.ts`)
- Inference worker + `InferenceClient` (all Transformers.js off main thread)
- `sync.ts` and `search.ts` migrated to use `InferenceClient`
- NER/Wikidata removed from sync hot path
- StoryMode rebuilt as 5-card typed deck (Overview, Source, Conversation, Signals, Interpolator)
- Pipeline B: `threadStore`, `heuristicScoreReply`, `buildRollingSummary`
- User feedback buttons on replies (Clarifying / New to me / Provocative / AHA!)
- TanStack Query + Zustand session/UI stores
- Shell refactor: `TabBar`, `OverlayHost`
- Retry/backoff transport layer

### Phase 2 (planned)
- SetFit few-shot classifier in inference worker (replaces heuristic scorer)
- Detoxify abuse scoring in inference worker
- Pipeline A Tier 3: clustering by shared signals + cosine similarity
- EntitySheet wired to live ATProto actor/feed/hashtag data
- OAuth + PKCE login flow (app-password as fallback)

### Phase 3 (planned)
- Explore rebuilt as entity-first results (actors, feeds, topics, domains)
- StoryMode cluster view: multiple posts assembled into one story
- Reading queue with PGlite persistence
- Optional GPT-4.1-mini summarisation for Interpolator card
- Labeler integration: user-configurable label filters

---

## Key Decisions

**Why not NER in the sync hot path?**
The original `sync.ts` called `distilbert-base-uncased-finetuned-conll03-english` (a 260MB model) on every synced post, on the main thread, blocking the UI. ATProto's native facets already provide byte-accurate mention/hashtag/link spans — deterministically, with zero inference cost. NER is preserved for optional on-demand enrichment only.

**Why heuristics before SetFit?**
SetFit requires a small labelled dataset and a worker-side training loop. The heuristic scorer provides immediately useful role labels and usefulness scores while that dataset is being built from user feedback (the four feedback buttons on every reply).

**Why keep `MockPost` as the internal type?**
All existing components (PostCard, LibraryTab cards, OverviewCard) already render `MockPost`. The `mapFeedViewPost` adapter converts live ATProto data at the boundary, keeping the component layer stable while the data layer evolves.

**Authentication**
The app uses ATProto app-passwords (not the main account password) stored in `localStorage` via the `persistSession` callback in `BskyAgent`. OAuth + PKCE is planned for Phase 2. All PDS communication is over HTTPS. Session tokens are never logged.

**Sync and conflict resolution**
The local PGlite database is append-only for synced posts (`ON CONFLICT DO NOTHING`). User-created posts are pushed to the PDS first, then indexed locally. Conflict resolution is last-write-wins at the PDS level (ATProto's MST handles this).
