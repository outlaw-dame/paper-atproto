import { jsx as _jsx } from "react/jsx-runtime";
import React, { createContext, useContext, useState } from 'react';
const MiniPlayerContext = createContext(null);
export function MiniPlayerProvider({ children }) {
    const [entry, setEntry] = useState(null);
    return (_jsx(MiniPlayerContext.Provider, { value: {
            entry,
            activate: setEntry,
            dismiss: () => setEntry(null),
        }, children: children }));
}
export function useMiniPlayer() {
    const ctx = useContext(MiniPlayerContext);
    if (!ctx)
        throw new Error('useMiniPlayer must be used within MiniPlayerProvider');
    return ctx;
}
//# sourceMappingURL=MiniPlayerContext.js.map