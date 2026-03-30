/**
 * Global mental health crisis resources and support organizations.
 * Multi-lingual, multi-region crisis hotlines and support services.
 */
export interface MentalHealthResource {
    /** Organization or service name */
    name: string;
    /** Brief description */
    description: string;
    /** Phone number, text code, or contact method */
    contact: string;
    /** 24/7 availability */
    available24h: boolean;
    /** Regions/countries this service covers */
    regions: string[];
    /** Language(s) supported */
    languages: string[];
    /** Contact type: 'phone', 'text', 'chat', 'web' */
    contactType: 'phone' | 'text' | 'chat' | 'web';
    /** URL if available */
    url?: string;
}
/** Global mental health crisis resources */
export declare const MENTAL_HEALTH_RESOURCES: MentalHealthResource[];
/** Get resources for a specific country/region */
export declare function getResourcesByRegion(region: string): MentalHealthResource[];
/** Get resources available in a specific language */
export declare function getResourcesByLanguage(language: string): MentalHealthResource[];
/** Get high-priority universal resources (always relevant) */
export declare function getPriorityResources(): MentalHealthResource[];
//# sourceMappingURL=mentalHealthResources.d.ts.map