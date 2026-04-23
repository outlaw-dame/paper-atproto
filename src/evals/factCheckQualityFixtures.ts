import type { FactCheckQualityFixture } from './aiQualityRubric';

export const FACT_CHECK_QUALITY_FIXTURES: FactCheckQualityFixture[] = [
  {
    id: 'covid-microchip-claim',
    description: 'Widely fact-checked vaccine microchip misinformation claim.',
    request: {
      text: 'COVID-19 vaccines contain microchips used to track people.',
      languageCode: 'en',
      claims: [
        {
          text: 'COVID-19 vaccines contain microchips used to track people.',
          claimType: 'factual_assertion',
          checkability: 0.95,
        },
      ],
    },
    expectations: {
      shouldMatch: true,
      expectedTerms: ['microchip', 'vaccine'],
      expectedRatingTerms: ['false', 'misleading'],
      minimumHitCount: 1,
      disallowedTerms: ['satire'],
    },
    recordedResult: {
      matched: true,
      model: 'recorded-google-fact-check-shape',
      hits: [
        {
          claimReviewTitle: 'No, COVID-19 vaccines do not contain microchips',
          publisher: 'Recorded Fact Check Publisher',
          textualRating: 'False',
          url: 'https://factcheck.example/covid-vaccine-microchip',
          matchConfidence: 0.92,
        },
      ],
    },
  },
  {
    id: 'eiffel-tower-location',
    description: 'Ordinary true claim should not create noisy fact-check matches.',
    request: {
      text: 'The Eiffel Tower is located in Paris, France.',
      languageCode: 'en',
      claims: [
        {
          text: 'The Eiffel Tower is located in Paris, France.',
          claimType: 'factual_assertion',
          checkability: 0.7,
        },
      ],
    },
    expectations: {
      shouldMatch: false,
      expectedTerms: [],
      minimumHitCount: 0,
      disallowedTerms: ['false', 'hoax', 'misleading'],
    },
    recordedResult: {
      matched: false,
      model: 'recorded-google-fact-check-shape',
      hits: [],
    },
  },
  {
    id: 'moon-landing-hoax-claim',
    description: 'Classic conspiracy claim should retrieve fact-check context when live providers are healthy.',
    request: {
      text: 'The Apollo moon landing was filmed on a Hollywood soundstage.',
      languageCode: 'en',
      claims: [
        {
          text: 'The Apollo moon landing was filmed on a Hollywood soundstage.',
          claimType: 'factual_assertion',
          checkability: 0.9,
        },
      ],
    },
    expectations: {
      shouldMatch: true,
      expectedTerms: ['moon', 'landing'],
      expectedRatingTerms: ['false', 'misleading'],
      minimumHitCount: 1,
      disallowedTerms: ['unrelated'],
    },
    recordedResult: {
      matched: true,
      model: 'recorded-google-fact-check-shape',
      hits: [
        {
          claimReviewTitle: 'Moon landing conspiracy claims are not supported by evidence',
          publisher: 'Recorded Fact Check Publisher',
          textualRating: 'False',
          url: 'https://factcheck.example/moon-landing-hoax',
          matchConfidence: 0.88,
        },
      ],
    },
  },
];
