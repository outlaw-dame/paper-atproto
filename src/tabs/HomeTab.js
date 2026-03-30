import { jsx, jsxs } from "react/jsx-runtime";
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Agent } from "@atproto/api";
import { useQueryClient } from "@tanstack/react-query";
import PostCard from "../components/PostCard.js";
import ContextPost from "../components/ContextPost.js";
import TranslationSettingsSheet from "../components/TranslationSettingsSheet.js";
import { hasFollowingFeedScope } from "../atproto/oauthClient.js";
import { useSessionStore } from "../store/sessionStore.js";
import { useUiStore } from "../store/uiStore.js";
import { useTranslationStore } from "../store/translationStore.js";
import { useFeedCacheStore } from "../store/feedCacheStore.js";
import { mapFeedViewPost, hasDisplayableRecordContent } from "../atproto/mappers.js";
import { atpCall, atpMutate } from "../lib/atproto/client.js";
import { qk } from "../lib/atproto/queries.js";
import { usePostFilterResults } from "../lib/contentFilters/usePostFilterResults.js";
import { warnMatchReasons } from "../lib/contentFilters/presentation.js";
import { usePlatform, getIconBtnTokens } from "../hooks/usePlatform.js";
import { isAtUri } from "../lib/resolver/atproto.js";
import { createVerificationProviders } from "../intelligence/verification/providerFactory.js";
import { InMemoryVerificationCache } from "../intelligence/verification/cache.js";
import { hydrateConversationSession } from "../conversation/sessionAssembler.js";
import { useConversationSessionStore } from "../conversation/sessionStore.js";
import { projectTimelineConversationHint } from "../conversation/projections/timelineProjection.js";
const MODES = ["Following", "Discover", "Feeds"];
const DISCOVER_FEED_URI = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";
const PUBLIC_APPVIEW_SERVICE = "https://public.api.bsky.app";
const LIMITED_SCOPE_BANNER_COPY = "This session does not include Following feed access yet. Discover and public author feeds still work here, but Following needs the Bluesky timeline permission from the HTTPS sign-in.";
function dedupePostsById(items) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}
function Spinner({ small }) {
  const s = small ? 18 : 28;
  return /* @__PURE__ */ jsx("svg", { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "var(--blue)", strokeWidth: 2.5, strokeLinecap: "round", children: /* @__PURE__ */ jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: /* @__PURE__ */ jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.8s", repeatCount: "indefinite" }) }) });
}
function EmptyState({ label }) {
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px", gap: 12 }, children: [
    /* @__PURE__ */ jsx("div", { style: { width: 48, height: 48, borderRadius: "50%", background: "var(--fill-2)", display: "flex", alignItems: "center", justifyContent: "center" }, children: /* @__PURE__ */ jsxs("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", stroke: "var(--label-3)", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", children: [
      /* @__PURE__ */ jsx("path", { d: "M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" }),
      /* @__PURE__ */ jsx("path", { d: "M9 21V12h6v9" })
    ] }) }),
    /* @__PURE__ */ jsx("p", { style: { fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm-size)", lineHeight: "var(--type-body-sm-line)", fontWeight: "var(--type-body-sm-weight)", letterSpacing: "var(--type-body-sm-track)", color: "var(--label-3)", textAlign: "center" }, children: label })
  ] });
}
function HomeTab({ onOpenStory }) {
  const { agent, session, profile } = useSessionStore();
  const { openProfile, openComposeReply } = useUiStore();
  const translationPolicy = useTranslationStore((state) => state.policy);
  const platform = usePlatform();
  const iconTokens = getIconBtnTokens(platform);
  const topModePillHeight = platform.prefersCoarsePointer ? 34 : 30;
  const topModePillPaddingX = platform.prefersCoarsePointer ? 14 : 12;
  const topModePillBadgeSize = platform.prefersCoarsePointer ? 18 : 16;
  const qc = useQueryClient();
  const [mode, setMode] = useState("Following");
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(void 0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [showTranslationSettings, setShowTranslationSettings] = useState(false);
  const [revealedFilteredPosts, setRevealedFilteredPosts] = useState({});
  const conversationSessions = useConversationSessionStore((state) => state.byId);
  const publicReadAgent = useMemo(() => new Agent({ service: PUBLIC_APPVIEW_SERVICE }), []);
  const hasLimitedScopeSession = !hasFollowingFeedScope(session?.scope);
  const visibleModes = useMemo(
    () => MODES.filter((item) => !hasLimitedScopeSession || item !== "Following"),
    [hasLimitedScopeSession]
  );
  const conversationProvidersRef = useRef(createVerificationProviders());
  const conversationCacheRef = useRef(new InMemoryVerificationCache());
  const hydratedSessionRootsRef = useRef(/* @__PURE__ */ new Set());
  const hydrationInFlightRef = useRef(/* @__PURE__ */ new Set());
  const scrollRef = useRef(null);
  const scrollCleanupRef = useRef(null);
  const autoRedirectedLimitedScopeRef = useRef(false);
  const filterResults = usePostFilterResults(posts, "home");
  const timelineHintByPostId = useMemo(() => {
    const hints = {};
    for (const post of posts) {
      const rootUri = post.threadRoot?.id ?? post.id;
      if (!rootUri) continue;
      const sessionState = conversationSessions[rootUri];
      if (!sessionState) continue;
      const hint = projectTimelineConversationHint(sessionState, post.id);
      if (hint) hints[post.id] = hint;
    }
    return hints;
  }, [conversationSessions, posts]);
  useEffect(() => {
    if (!agent || !session || posts.length === 0) return;
    const hydrationAgent = hasLimitedScopeSession ? publicReadAgent : agent;
    const controller = new AbortController();
    const targets = Array.from(new Set(
      posts.map((post) => post.threadRoot?.id ?? post.id).filter((uri) => !!uri && isAtUri(uri))
    )).slice(0, 8);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const backoffMs = (attempt) => {
      const base = Math.min(4e3, 350 * 2 ** attempt);
      return Math.floor(base * (0.75 + Math.random() * 0.5));
    };
    const hydrateWithRetry = async (rootUri) => {
      if (hydratedSessionRootsRef.current.has(rootUri)) return;
      if (hydrationInFlightRef.current.has(rootUri)) return;
      hydrationInFlightRef.current.add(rootUri);
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await hydrateConversationSession({
              sessionId: rootUri,
              rootUri,
              agent: hydrationAgent,
              translationPolicy,
              providers: conversationProvidersRef.current,
              cache: conversationCacheRef.current,
              signal: controller.signal
            });
            hydratedSessionRootsRef.current.add(rootUri);
            return;
          } catch (error2) {
            if (error2 instanceof Error && error2.name === "AbortError") return;
            if (attempt >= 2) return;
            await sleep(backoffMs(attempt));
          }
        }
      } finally {
        hydrationInFlightRef.current.delete(rootUri);
      }
    };
    void Promise.all(targets.map((target) => hydrateWithRetry(target)));
    return () => {
      controller.abort();
    };
  }, [agent, hasLimitedScopeSession, posts, publicReadAgent, session, translationPolicy]);
  useEffect(() => {
    if (!hasLimitedScopeSession) {
      autoRedirectedLimitedScopeRef.current = false;
      return;
    }
    if (autoRedirectedLimitedScopeRef.current || mode !== "Following") {
      return;
    }
    autoRedirectedLimitedScopeRef.current = true;
    setMode("Discover");
  }, [hasLimitedScopeSession, mode]);
  const getFeedCache = useFeedCacheStore((state) => state.getCache);
  const saveFeedCache = useFeedCacheStore((state) => state.saveCache);
  const incrementFeedUnreadCount = useFeedCacheStore((state) => state.incrementUnreadCount);
  const resetFeedUnreadCount = useFeedCacheStore((state) => state.resetUnreadCount);
  const updateFeedScrollPosition = useFeedCacheStore((state) => state.updateScrollPosition);
  const [unreadCounts, setUnreadCounts] = useState({});
  const getTopVisibleIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return 0;
    const cards = el.querySelectorAll("[data-post-index]");
    let topIndex = 0;
    for (const card of cards) {
      const index = parseInt(card.dataset.postIndex ?? "0", 10);
      const rect = card.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (rect.top < elRect.bottom && rect.bottom > elRect.top) {
        topIndex = index;
        break;
      }
    }
    return topIndex;
  }, []);
  useEffect(() => {
    const persistScrollPosition = () => {
      if (!session || !scrollRef.current) return;
      const topIndex = getTopVisibleIndex();
      updateFeedScrollPosition(session.did, mode, scrollRef.current.scrollTop, topIndex);
    };
    if (scrollCleanupRef.current) {
      clearInterval(scrollCleanupRef.current);
    }
    scrollCleanupRef.current = setInterval(persistScrollPosition, 2e3);
    return () => {
      if (scrollCleanupRef.current) {
        clearInterval(scrollCleanupRef.current);
      }
    };
  }, [session, mode, updateFeedScrollPosition, getTopVisibleIndex]);
  useEffect(() => {
    if (!session) return;
    if (hasLimitedScopeSession && mode === "Following") {
      setPosts([]);
      setCursor(void 0);
      setUnreadCounts((prev) => ({ ...prev, Following: 0 }));
      return;
    }
    const cached = getFeedCache(session.did, mode);
    if (cached && cached.posts.length > 0) {
      setPosts(cached.posts);
      setCursor(cached.cursor);
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = cached.scrollPosition;
        }
      }, 50);
      setUnreadCounts((prev) => ({
        ...prev,
        [mode]: cached.unreadCount
      }));
      return;
    }
    setPosts([]);
    setCursor(void 0);
    setUnreadCounts((prev) => ({ ...prev, [mode]: 0 }));
    fetchFeed(mode);
  }, [mode, session, getFeedCache, hasLimitedScopeSession]);
  useEffect(() => {
    if (!session) return;
    saveFeedCache(session.did, mode, {
      posts,
      ...cursor !== void 0 ? { cursor } : {},
      scrollPosition: scrollRef.current?.scrollTop ?? 0,
      topVisibleIndex: getTopVisibleIndex(),
      unreadCount: unreadCounts[mode] ?? 0,
      savedAt: Date.now(),
      isInvalidated: false
    });
  }, [posts, cursor, session, mode, saveFeedCache, unreadCounts, getTopVisibleIndex]);
  const fetchFeed = useCallback(async (m, cur) => {
    if (!session) return;
    const isInitial = !cur;
    if (isInitial) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      if (m === "Following" && hasLimitedScopeSession) {
        setPosts([]);
        setCursor(void 0);
        setError(LIMITED_SCOPE_BANNER_COPY);
        return;
      }
      let feed = [];
      let nextCursor;
      const readAgent = m === "Following" ? agent : publicReadAgent;
      if (m === "Following") {
        const params = { limit: 30, ...cur ? { cursor: cur } : {} };
        const res = await atpCall((s) => agent.getTimeline(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else if (m === "Discover") {
        const params = { feed: DISCOVER_FEED_URI, limit: 30, ...cur ? { cursor: cur } : {} };
        const res = await atpCall((s) => readAgent.app.bsky.feed.getFeed(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      } else {
        const params = { actor: session.did, limit: 30, ...cur ? { cursor: cur } : {} };
        const res = await atpCall((s) => readAgent.getAuthorFeed(params));
        feed = res.data.feed;
        nextCursor = res.data.cursor;
      }
      const mapped = feed.filter((item) => hasDisplayableRecordContent(item.post?.record)).map(mapFeedViewPost);
      if (isInitial) {
        const cached = getFeedCache(session.did, m);
        const newCount = cached ? mapped.length : 0;
        setPosts(dedupePostsById(mapped));
        scrollRef.current?.scrollTo({ top: 0 });
        if (newCount > 0) {
          setUnreadCounts((prev) => ({ ...prev, [m]: newCount }));
          incrementFeedUnreadCount(session.did, m, newCount);
        }
      } else {
        setPosts((prev) => dedupePostsById([...prev, ...mapped]));
      }
      setCursor(nextCursor);
    } catch (err) {
      setError(err?.message ?? "Failed to load feed");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [agent, session, getFeedCache, incrementFeedUnreadCount, hasLimitedScopeSession, publicReadAgent]);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !cursor) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      fetchFeed(mode, cursor);
    }
    if (el.scrollTop < 100 && unreadCounts[mode]) {
      setUnreadCounts((prev) => ({ ...prev, [mode]: 0 }));
      if (session) {
        resetFeedUnreadCount(session.did, mode);
      }
    }
  }, [fetchFeed, mode, cursor, loadingMore, unreadCounts, session, resetFeedUnreadCount]);
  const avatarInitial = profile?.displayName?.[0] ?? profile?.handle?.[0] ?? "Y";
  const handleToggleRepost = useCallback(async (p) => {
    if (!session || !p.cid) return;
    const isReposted = !!p.viewer?.repost;
    setPosts((prev) => prev.map((item) => {
      if (item.id !== p.id) return item;
      const viewer = item.viewer ?? {};
      if (isReposted) {
        const { repost: _repost, ...restViewer } = viewer;
        return {
          ...item,
          repostCount: item.repostCount - 1,
          viewer: restViewer
        };
      }
      return {
        ...item,
        repostCount: item.repostCount + 1,
        viewer: { ...viewer, repost: "pending" }
      };
    }));
    try {
      if (isReposted) {
        await atpMutate(() => agent.deleteRepost(p.viewer.repost));
      } else {
        const res = await atpMutate(() => agent.repost(p.id, p.cid));
        if (res) {
          setPosts((prev) => prev.map((item) => item.id === p.id ? {
            ...item,
            viewer: { ...item.viewer, repost: res.uri }
          } : item));
        }
      }
    } catch {
      setPosts((prev) => prev.map((item) => item.id === p.id ? p : item));
    }
  }, [agent, session]);
  const handleToggleLike = useCallback(async (p) => {
    if (!session || !p.cid) return;
    const isLiked = !!p.viewer?.like;
    setPosts((prev) => prev.map((item) => {
      if (item.id !== p.id) return item;
      const viewer = item.viewer ?? {};
      if (isLiked) {
        const { like: _like, ...restViewer } = viewer;
        return {
          ...item,
          likeCount: item.likeCount - 1,
          viewer: restViewer
        };
      }
      return {
        ...item,
        likeCount: item.likeCount + 1,
        viewer: { ...viewer, like: "pending" }
      };
    }));
    try {
      if (isLiked) {
        await atpMutate(() => agent.deleteLike(p.viewer.like));
      } else {
        const res = await atpMutate(() => agent.like(p.id, p.cid));
        if (res) {
          setPosts((prev) => prev.map((item) => item.id === p.id ? {
            ...item,
            viewer: { ...item.viewer, like: res.uri }
          } : item));
        }
      }
    } catch {
      setPosts((prev) => prev.map((item) => item.id === p.id ? p : item));
    }
  }, [agent, session]);
  const handleBookmark = useCallback(async (p) => {
    setPosts((prev) => prev.map((item) => {
      if (item.id !== p.id) return item;
      const viewer = item.viewer ?? {};
      const isBookmarked = !!viewer.bookmark;
      if (isBookmarked) {
        const { bookmark: _bookmark, ...restViewer } = viewer;
        return {
          ...item,
          bookmarkCount: item.bookmarkCount - 1,
          viewer: restViewer
        };
      }
      return {
        ...item,
        bookmarkCount: item.bookmarkCount + 1,
        viewer: { ...viewer, bookmark: "bookmarked" }
      };
    }));
  }, []);
  const handleMore = useCallback((p) => {
    console.log("More menu for post:", p.id);
  }, []);
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }, children: [
    /* @__PURE__ */ jsxs("div", { style: {
      flexShrink: 0,
      paddingTop: "calc(var(--safe-top) + 12px)",
      background: "transparent"
    }, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "row", alignItems: "center", padding: "0 16px 10px", gap: 12 }, children: [
        /* @__PURE__ */ jsx("div", { style: {
          width: 32,
          height: 32,
          borderRadius: "50%",
          overflow: "hidden",
          background: "var(--blue)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-meta-sm-size)",
          fontWeight: 700,
          flexShrink: 0
        }, children: profile?.avatar ? /* @__PURE__ */ jsx("img", { src: profile.avatar, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } }) : avatarInitial }),
        /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }, children: /* @__PURE__ */ jsx("span", { style: { fontFamily: "var(--font-ui)", fontSize: "var(--type-ui-title-md-size)", lineHeight: "var(--type-ui-title-md-line)", fontWeight: 700, color: "var(--label-1)", letterSpacing: "var(--type-ui-title-md-track)" }, children: "Glimpse" }) }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              "aria-label": "Settings",
              onClick: () => setShowTranslationSettings(true),
              style: {
                width: iconTokens.size,
                height: iconTokens.size,
                borderRadius: "50%",
                background: "var(--fill-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--label-2)",
                border: "none",
                cursor: "pointer"
              },
              children: /* @__PURE__ */ jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: [
                /* @__PURE__ */ jsx("path", { d: "M5 8l6 6" }),
                /* @__PURE__ */ jsx("path", { d: "M4 14l6-6 2-3" }),
                /* @__PURE__ */ jsx("path", { d: "M2 5h12" }),
                /* @__PURE__ */ jsx("path", { d: "M7 2h1" }),
                /* @__PURE__ */ jsx("path", { d: "M22 22l-5-10-5 10" }),
                /* @__PURE__ */ jsx("path", { d: "M14 18h6" })
              ] })
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              "aria-label": "Refresh",
              onClick: () => fetchFeed(mode),
              style: {
                width: iconTokens.size,
                height: iconTokens.size,
                borderRadius: "50%",
                background: "var(--fill-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--label-2)",
                border: "none",
                cursor: "pointer"
              },
              children: /* @__PURE__ */ jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: [
                /* @__PURE__ */ jsx("polyline", { points: "23 4 23 10 17 10" }),
                /* @__PURE__ */ jsx("polyline", { points: "1 20 1 14 7 14" }),
                /* @__PURE__ */ jsx("path", { d: "M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" })
              ] })
            }
          )
        ] })
      ] }),
      hasLimitedScopeSession && /* @__PURE__ */ jsx("div", { style: { padding: "0 16px 10px" }, children: /* @__PURE__ */ jsx(
        "div",
        {
          role: "status",
          style: {
            borderRadius: 16,
            border: "1px solid color-mix(in srgb, var(--orange) 28%, var(--sep))",
            background: "color-mix(in srgb, var(--surface) 88%, var(--orange) 12%)",
            padding: "10px 12px"
          },
          children: /* @__PURE__ */ jsx("p", { style: { fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm-size)", lineHeight: "var(--type-body-sm-line)", fontWeight: 600, letterSpacing: "var(--type-body-sm-track)", color: "var(--label-2)" }, children: LIMITED_SCOPE_BANNER_COPY })
        }
      ) }),
      /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "row", padding: "0 16px 10px", gap: 6 }, children: visibleModes.map((m) => {
        const unreadCount = unreadCounts[m] ?? 0;
        return /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: () => setMode(m),
            style: {
              minHeight: topModePillHeight,
              padding: `0 ${topModePillPaddingX}px`,
              borderRadius: 100,
              fontFamily: "var(--font-ui)",
              fontSize: "14px",
              lineHeight: "18px",
              fontWeight: mode === m ? 600 : 500,
              letterSpacing: "0",
              color: mode === m ? "#fff" : "var(--label-2)",
              background: mode === m ? "var(--blue)" : "var(--fill-2)",
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s",
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6
            },
            children: [
              m,
              unreadCount > 0 && /* @__PURE__ */ jsx("span", { style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: topModePillBadgeSize,
                height: topModePillBadgeSize,
                borderRadius: "50%",
                background: mode === m ? "rgba(255,255,255,0.3)" : "var(--red)",
                color: mode === m ? "#fff" : "#fff",
                fontFamily: "var(--font-ui)",
                fontSize: "10px",
                fontWeight: 700,
                padding: "0 4px"
              }, children: unreadCount > 99 ? "99+" : unreadCount })
            ]
          },
          m
        );
      }) })
    ] }),
    /* @__PURE__ */ jsx(
      "div",
      {
        ref: scrollRef,
        className: "scroll-y",
        style: { flex: 1, padding: "12px 12px 0" },
        onScroll: handleScroll,
        children: /* @__PURE__ */ jsx(AnimatePresence, { mode: "wait", children: loading ? /* @__PURE__ */ jsx(
          motion.div,
          {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            style: { display: "flex", justifyContent: "center", padding: "48px 0" },
            children: /* @__PURE__ */ jsx(Spinner, {})
          },
          "loading"
        ) : error ? /* @__PURE__ */ jsxs(
          motion.div,
          {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            style: { padding: "32px 16px", textAlign: "center" },
            children: [
              /* @__PURE__ */ jsx("p", { style: { fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm-size)", lineHeight: "var(--type-body-sm-line)", fontWeight: "var(--type-body-sm-weight)", letterSpacing: "var(--type-body-sm-track)", color: "var(--red)", marginBottom: 12 }, children: error }),
              /* @__PURE__ */ jsx("button", { onClick: () => fetchFeed(mode), style: { fontFamily: "var(--font-ui)", fontSize: "var(--type-label-md-size)", lineHeight: "var(--type-label-md-line)", fontWeight: 600, letterSpacing: "var(--type-label-md-track)", color: "var(--blue)", background: "none", border: "none", cursor: "pointer" }, children: "Try again" })
            ]
          },
          "error"
        ) : posts.length === 0 ? /* @__PURE__ */ jsx(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, children: /* @__PURE__ */ jsx(EmptyState, { label: mode === "Following" ? "Nothing new from people you follow." : "No posts found." }) }, "empty") : /* @__PURE__ */ jsxs(motion.div, { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 }, style: { paddingBottom: "var(--safe-bottom)" }, children: [
          posts.map((post, i) => {
            const matches = filterResults[post.id] ?? [];
            const isHidden = matches.some((m) => m.action === "hide");
            const isWarned = matches.some((m) => m.action === "warn");
            const isRevealed = !!revealedFilteredPosts[post.id];
            if (isHidden) return null;
            if (isWarned && !isRevealed) {
              const reasons = warnMatchReasons(matches);
              return /* @__PURE__ */ jsxs("div", { style: {
                border: "1px solid var(--stroke-dim)",
                borderRadius: 16,
                padding: "12px 14px",
                marginBottom: 10,
                background: "color-mix(in srgb, var(--surface-card) 90%, var(--orange) 10%)"
              }, children: [
                /* @__PURE__ */ jsx("div", { style: { fontSize: "var(--type-meta-md-size)", lineHeight: "var(--type-meta-md-line)", letterSpacing: "var(--type-meta-md-track)", fontWeight: 700, color: "var(--label-1)", marginBottom: 4 }, children: "Content warning" }),
                /* @__PURE__ */ jsx("div", { style: { fontSize: "var(--type-meta-sm-size)", lineHeight: "var(--type-meta-sm-line)", letterSpacing: "var(--type-meta-sm-track)", color: "var(--label-3)", marginBottom: 10 }, children: "This post may include words or topics you asked to warn about." }),
                /* @__PURE__ */ jsx("div", { style: { fontSize: "var(--type-meta-md-size)", lineHeight: "var(--type-meta-md-line)", letterSpacing: "var(--type-meta-md-track)", fontWeight: 700, color: "var(--label-2)", marginBottom: 8 }, children: "Matches filter:" }),
                /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }, children: reasons.map((entry) => /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, border: "1px solid var(--stroke-dim)", padding: "4px 10px", background: "var(--surface-2)" }, children: [
                  /* @__PURE__ */ jsx("span", { style: { fontSize: "var(--type-meta-sm-size)", lineHeight: "var(--type-meta-sm-line)", color: "var(--label-1)", fontWeight: 700 }, children: entry.phrase }),
                  /* @__PURE__ */ jsx("span", { style: { fontSize: "var(--type-meta-sm-size)", lineHeight: "var(--type-meta-sm-line)", color: "var(--label-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }, children: entry.reason === "exact+semantic" ? "exact + semantic" : entry.reason })
                ] }, `${entry.phrase}:${entry.reason}`)) }),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    onClick: () => setRevealedFilteredPosts((prev) => ({ ...prev, [post.id]: true })),
                    style: { border: "none", background: "transparent", color: "var(--blue)", fontSize: "var(--type-meta-md-size)", lineHeight: "var(--type-meta-md-line)", fontWeight: 700, padding: 0, cursor: "pointer" },
                    children: "Show post"
                  }
                )
              ] }, post.id);
            }
            const storyTitle = post.content.slice(0, 80);
            const openThreadStory = () => {
              onOpenStory({ id: post.id, type: "post", title: storyTitle });
            };
            const openContextTarget = (target) => {
              if (!target?.id) {
                openThreadStory();
                return;
              }
              onOpenStory({
                id: target.id,
                type: "post",
                title: target.content?.slice(0, 80) || storyTitle
              });
            };
            const isReply = !!(post.threadRoot ?? post.replyTo);
            return /* @__PURE__ */ jsxs("div", { "data-post-index": i, children: [
              post.threadRoot && /* @__PURE__ */ jsx(ContextPost, { post: post.threadRoot, type: "thread", onClick: () => openContextTarget(post.threadRoot) }),
              post.replyTo && post.replyTo.id !== post.threadRoot?.id && /* @__PURE__ */ jsx(ContextPost, { post: post.replyTo, type: "reply", onClick: () => openContextTarget(post.replyTo) }),
              /* @__PURE__ */ jsx(
                PostCard,
                {
                  post,
                  onOpenStory,
                  onViewProfile: openProfile,
                  onToggleRepost: handleToggleRepost,
                  onToggleLike: handleToggleLike,
                  onBookmark: handleBookmark,
                  onMore: handleMore,
                  onReply: openComposeReply,
                  index: i,
                  timelineHint: timelineHintByPostId[post.id] ?? void 0,
                  hasContextAbove: isReply,
                  replyingTo: isReply ? void 0 : post.replyTo?.author.handle ?? post.threadRoot?.author.handle
                }
              )
            ] }, post.id);
          }),
          loadingMore && /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "center", padding: "16px 0" }, children: /* @__PURE__ */ jsx(Spinner, { small: true }) }),
          !cursor && posts.length > 0 && /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0 32px", gap: 8 }, children: [
            /* @__PURE__ */ jsx("div", { style: { width: 32, height: 32, borderRadius: "50%", background: "var(--fill-2)", display: "flex", alignItems: "center", justifyContent: "center" }, children: /* @__PURE__ */ jsx("span", { style: { fontSize: 14 }, children: "\u2726" }) }),
            /* @__PURE__ */ jsx("p", { style: { fontSize: 13, color: "var(--label-3)" }, children: "You're all caught up" })
          ] })
        ] }, mode) })
      }
    ),
    /* @__PURE__ */ jsx(TranslationSettingsSheet, { open: showTranslationSettings, onClose: () => setShowTranslationSettings(false) })
  ] });
}
export {
  HomeTab as default
};
