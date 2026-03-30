import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPriorityResources } from '../lib/mentalHealthResources.js';
export default function MentalHealthSupportBanner({ category, onDismiss }) {
    const [expandedResourceId, setExpandedResourceId] = useState(null);
    const resources = getPriorityResources();
    const categoryMessages = {
        'self-harm': {
            title: 'We care about your well-being',
            text: 'If you\'re experiencing urges to self-harm, please reach out to someone you trust or contact a support service below. You don\'t have to go through this alone.',
        },
        suicidal: {
            title: 'Your life matters',
            text: 'If you\'re having thoughts of suicide, please reach out for help immediately. Trained counselors are available 24/7 and want to listen.',
        },
        'severe-depression': {
            title: 'We hear you',
            text: 'What you\'re feeling is real, and help is available. Please reach out to a support service or someone you trust. You deserve support.',
        },
        hopelessness: {
            title: 'There is hope',
            text: 'When everything feels hopeless, it can be hard to see that things can change. Please talk to someone — support is just a call or text away.',
        },
        isolation: {
            title: 'You are not alone',
            text: 'Even when isolation feels overwhelming, there are people ready to listen and help. Reach out to any of the resources below — they\'re here for you.',
        },
    };
    const message = category ? categoryMessages[category] : categoryMessages.suicidal;
    return (_jsxs(motion.div, { initial: { opacity: 0, y: -8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.2 }, style: {
            backgroundColor: 'var(--bg-error-subtle, rgba(255, 77, 77, 0.08))',
            borderLeft: '3px solid var(--red)',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '12px',
            fontSize: '13px',
            lineHeight: '1.5',
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600, color: 'var(--red)', marginBottom: '4px' }, children: message.title }), _jsx("div", { style: { color: 'var(--text-secondary)', fontSize: '12px' }, children: message.text })] }), onDismiss && (_jsx("button", { onClick: onDismiss, style: {
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            color: 'var(--text-tertiary)',
                            fontSize: '18px',
                            lineHeight: 1,
                            marginLeft: '8px',
                            flexShrink: 0,
                        }, title: "Dismiss", children: "\u2715" }))] }), _jsxs("div", { style: { marginTop: '12px' }, children: [_jsx("div", { style: { fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }, children: "Support Resources:" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: resources.slice(0, 3).map((resource, idx) => (_jsxs("div", { children: [_jsxs("button", { onClick: () => setExpandedResourceId(expandedResourceId === resource.name ? null : resource.name), style: {
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '8px',
                                        marginLeft: '-8px',
                                        marginRight: '-8px',
                                        borderRadius: '4px',
                                        textAlign: 'left',
                                        transition: 'background-color 0.15s ease',
                                        fontSize: '13px',
                                        color: 'var(--blue)',
                                        fontWeight: '500',
                                        width: '100%',
                                    }, onMouseEnter: e => {
                                        e.currentTarget.style.backgroundColor =
                                            'var(--bg-hover, rgba(0, 0, 0, 0.04))';
                                    }, onMouseLeave: e => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px' }, children: [_jsx("span", { children: resource.name }), _jsx("span", { style: { fontSize: '10px', opacity: 0.6 }, children: expandedResourceId === resource.name ? '▼' : '▶' })] }), _jsx("div", { style: { fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 400 }, children: resource.contact })] }), _jsx(AnimatePresence, { children: expandedResourceId === resource.name && (_jsxs(motion.div, { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: 'auto' }, exit: { opacity: 0, height: 0 }, transition: { duration: 0.2 }, style: {
                                            paddingLeft: '12px',
                                            paddingRight: '8px',
                                            fontSize: '12px',
                                            color: 'var(--text-secondary)',
                                            borderLeft: '2px solid var(--text-tertiary)',
                                            marginLeft: '4px',
                                            overflow: 'hidden',
                                        }, children: [_jsx("p", { style: { margin: '8px 0 4px 0' }, children: resource.description }), _jsxs("p", { style: { margin: '4px 0' }, children: [_jsx("strong", { children: "Available:" }), " 24/7"] }), _jsxs("p", { style: { margin: '4px 0' }, children: [_jsx("strong", { children: "Regions:" }), " ", resource.regions.join(', ')] }), _jsxs("p", { style: { margin: '4px 0' }, children: [_jsx("strong", { children: "Languages:" }), " ", resource.languages.join(', ')] }), resource.url && (_jsx("p", { style: { margin: '8px 0 0 0' }, children: _jsx("a", { href: resource.url, target: "_blank", rel: "noopener noreferrer", style: {
                                                        color: 'var(--blue)',
                                                        textDecoration: 'none',
                                                        fontSize: '12px',
                                                    }, children: "Learn more \u2192" }) }))] })) })] }, `resource-${idx}`))) }), _jsx("div", { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }, children: _jsx("a", { href: "https://www.befrienders.org/members/", target: "_blank", rel: "noopener noreferrer", style: {
                                fontSize: '12px',
                                color: 'var(--blue)',
                                textDecoration: 'none',
                            }, children: "Find more resources by country/region \u2192" }) })] }), _jsx("div", { style: {
                    marginTop: '12px',
                    paddingTop: '10px',
                    borderTop: '1px solid var(--border-subtle)',
                    fontSize: '12px',
                    fontStyle: 'italic',
                    color: 'var(--text-secondary)',
                }, children: "Reaching out is a sign of strength, not weakness. Help is available and people care about you." })] }));
}
//# sourceMappingURL=MentalHealthSupportBanner.js.map