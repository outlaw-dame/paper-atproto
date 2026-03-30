import React from 'react';
export interface TenorGif {
    id: string;
    title: string;
    media_formats: {
        tinygif: {
            url: string;
            dims: [number, number];
            size: number;
        };
        gif: {
            url: string;
            dims: [number, number];
            size: number;
        };
    };
    url: string;
}
interface GifPickerProps {
    onSelect: (gif: TenorGif) => void;
    onClose: () => void;
}
export declare const GifPicker: React.FC<GifPickerProps>;
export {};
//# sourceMappingURL=GifPicker.d.ts.map