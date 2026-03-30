export declare const searchHeroField: {
    readonly height: 58;
    readonly radius: 999;
    readonly paddingX: 20;
    readonly iconGap: 12;
    readonly shadow: "0 4px 20px rgba(0,0,0,0.24)";
    readonly discovery: {
        readonly bg: "rgba(18,24,36,0.86)";
        readonly border: "rgba(124,163,255,0.45)";
        readonly text: "#F8FBFF";
        readonly placeholder: "#AFC1DA";
        readonly icon: "#67E8F9";
    };
    readonly focus: {
        readonly border: "#8EC8FF";
        readonly glow: "0 0 0 4px rgba(103,232,249,0.10)";
    };
};
export declare const storyProgress: {
    readonly height: 8;
    readonly segmentGap: 4;
    readonly radius: 999;
    readonly track: "rgba(255,255,255,0.12)";
    readonly segment: "rgba(255,255,255,0.20)";
    readonly active: "#F8FBFF";
    readonly complete: "rgba(248,251,255,0.72)";
    readonly currentGlow: "0 0 10px rgba(124,233,255,0.20)";
};
export declare const overviewCard: {
    readonly radius: 32;
    readonly padding: 20;
    readonly bg: "#1C2636";
    readonly shadow: "0 10px 30px rgba(0,0,0,0.34)";
    readonly mediaRadius: 24;
    readonly mediaHeight: 240;
    readonly gap: 16;
    readonly synopsisChip: {
        readonly bg: "rgba(9,18,30,0.58)";
        readonly border: "rgba(124,233,255,0.16)";
        readonly text: "#B8F3FF";
    };
    readonly sourceStrip: {
        readonly bg: "rgba(8,13,21,0.56)";
        readonly text: "#C9D5E7";
        readonly iconTint: "#D9E6F8";
    };
};
export declare const bottomQueryDock: {
    readonly height: 56;
    readonly radius: 999;
    readonly paddingX: 16;
    readonly shadow: "0 10px 30px rgba(0,0,0,0.34)";
    readonly bg: "rgba(12,18,28,0.82)";
    readonly border: "rgba(255,255,255,0.08)";
    readonly blur: "24px";
    readonly text: "#F8FBFF";
    readonly placeholder: "#93A3BC";
    readonly actionBg: "#5B7CFF";
    readonly actionFg: "#FFFFFF";
};
export declare const promptHero: {
    readonly radius: 28;
    readonly padding: 24;
    readonly bg: "#070707";
    readonly text: "#FFFFFF";
    readonly subtext: "rgba(255,255,255,0.82)";
    readonly meta: "rgba(255,255,255,0.55)";
    readonly line: "rgba(255,255,255,0.12)";
    readonly shadow: "0 6px 24px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.05)";
    readonly cta: {
        readonly height: 56;
        readonly radius: 20;
        readonly bg: "#F6F5F3";
        readonly text: "#181818";
        readonly icon: "#3B3B3B";
    };
};
export declare const interpolator: {
    readonly radius: 28;
    readonly padding: 24;
    readonly shadow: "0 6px 24px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.05)";
    readonly discussion: {
        readonly bg: "#173B70";
        readonly bg2: "#1B447F";
    };
    readonly discovery: {
        readonly bg: "#14263E";
        readonly bg2: "#18304D";
    };
    readonly text: {
        readonly primary: "#F7FBFF";
        readonly secondary: "rgba(247,251,255,0.82)";
        readonly meta: "rgba(247,251,255,0.62)";
    };
    readonly timestamp: "#FF8A67";
    readonly glyph: "#E6F3FF";
    readonly evidenceChip: {
        readonly bg: "rgba(255,255,255,0.10)";
        readonly border: "rgba(255,255,255,0.10)";
        readonly text: "#EAF4FF";
    };
    readonly link: {
        readonly color: "#7CE9FF";
        readonly hover: "#C8F5FF";
    };
    readonly collapsed: {
        readonly maxHeight: 220;
    };
    readonly expanded: {
        readonly maxHeight: 360;
    };
};
export declare const contribution: {
    readonly radius: 24;
    readonly padding: 20;
    readonly gap: 16;
    readonly shadow: "0 2px 10px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)";
    readonly bg: "var(--surface)";
    readonly bgAlt: "var(--surface-2)";
    readonly bgNested: "var(--surface-3)";
    readonly text: {
        readonly primary: "var(--label-1)";
        readonly secondary: "var(--label-2)";
        readonly meta: "var(--label-3)";
    };
    readonly line: "var(--sep)";
    readonly avatar: {
        readonly size: 40;
    };
    readonly rolePill: {
        readonly height: 32;
        readonly paddingX: 12;
    };
    readonly featured: {
        readonly shadow: "0 6px 24px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.05)";
        readonly border: "1px solid #E6E0D8";
        readonly bg: "#FCFBF9";
    };
};
export declare const rolePill: {
    readonly height: 28;
    readonly paddingX: 12;
    readonly radius: 999;
    readonly clarifying: {
        readonly bg: "#D4A017";
        readonly text: "#FFFFFF";
    };
    readonly new_information: {
        readonly bg: "#1A7A5E";
        readonly text: "#FFFFFF";
    };
    readonly provocative: {
        readonly bg: "#C0392B";
        readonly text: "#FFFFFF";
    };
    readonly direct_response: {
        readonly bg: "#2563EB";
        readonly text: "#FFFFFF";
    };
    readonly useful_counterpoint: {
        readonly bg: "#7C3AED";
        readonly text: "#FFFFFF";
    };
    readonly story_worthy: {
        readonly bg: "#B5179E";
        readonly text: "#FFFFFF";
    };
    readonly repetitive: {
        readonly bg: "#9CA3AF";
        readonly text: "#FFFFFF";
    };
    readonly unknown: {
        readonly bg: "#E5E7EB";
        readonly text: "#374151";
    };
};
export declare const signalChip: {
    readonly height: 32;
    readonly paddingX: 12;
    readonly radius: 999;
    readonly clarifying: {
        readonly bg: "#FEF9C3";
        readonly text: "#78610A";
    };
    readonly new: {
        readonly bg: "#D1FAE5";
        readonly text: "#065F46";
    };
    readonly provocative: {
        readonly bg: "#FEE2E2";
        readonly text: "#991B1B";
    };
    readonly source: {
        readonly bg: "#DBEAFE";
        readonly text: "#1E40AF";
    };
    readonly counterpoint: {
        readonly bg: "#7C3AED";
        readonly text: "#FFFFFF";
    };
};
export declare const nestedContribution: {
    readonly radius: 20;
    readonly padding: 16;
    readonly bg: "var(--surface-3)";
    readonly line: "var(--sep)";
    readonly shadow: "none";
    readonly inset: 16;
    readonly gap: 12;
};
export declare const promptComposer: {
    readonly bg: "var(--bg)";
    readonly text: {
        readonly primary: "var(--label-1)";
        readonly secondary: "var(--label-2)";
    };
    readonly line: "var(--sep-opaque)";
    readonly fieldGap: 24;
    readonly fieldUnderline: "1px solid #BFB7AF";
    readonly topicChip: {
        readonly bg: "#E7E4E0";
        readonly text: "#4E4A45";
        readonly selectedBg: "#DCE7FF";
        readonly selectedText: "#21417D";
    };
    readonly cta: {
        readonly height: 56;
        readonly radius: 20;
        readonly bg: "#5B7CFF";
        readonly text: "#FFFFFF";
        readonly shadow: "0 6px 24px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.05)";
    };
};
export declare const entitySheet: {
    readonly radiusTop: 32;
    readonly padding: 24;
    readonly shadow: "0 14px 40px rgba(15,23,42,0.12), 0 6px 16px rgba(15,23,42,0.07)";
    readonly blur: "24px";
    readonly discovery: {
        readonly bg: "rgba(17,21,28,0.94)";
        readonly text: "#F8FBFF";
        readonly subtext: "#C9D5E7";
    };
    readonly discussion: {
        readonly bg: "rgba(248,246,243,0.96)";
        readonly text: "var(--label-1)";
        readonly subtext: "var(--label-2)";
    };
};
export declare const quickFilterChip: {
    readonly height: 32;
    readonly paddingX: 13;
    readonly radius: 999;
    readonly gap: 6;
    readonly discovery: {
        readonly bg: "rgba(255,255,255,0.07)";
        readonly border: "rgba(255,255,255,0.12)";
        readonly text: "#C9D5E7";
        readonly activeBg: "#5B7CFF";
        readonly activeText: "#FFFFFF";
    };
};
export declare const featuredStoryCard: {
    readonly radius: 28;
    readonly mediaHeight: 160;
    readonly padding: 20;
    readonly shadow: "0 10px 30px rgba(0,0,0,0.34)";
    readonly bg: "#121824";
};
export declare const trendingTopicCard: {
    readonly width: 160;
    readonly height: 72;
    readonly radius: 24;
    readonly padding: 16;
    readonly bg: "#171F2C";
};
export declare const liveClusterCard: {
    readonly height: 104;
    readonly radius: 24;
    readonly padding: 20;
    readonly bg: "#121824";
    readonly shadow: "0 4px 20px rgba(0,0,0,0.24)";
};
//# sourceMappingURL=components.d.ts.map