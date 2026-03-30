/**
 * Global mental health crisis resources and support organizations.
 * Multi-lingual, multi-region crisis hotlines and support services.
 */
/** Global mental health crisis resources */
export const MENTAL_HEALTH_RESOURCES = [
    // US Resources
    {
        name: '988 Suicide & Crisis Lifeline',
        description: 'Free, confidential support from trained crisis counselors. Available via call, text, or chat.',
        contact: '988',
        available24h: true,
        regions: ['United States'],
        languages: ['English', 'Spanish', 'more on request'],
        contactType: 'phone',
        url: 'https://988lifeline.org/',
    },
    {
        name: 'Crisis Text Line',
        description: 'Text-based crisis support. Message HOME to connect with trained crisis counselors.',
        contact: 'Text HOME to 741741',
        available24h: true,
        regions: ['United States', 'Canada', 'UK'],
        languages: ['English'],
        contactType: 'text',
        url: 'https://www.crisistextline.org/',
    },
    {
        name: 'SAMHSA National Helpline',
        description: 'Free, confidential treatment referral and information service specializing in mental health and substance abuse.',
        contact: '1-800-662-4357 (1-800-662-HELP)',
        available24h: true,
        regions: ['United States'],
        languages: ['English', 'Spanish'],
        contactType: 'phone',
        url: 'https://www.samhsa.gov/find-help/national-helpline',
    },
    {
        name: 'Disaster Distress Helpline',
        description: 'Crisis counseling for people experiencing emotional distress related to disasters.',
        contact: '1-800-985-5990',
        available24h: true,
        regions: ['United States'],
        languages: ['English', 'Spanish'],
        contactType: 'phone',
        url: 'https://www.samhsa.gov/find-help/disaster-distress-helpline',
    },
    {
        name: 'Veterans Crisis Line',
        description: 'Support from fellow veterans and VA staff, especially for active military and veterans in crisis.',
        contact: '988 then press 1',
        available24h: true,
        regions: ['United States'],
        languages: ['English'],
        contactType: 'phone',
        url: 'https://www.veteranscrisisline.net/',
    },
    // International Resources
    {
        name: 'Befrienders Worldwide',
        description: 'International network of emotional support centers. 1,200,000+ people helped across 193 countries.',
        contact: 'Varies by country',
        available24h: true,
        regions: ['Global', 'Africa', 'Asia', 'Europe', 'Americas'],
        languages: ['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Arabic', 'Russian', 'Hindi', 'Portuguese', 'Vietnamese', 'Thai', 'Swahili', 'Lithuanian', 'Persian', 'Korean'],
        contactType: 'phone',
        url: 'https://www.befrienders.org/members/',
    },
    {
        name: 'International Association for Suicide Prevention (IASP)',
        description: 'Directory of suicide prevention and mental health organizations worldwide.',
        contact: 'Web-based resource directory',
        available24h: true,
        regions: ['Global'],
        languages: ['English', 'Spanish', 'French', 'German', 'Portuguese'],
        contactType: 'web',
        url: 'https://www.iasp.info/resources/Crisis_Centres/',
    },
    // Country/Region Specific
    {
        name: 'eMental Health Australia',
        description: 'Australia\'s leading mental health information and support portal.',
        contact: '1300 364 277 (Lifeline Australia)',
        available24h: true,
        regions: ['Australia'],
        languages: ['English', 'multiple languages available'],
        contactType: 'phone',
        url: 'https://www.ehealth.gov.au/',
    },
    {
        name: 'Samaritans UK',
        description: 'Free, confidential emotional support from trained volunteers.',
        contact: '116 123',
        available24h: true,
        regions: ['United Kingdom'],
        languages: ['English'],
        contactType: 'phone',
        url: 'https://www.samaritans.org/',
    },
    {
        name: 'Telefonseelsorge (Germany)',
        description: 'German telephone counseling service for people in crisis.',
        contact: '0800 1110111 or 0800 1110222',
        available24h: true,
        regions: ['Germany'],
        languages: ['German', 'English'],
        contactType: 'phone',
        url: 'https://www.telefonseelsorge.de/',
    },
    {
        name: 'Suicide Écoute (France)',
        description: 'French suicide prevention and emotional support service.',
        contact: '01 45 39 40 00',
        available24h: true,
        regions: ['France'],
        languages: ['French', 'English'],
        contactType: 'phone',
        url: 'https://www.suicide-ecoute.fr/',
    },
    {
        name: 'Lifeline Aotearoa (New Zealand)',
        description: 'Free, confidential call service for people in distress.',
        contact: '0800 543 354',
        available24h: true,
        regions: ['New Zealand'],
        languages: ['English', 'Te Reo Māori'],
        contactType: 'phone',
        url: 'https://www.lifeline.org.nz/',
    },
    {
        name: 'India Health Response',
        description: 'Mental health support and crisis helpline for India.',
        contact: '+91-22-6156 2007',
        available24h: true,
        regions: ['India'],
        languages: ['English', 'Hindi'],
        contactType: 'phone',
        url: 'https://www.aasra.info/',
    },
];
/** Get resources for a specific country/region */
export function getResourcesByRegion(region) {
    return MENTAL_HEALTH_RESOURCES.filter(r => r.regions.some(reg => reg.toLowerCase().includes(region.toLowerCase())));
}
/** Get resources available in a specific language */
export function getResourcesByLanguage(language) {
    return MENTAL_HEALTH_RESOURCES.filter(r => r.languages.some(lang => lang.toLowerCase().includes(language.toLowerCase())));
}
/** Get high-priority universal resources (always relevant) */
export function getPriorityResources() {
    return [
        MENTAL_HEALTH_RESOURCES.find(r => r.name === '988 Suicide & Crisis Lifeline'),
        MENTAL_HEALTH_RESOURCES.find(r => r.name === 'Crisis Text Line'),
        MENTAL_HEALTH_RESOURCES.find(r => r.name === 'Befrienders Worldwide'),
        MENTAL_HEALTH_RESOURCES.find(r => r.name === 'International Association for Suicide Prevention (IASP)'),
    ].filter((r) => r !== undefined);
}
//# sourceMappingURL=mentalHealthResources.js.map