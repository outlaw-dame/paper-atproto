# Design North Star Notes — ATProto Paper

## Facebook Paper Core Principles
- Content-first, immersive: each post/article feels like a full-screen card
- Print & magazine sensibilities: large cover imagery, sparse typography, editorial section names
- Gesture-driven: swipe sideways, pull down, "unfold" articles, tilt to explore photos
- Composer-as-preview: live WYSIWYG preview while composing
- Motion as identity: unfolding, bouncing, gliding, fading, tilting
- Horizontal structure instead of one endless vertical stream
- Editorial presentation: custom "article covers" and visual treatments
- Content over interface: hide most controls until needed, cut back visible chrome

## Neeva Gist Influence
- Clean, knowledge-graph-style cards
- Rich metadata surface: source, date, reading time, topic tags
- Curated, summarized content presentation
- Strong visual hierarchy with clear type scales

## Explore/Search — Product Direction
- Make discovery **snackable, not shallow**: each surfaced item should give the user enough context to decide whether to dive deeper without forcing them to open everything.
- Prioritize **beautiful evidence cards** for linked content, popular posts, and media-heavy results: strong cover image or media frame, concise synopsis, source/domain treatment, and explicit next action.
- Every high-signal card should answer three questions immediately:
	- what is this about?
	- why did it surface?
	- what can I do next?
- Use existing strengths in the app as first-class card elements:
	- entity linking and matching
	- story/source explanation chips
	- synopsis text
	- source/domain capsules
	- media and long-form detection
- Cards should create **forward pull**: the design should make the user want to open the post/thread, read the linked article, listen to the feed item, or watch the attached media.

## Explore/Search — Card Rules
- Lead with one strong visual anchor when available: article image, post media, domain art, or a refined fallback visual treatment.
- Follow with a short synopsis that is specific, not generic. It should feel like an editorial dek, not a model blob.
- Keep the first read fast:
	- headline/title
	- 1-2 sentence synopsis
	- source/domain
	- entity chips
	- why-it-surfaced chips
- Show different card weight by content type:
	- linked article: source-forward card with read invitation
	- popular post/thread: discussion-forward card with contributor/entity pull
	- podcast/feed/media: play/watch/listen invitation with format cues
- Cards with links should clearly signal the destination type: article, thread, podcast, video, external source, or feed.
- Popular content without links should still feel rich through thread synopsis, contributor/entity context, and visible momentum signals.

## Explore/Search — Interaction Rules
- Support quick glances first, deeper exploration second.
- Let the user tap anywhere meaningful:
	- card body opens the story/post/thread
	- entity chips pivot discovery by entity
	- source capsule opens source-focused exploration
	- media region opens the media or linked target
- Preserve user momentum:
	- returning from a post/thread should feel like returning to a story lane, not restarting search
	- related pivots should feel adjacent, not disorienting
- Avoid over-orchestration:
	- do not force swipe-story sequencing for every lookup
	- do not hide the underlying post or source behind too many transitions
	- do not make "interesting" slower than "useful"

## Explore/Search — User-Friendly Suggestions
- Add a stronger primary CTA per card based on content type:
	- `Read article`
	- `Open thread`
	- `Watch media`
	- `Listen now`
- Add a small `Why this surfaced` affordance that expands deterministic reasons without bloating the base card.
- Keep `Why this surfaced` compact by default:
	- hidden until requested
	- short enough to scan in a second or two
	- never larger or louder than the synopsis itself
- Use entity chips as real navigation, not decoration. The best cards should make entity pivots feel natural and rewarding.
- Treat linked long-form content as premium visual inventory: better imagery, cleaner typography, and a more magazine-like layout than ordinary posts.
- Add soft continuation cues such as `More in this story` or `Related entities` when there is genuine clustering signal.
- Distinguish discovery moods:
	- quick search mode for fast lookup
	- story mode for richer browsing
- Make audio/video/feed items feel native to the app instead of article-shaped replicas.
- Keep repetition low across adjacent cards; if several results say the same thing, cluster or suppress them.

## Explore/Search — Implementation Checklist
- Featured story cards:
	- add explicit content-type badge
	- separate headline from synopsis
	- add a primary deep-link CTA
	- preserve entity chips and source visibility
- Compact story cards:
	- keep them glanceable but still show destination type and CTA
	- ensure linked content feels richer than plain post cards
- Search results:
	- preserve intent labels
	- make top results feel editorial rather than raw post dumps
- Linked content:
	- give article/video/audio destinations distinct affordances
	- clarify whether the next step is reading, watching, listening, or opening the thread
- Popular non-link content:
	- elevate thread momentum, entities, and conversation pull so the card still feels worth opening
- Relevance explanations:
	- keep `why this surfaced` bounded and deterministic
	- never replace the underlying post/source with opaque packaging
- Future follow-up:
	- cluster repetitive cards into story groups
	- expose `More in this story` when clustering becomes trustworthy

## Apple HIG Principles (2026)
- Hierarchy, legibility, and adaptation
- Dynamic/system-adaptive color (dark mode intentional, not just inverted)
- Typography: calm, readable, legible, scalable
- Avoid cramped control density
- Navigation: tab bars for major sections, toolbars for frequent commands
- Gestures enhance direct manipulation, provide immediate feedback
- Motion clarifies state changes and hierarchy (respect prefers-reduced-motion)
- Accessibility: sufficient contrast, text enlargement, touch targets ≥44pt
- Responsive layout is mandatory

## Modern Social App Standards (2026)
- WCAG 2.2: Focus Not Obscured, Target Size (Minimum), Consistent Help
- Core Web Vitals: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1
- Predictability, visible system status, clear hierarchy, user control, consistency
- Respect user preferences: prefers-reduced-motion, color-scheme

## Library Tab "Saved" Cards — Design Direction
- Large cover imagery (magazine-style, full-bleed or dominant image)
- Rich metadata: source domain, reading time estimate, save date, topic tag/category
- Gradient overlay on images for text legibility (Paper-style)
- Strong typographic hierarchy: headline large/bold, metadata small/muted
- Visual differentiation by content type (article vs post vs feed item)
- Subtle depth: card shadows, rounded corners, slight elevation
- Swipe-to-unsave gesture affordance

## ComposeSheet — Design Direction
- Live preview of how post will look (Paper's composer-as-preview)
- Clean, distraction-free writing surface
- Toolbar with contextual actions: photo, GIF, link, mention, hashtag, formatting
- Character count with visual indicator (ring/arc)
- Audience selector (Apple-style segmented control)
- Smooth sheet presentation with spring animation
- Drag handle at top, dismiss on swipe down
- Keyboard-aware layout
