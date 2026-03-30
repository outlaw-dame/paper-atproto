import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { useDrag } from '@use-gesture/react';
/**
 * A physics-based, gesture-driven view that supports swipe-to-dismiss.
 * Inspired by the fluid navigation of Facebook Paper.
 */
export const GestureView = ({ children, onDismiss }) => {
    const y = useMotionValue(0);
    const opacity = useTransform(y, [0, 300], [1, 0]);
    const scale = useTransform(y, [0, 300], [1, 0.9]);
    const bind = useDrag(({ active, movement: [, my], velocity: [, vy], direction: [, dy], cancel }) => {
        // Only allow downward swipe for dismissal
        if (my < 0) {
            y.set(0);
            return;
        }
        if (active) {
            y.set(my);
        }
        else {
            // If velocity or distance is high enough, dismiss the view
            if (my > 200 || (vy > 0.5 && dy > 0)) {
                onDismiss?.();
            }
            else {
                // Otherwise, snap back to original position
                y.set(0);
            }
        }
    }, {
        from: () => [0, y.get()],
        filterTaps: true,
        bounds: { top: 0 },
        rubberband: true,
    });
    return (_jsx(motion.div, { ...bind(), style: { y, opacity, scale, touchAction: 'none' }, transition: { type: 'spring', stiffness: 300, damping: 30 }, className: "fixed inset-0 z-50 bg-white dark:bg-black overflow-hidden", children: children }));
};
//# sourceMappingURL=GestureView.js.map