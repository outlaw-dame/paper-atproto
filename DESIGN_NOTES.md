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
