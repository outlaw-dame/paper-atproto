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

export type CrisisRegion = 'us-canada' | 'australia' | 'uk' | 'europe' | 'global';

export interface LocalizedCrisisResources {
  region: CrisisRegion;
  regionLabel: string;
  emergencyNumber: string;
  urgentIntro: string;
  resources: MentalHealthResource[];
  globalDirectories: MentalHealthResource[];
}

/** Global mental health crisis resources */
export const MENTAL_HEALTH_RESOURCES: MentalHealthResource[] = [
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
export function getResourcesByRegion(region: string): MentalHealthResource[] {
  return MENTAL_HEALTH_RESOURCES.filter(r =>
    r.regions.some(reg => reg.toLowerCase().includes(region.toLowerCase()))
  );
}

/** Get resources available in a specific language */
export function getResourcesByLanguage(language: string): MentalHealthResource[] {
  return MENTAL_HEALTH_RESOURCES.filter(r =>
    r.languages.some(lang => lang.toLowerCase().includes(language.toLowerCase()))
  );
}

/** Get high-priority universal resources (always relevant) */
export function getPriorityResources(): MentalHealthResource[] {
  return [
    MENTAL_HEALTH_RESOURCES.find(r => r.name === '988 Suicide & Crisis Lifeline'),
    MENTAL_HEALTH_RESOURCES.find(r => r.name === 'Crisis Text Line'),
    MENTAL_HEALTH_RESOURCES.find(r => r.name === 'Befrienders Worldwide'),
    MENTAL_HEALTH_RESOURCES.find(r => r.name === 'International Association for Suicide Prevention (IASP)'),
  ].filter((r): r is MentalHealthResource => r !== undefined);
}

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

function normalizeLocaleCountry(locale?: string): string | null {
  if (!locale) return null;
  const parts = locale.replace('_', '-').split('-');
  if (parts.length < 2) return null;
  const candidate = parts[parts.length - 1]?.toUpperCase();
  if (!candidate || candidate.length !== 2) return null;
  return candidate;
}

function detectBrowserCrisisRegion(): CrisisRegion {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const locales = nav
    ? [
        ...(Array.isArray(nav.languages) ? nav.languages : []),
        nav.language,
      ].filter((value): value is string => Boolean(value))
    : [];

  for (const locale of locales) {
    const country = normalizeLocaleCountry(locale);
    if (!country) continue;
    if (country === 'US' || country === 'CA') return 'us-canada';
    if (country === 'AU') return 'australia';
    if (country === 'GB' || country === 'UK') return 'uk';
    if (EU_COUNTRY_CODES.has(country)) return 'europe';
  }

  const timeZone = (() => {
    try {
      return new Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      return '';
    }
  })();

  if (timeZone.startsWith('Australia/')) return 'australia';
  if (timeZone === 'Europe/London') return 'uk';
  if (timeZone.startsWith('Europe/')) return 'europe';
  if (timeZone.startsWith('America/')) return 'us-canada';

  return 'global';
}

function findByName(name: string): MentalHealthResource | undefined {
  return MENTAL_HEALTH_RESOURCES.find((resource) => resource.name === name);
}

export function getLocalizedCrisisResources(): LocalizedCrisisResources {
  const region = detectBrowserCrisisRegion();

  const findAHelpline: MentalHealthResource = {
    name: 'Find A Helpline (Global Directory)',
    description: 'Worldwide directory of free, confidential crisis lines in 175+ countries with phone, text, and chat options by country and need.',
    contact: 'Select your country and concern for live hotline options',
    available24h: true,
    regions: ['Global'],
    languages: ['Multiple'],
    contactType: 'web',
    url: 'https://findahelpline.com/',
  };

  const openCounseling: MentalHealthResource = {
    name: 'OpenCounseling International Suicide Hotlines',
    description: 'Country-by-country emergency and suicide hotline directory used across Europe and worldwide.',
    contact: 'Browse your country listing',
    available24h: true,
    regions: ['Global', 'Europe'],
    languages: ['Multiple'],
    contactType: 'web',
    url: 'https://blog.opencounseling.com/suicide-hotlines/',
  };

  const mentalHealthEurope: MentalHealthResource = {
    name: 'Mental Health Europe Helplines Map',
    description: 'Interactive map of youth-focused and broader support organizations across European countries.',
    contact: 'Use map by country',
    available24h: true,
    regions: ['Europe'],
    languages: ['Multiple'],
    contactType: 'web',
    url: 'https://www.mentalhealtheurope.org/library/youth-helplines/',
  };

  const lifelineAustralia: MentalHealthResource = {
    name: 'Lifeline Australia',
    description: '24/7 crisis support and suicide prevention via phone, text, and online chat.',
    contact: 'Call 13 11 14 or text 0477 13 11 14',
    available24h: true,
    regions: ['Australia'],
    languages: ['English'],
    contactType: 'phone',
    url: 'https://www.lifeline.org.au/',
  };

  const suicideCallBackService: MentalHealthResource = {
    name: 'Suicide Call Back Service (Australia)',
    description: '24/7 phone and online counselling for people feeling suicidal or affected by suicide.',
    contact: 'Call 1300 659 467',
    available24h: true,
    regions: ['Australia'],
    languages: ['English'],
    contactType: 'phone',
    url: 'https://www.healthdirect.gov.au/mental-health-helplines',
  };

  const nhsUrgentMentalHealth: MentalHealthResource = {
    name: 'NHS 111 Urgent Mental Health (UK)',
    description: 'Urgent mental health support line connecting to local crisis teams and urgent assessment.',
    contact: 'Call 111 and select the mental health option',
    available24h: true,
    regions: ['United Kingdom'],
    languages: ['English'],
    contactType: 'phone',
    url: 'https://www.nhs.uk/nhs-services/mental-health-services/where-to-get-urgent-help-for-mental-health/',
  };

  const samaritans = findByName('Samaritans UK') ?? {
    name: 'Samaritans',
    description: 'Free 24/7 support for anyone in emotional distress in the UK and Ireland.',
    contact: 'Call 116 123',
    available24h: true,
    regions: ['United Kingdom'],
    languages: ['English'],
    contactType: 'phone',
    url: 'https://www.mind.org.uk/information-support/guides-to-support-and-services/seeking-help-for-a-mental-health-problem/mental-health-helplines/',
  };

  const shout: MentalHealthResource = {
    name: 'Shout 85258 (UK)',
    description: '24/7 UK text crisis support.',
    contact: 'Text SHOUT to 85258',
    available24h: true,
    regions: ['United Kingdom'],
    languages: ['English'],
    contactType: 'text',
    url: 'https://www.mind.org.uk/information-support/guides-to-support-and-services/seeking-help-for-a-mental-health-problem/mental-health-helplines/',
  };

  const nationalSuicidePreventionUk: MentalHealthResource = {
    name: 'National Suicide Prevention Helpline UK',
    description: 'Listening service for people with suicidal thoughts.',
    contact: 'Call 0800 587 0800',
    available24h: false,
    regions: ['United Kingdom'],
    languages: ['English'],
    contactType: 'phone',
    url: 'https://www.mind.org.uk/information-support/guides-to-support-and-services/seeking-help-for-a-mental-health-problem/mental-health-helplines/',
  };

  const calm: MentalHealthResource = {
    name: 'CALM (UK)',
    description: 'Support for people with suicidal thoughts or affected by suicide.',
    contact: 'Call 0800 58 58 58',
    available24h: false,
    regions: ['United Kingdom'],
    languages: ['English'],
    contactType: 'phone',
    url: 'https://www.mind.org.uk/information-support/guides-to-support-and-services/seeking-help-for-a-mental-health-problem/mental-health-helplines/',
  };

  const crisisTextLine = findByName('Crisis Text Line') ?? {
    name: 'Crisis Text Line',
    description: 'Text-based crisis support. In the US, text HOME to 741741 to reach a trained counselor.',
    contact: 'Text HOME to 741741',
    available24h: true,
    regions: ['United States', 'Canada', 'UK'],
    languages: ['English'],
    contactType: 'text',
    url: 'https://www.crisistextline.org/',
  };

  const lifeline988 = findByName('988 Suicide & Crisis Lifeline') ?? {
    name: '988 Suicide & Crisis Lifeline',
    description: 'Free, confidential support 24/7 by phone or text in the US and Canada.',
    contact: 'Call or text 988',
    available24h: true,
    regions: ['United States', 'Canada'],
    languages: ['English', 'Spanish'],
    contactType: 'phone',
    url: 'https://www.samhsa.gov/',
  };

  const primaryByRegion: Record<CrisisRegion, LocalizedCrisisResources> = {
    'us-canada': {
      region: 'us-canada',
      regionLabel: 'United States / Canada',
      emergencyNumber: '911',
      urgentIntro: 'If this is urgent, call or text 988 now for free 24/7 support.',
      resources: [lifeline988, crisisTextLine],
      globalDirectories: [findAHelpline, openCounseling],
    },
    australia: {
      region: 'australia',
      regionLabel: 'Australia',
      emergencyNumber: '000',
      urgentIntro: 'If life is in danger, call 000 immediately.',
      resources: [lifelineAustralia, suicideCallBackService],
      globalDirectories: [findAHelpline, openCounseling],
    },
    uk: {
      region: 'uk',
      regionLabel: 'United Kingdom',
      emergencyNumber: '999',
      urgentIntro: 'If there is immediate danger to life, call 999 or go to A&E.',
      resources: [nhsUrgentMentalHealth, samaritans, shout, nationalSuicidePreventionUk, calm],
      globalDirectories: [findAHelpline, openCounseling],
    },
    europe: {
      region: 'europe',
      regionLabel: 'Europe / EU',
      emergencyNumber: '112',
      urgentIntro: 'Europe has no single mental-health hotline, so use a trusted country directory for immediate local numbers.',
      resources: [openCounseling, mentalHealthEurope],
      globalDirectories: [findAHelpline, openCounseling],
    },
    global: {
      region: 'global',
      regionLabel: 'Global',
      emergencyNumber: 'Local emergency number',
      urgentIntro: 'There is no single global crisis number, so use a country directory to connect to local support immediately.',
      resources: [findAHelpline, openCounseling],
      globalDirectories: [findAHelpline, openCounseling],
    },
  };

  return primaryByRegion[region];
}
