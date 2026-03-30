export declare const space: {
    readonly 2: 4;
    readonly 4: 8;
    readonly 6: 12;
    readonly 8: 16;
    readonly 10: 20;
    readonly 12: 24;
    readonly 16: 32;
    readonly 20: 40;
    readonly 24: 48;
    readonly 32: 64;
};
export declare const radius: {
    readonly 8: 8;
    readonly 12: 12;
    readonly 16: 16;
    readonly 18: 18;
    readonly 20: 20;
    readonly 24: 24;
    readonly 28: 28;
    readonly 32: 32;
    readonly full: 999;
};
export declare const stroke: {
    readonly hair: "0.5px";
    readonly thin: "1px";
    readonly strong: "1.5px";
};
export declare const shadow: {
    readonly 0: "none";
    readonly 1: "0 2px 10px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)";
    readonly 2: "0 6px 24px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.05)";
    readonly 3: "0 14px 40px rgba(15,23,42,0.12), 0 6px 16px rgba(15,23,42,0.07)";
};
export declare const shadowDark: {
    readonly 1: "0 4px 20px rgba(0,0,0,0.24)";
    readonly 2: "0 10px 30px rgba(0,0,0,0.34)";
    readonly 3: "0 18px 44px rgba(0,0,0,0.42)";
};
export declare const blur: {
    readonly chrome: "18px";
    readonly sheet: "24px";
    readonly heavy: "32px";
};
export declare const type: {
    readonly displayXl: readonly [40, 44, 700, "-0.03em"];
    readonly displayLg: readonly [34, 38, 700, "-0.025em"];
    readonly titleXl: readonly [28, 32, 700, "-0.02em"];
    readonly titleLg: readonly [24, 29, 700, "-0.015em"];
    readonly titleMd: readonly [20, 24, 600, "-0.01em"];
    readonly titleSm: readonly [18, 22, 600, "-0.005em"];
    readonly bodyLg: readonly [18, 28, 400, "0"];
    readonly bodyMd: readonly [17, 27, 400, "0"];
    readonly bodySm: readonly [15, 22, 400, "0"];
    readonly metaLg: readonly [13, 18, 500, "0.01em"];
    readonly metaSm: readonly [12, 16, 500, "0.02em"];
    readonly chip: readonly [14, 18, 600, "0"];
    readonly buttonLg: readonly [18, 22, 600, "-0.01em"];
    readonly buttonMd: readonly [16, 20, 600, "-0.005em"];
};
export declare const neutralLight: {
    readonly bgBase: "#F6F5F3";
    readonly bgSubtle: "#F0EEEB";
    readonly surface1: "#FFFFFF";
    readonly surface2: "#F7F4F1";
    readonly surface3: "#ECE8E3";
    readonly lineSubtle: "#E2DDD7";
    readonly lineStrong: "#D2CBC3";
    readonly textPrimary: "#151515";
    readonly textSecondary: "#5D5A57";
    readonly textTertiary: "#8D8882";
    readonly textInverse: "#FFFFFF";
};
export declare const neutralDark: {
    readonly bgBase: "#0C0F14";
    readonly bgSubtle: "#11151C";
    readonly surface1: "#161C25";
    readonly surface2: "#1C2430";
    readonly surface3: "#232C39";
    readonly lineSubtle: "rgba(255,255,255,0.08)";
    readonly lineStrong: "rgba(255,255,255,0.14)";
    readonly textPrimary: "#F7F9FC";
    readonly textSecondary: "#C5CEDB";
    readonly textTertiary: "#8E99AA";
    readonly textInverse: "#0B0F15";
};
export declare const accent: {
    readonly primary: "#5B7CFF";
    readonly primaryStrong: "#4668F2";
    readonly primarySoft: "rgba(91,124,255,0.14)";
    readonly blue500: "#3B82F6";
    readonly blue600: "#2563EB";
    readonly indigo500: "#6366F1";
    readonly indigo600: "#4F46E5";
    readonly cyan400: "#67E8F9";
    readonly cyan500: "#22D3EE";
};
export declare const discovery: {
    readonly bgBase: "#070B12";
    readonly bgAtmosphere: "radial-gradient(circle at 20% 20%, rgba(69,102,242,0.22), transparent 32%),\n                  radial-gradient(circle at 80% 10%, rgba(34,211,238,0.12), transparent 28%),\n                  linear-gradient(180deg, #0A0E16 0%, #070B12 100%)";
    readonly surfaceCard: "#121824";
    readonly surfaceCard2: "#171F2C";
    readonly surfaceFocus: "#1C2636";
    readonly lineSubtle: "rgba(174,196,255,0.10)";
    readonly lineFocus: "rgba(122,161,255,0.28)";
    readonly textPrimary: "#F8FBFF";
    readonly textSecondary: "#C9D5E7";
    readonly textTertiary: "#93A3BC";
    readonly glowBlue: "rgba(91,124,255,0.35)";
    readonly glowCyan: "rgba(34,211,238,0.18)";
    readonly glowIndigo: "rgba(99,102,241,0.20)";
};
export declare const discussion: {
    readonly bgBase: "var(--bg)";
    readonly bgSubtle: "var(--surface-2)";
    readonly surfaceCard: "var(--surface)";
    readonly surfaceCard2: "var(--surface-2)";
    readonly surfaceNested: "var(--surface-3)";
    readonly lineSubtle: "var(--sep)";
    readonly lineStrong: "var(--sep-opaque)";
    readonly textPrimary: "var(--label-1)";
    readonly textSecondary: "var(--label-2)";
    readonly textTertiary: "var(--label-3)";
    readonly heroBg: "#070707";
    readonly heroText: "#FFFFFF";
    readonly heroSubtext: "rgba(255,255,255,0.82)";
    readonly heroMeta: "rgba(255,255,255,0.55)";
    readonly heroLine: "rgba(255,255,255,0.12)";
};
export declare const intel: {
    readonly surfaceLight: "#173B70";
    readonly surfaceLight2: "#1B447F";
    readonly surfaceDark: "#14263E";
    readonly surfaceDark2: "#18304D";
    readonly textPrimary: "#F7FBFF";
    readonly textSecondary: "rgba(247,251,255,0.82)";
    readonly textMeta: "rgba(247,251,255,0.62)";
    readonly accentCoral: "#FF8A67";
    readonly accentCyan: "#7CE9FF";
    readonly accentLime: "#D7E97A";
};
export declare const signal: {
    readonly clarifyingBg: "#D4A017";
    readonly clarifyingText: "#FFFFFF";
    readonly newBg: "#1A7A5E";
    readonly newText: "#FFFFFF";
    readonly provocativeBg: "#C0392B";
    readonly provocativeText: "#FFFFFF";
    readonly sourceBg: "#2563EB";
    readonly sourceText: "#FFFFFF";
    readonly counterpointBg: "#7C3AED";
    readonly counterpointText: "#FFFFFF";
    readonly opinionBg: "#B5179E";
    readonly opinionText: "#FFFFFF";
    readonly repetitiveBg: "#9CA3AF";
    readonly repetitiveText: "#FFFFFF";
    readonly fbClarifyingBg: "#FEF9C3";
    readonly fbClarifyingText: "#78610A";
    readonly fbNewBg: "#D1FAE5";
    readonly fbNewText: "#065F46";
    readonly fbProvocativeBg: "#FEE2E2";
    readonly fbProvocativeText: "#991B1B";
    readonly fbSourceBg: "#DBEAFE";
    readonly fbSourceText: "#1E40AF";
};
export declare const motion: {
    readonly fast: 140;
    readonly base: 220;
    readonly slow: 320;
    readonly xslow: 420;
};
export declare const ease: {
    readonly standard: [number, number, number, number];
    readonly decel: [number, number, number, number];
    readonly accel: [number, number, number, number];
    readonly soft: [number, number, number, number];
};
//# sourceMappingURL=foundation.d.ts.map