export declare const transitions: {
    readonly chipTap: {
        readonly duration: number;
        readonly ease: [number, number, number, number];
    };
    readonly cardPress: {
        readonly duration: number;
        readonly ease: [number, number, number, number];
    };
    readonly storyCard: {
        readonly duration: number;
        readonly ease: [number, number, number, number];
    };
    readonly sheet: {
        readonly duration: number;
        readonly ease: [number, number, number, number];
    };
    readonly storyEntry: {
        readonly duration: number;
        readonly ease: [number, number, number, number];
    };
    readonly interpolatorToggle: {
        readonly duration: number;
        readonly ease: [number, number, number, number];
    };
    readonly fadeIn: {
        readonly duration: number;
        readonly ease: [number, number, number, number];
    };
    readonly spring: {
        readonly type: "spring";
        readonly stiffness: 400;
        readonly damping: 42;
    };
};
export declare const fadeVariants: {
    hidden: {
        opacity: number;
    };
    visible: {
        opacity: number;
    };
    exit: {
        opacity: number;
    };
};
export declare const slideUpVariants: {
    hidden: {
        opacity: number;
        y: number;
    };
    visible: {
        opacity: number;
        y: number;
    };
    exit: {
        opacity: number;
        y: number;
    };
};
export declare const storyCardVariants: {
    enter: (dir: number) => {
        opacity: number;
        x: number;
        scale: number;
    };
    center: {
        opacity: number;
        x: number;
        scale: number;
    };
    exit: (dir: number) => {
        opacity: number;
        x: number;
        scale: number;
    };
};
export declare const overlayVariants: {
    hidden: {
        opacity: number;
    };
    visible: {
        opacity: number;
    };
    exit: {
        opacity: number;
    };
};
export declare const sheetVariants: {
    hidden: {
        y: string;
    };
    visible: {
        y: number;
    };
    exit: {
        y: string;
    };
};
//# sourceMappingURL=motion.d.ts.map