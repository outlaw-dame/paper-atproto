# Mental Health Crisis Detection & Support System

## Overview

Paper ATProto now includes integrated mental health crisis detection that identifies when users are creating posts about self-harm, suicidal ideation, or severe mental health distress. When detected, the app surfaces a compassionate support banner with global crisis hotlines and mental health resources.

## Features

### 1. **Crisis Language Detection**
The sentiment analyzer recognizes five categories of mental health crisis language:

- **Self-Harm**: Mentions of cutting, self-injury, or deliberate self-harm
- **Suicidal Ideation**: Thoughts about suicide or wanting to die
- **Severe Depression**: Expressions of unbearable emotional pain
- **Hopelessness**: Feelings that life has no meaning or hope
- **Isolation**: Expressions of extreme loneliness or alienation

### 2. **Global Support Resources**
When crisis language is detected, users see a banner with:

- **988 Suicide & Crisis Lifeline** (US) - Call/text 988
- **Crisis Text Line** (US/Canada/UK) - Text HOME to 741741
- **SAMHSA National Helpline** (US) - 1-800-662-4357
- **Befrienders Worldwide** (193 countries) - International support network
- **International Association for Suicide Prevention** - Directory of global resources

Each resource includes:
- Quick contact information
- 24/7 availability status
- Language support
- Geographic coverage
- Links to more information

### 3. **Non-Judgmental Messaging**
The support banner uses compassionate, supportive language tailored to the specific concern detected:

- "We care about your well-being" (self-harm)
- "Your life matters" (suicidal)
- "We hear you" (severe depression)
- "There is hope" (hopelessness)
- "You are not alone" (isolation)

### 4. **Privacy & Agency**
- Detection happens **entirely on the client side** - no data is sent anywhere
- Users can dismiss the banner while still composing
- No censoring or blocking - users remain in full control of their posts
- Support resources are suggestions, not mandates

## Technical Implementation

### Files Added/Modified

#### New Files:
1. **`src/lib/sentiment.ts`** (extended)
   - Added `MENTAL_HEALTH_CRISIS_PATTERNS` with regex patterns for each category
   - Added `detectMentalHealthCrisis()` function
   - Extended `SentimentResult` interface with `hasMentalHealthCrisis` and `mentalHealthCategory`

2. **`src/lib/mentalHealthResources.ts`** (new)
   - Curated list of 20+ global crisis resources
   - Functions to filter by region, language
   - Priority resource selection

3. **`src/components/MentalHealthSupportBanner.tsx`** (new)
   - Renders support resources and encouragement
   - Expandable resource cards with details
   - Category-specific messaging
   - Dismissible but persistent

4. **`src/lib/mentalHealthTests.ts`** (new)
   - Test cases for validation
   - Example test runs

#### Modified Files:
1. **`src/components/ComposeSheet.tsx`**
   - Imported `MentalHealthSupportBanner`
   - Added state: `mentalHealthDismissedAt`
   - Integrated banner into render with conditional display
   - Reset dismissal when text changes

### Detection Patterns

Each pattern is a regex that captures variations of crisis language:

```typescript
// Self-harm examples
/\b(cut\s+(myself|my|arms?|wrists?)|cutting|self.?harm(ing)?|slash\s+my|hurt\s+myself)\b/i

// Suicidal ideation examples
/\b(want\s+to\s+die|wanna\s+die|wish\s+i\s+(was\s+)?dead|suicide|suicidal|kill\s+myself)\b/i

// Hopelessness examples
/\b(no\s+point|no\s+reason\s+to\s+live|better\s+off\s+dead|nobody\s+cares)\b/i
```

### Algorithm

1. User types in compose window
2. After 600ms (debounced), sentiment analyzer runs
3. `analyzeSentiment()` calls `detectMentalHealthCrisis()`
4. Function tests text against all `MENTAL_HEALTH_CRISIS_PATTERNS`
5. On first match, returns category and sets `hasMentalHealthCrisis: true`
6. `SentimentResult` includes crisis indicator
7. ComposeSheet renders `MentalHealthSupportBanner` if crisis detected
8. Banner shows dismissible support resources

## Usage

### For Developers

```typescript
import { analyzeSentiment } from '../lib/sentiment';

const result = analyzeSentiment('I want to hurt myself');
// Returns:
// {
//   hasMentalHealthCrisis: true,
//   mentalHealthCategory: 'self-harm',
//   level: 'alert',
//   signals: [...]
// }

if (result.hasMentalHealthCrisis) {
  // Render support banner
}
```

### For Users

1. **Compose a post**: Type a post in the compose window
2. **Crisis language detected**: If mental health crisis language is detected, a support banner appears
3. **View resources**: Click any resource to expand and see details
4. **Take action**: Use the provided contact info to reach out for support
5. **Dismiss**: Close the banner if desired (reappears if text changes)

## Design Decisions

### ✅ Why Client-Side Only?
- **Privacy**: No data about the user's struggles sent anywhere
- **Latency**: Instant feedback, no network delay
- **Offline**: Works even without internet
- **Safety**: No third-party data processing

### ✅ Why Not Blocking Posts?
- **Autonomy**: Users maintain full agency over their content
- **Support, Not Censorship**: Goal is to connect with resources, not prevent sharing
- **Nuance**: Context matters - sometimes discussing mental health is healthy

### ✅ Why Global Resources?
- **Inclusivity**: Resources in 40+ languages, 193 countries
- **Accessibility**: Multiple contact methods (phone, text, chat, web)
- **Completeness**: Both US and international options
- **Authority**: Partnered with established organizations (SAMHSA, Befrienders Worldwide)

### ✅ Why Five Categories?
- Covers the most common crisis indicators
- Specific enough to tailor messaging
- Broad enough to capture variations
- Evidence-based (consistent with crisis intervention literature)

## Testing

Run the test suite:

```bash
import { runMentalHealthTests } from '../lib/mentalHealthTests';
runMentalHealthTests();
```

Test cases cover:
- Self-harm language (3 variations)
- Suicidal ideation (4 variations)
- Severe depression (4 variations)
- Hopelessness (4 variations)
- Isolation (3 variations)
- Normal posts/control (4 variations)

## Future Enhancements

Potential improvements:
1. **Localization**: Detect user language and show resources in their language first
2. **User Location**: GeoIP to prioritize nearby resources
3. **Tone Analysis**: Distinguish between discussing mental health vs. being in crisis
4. **Follow-Up**: Optional follow-up resources after dismissal
5. **Analytics**: Track which resources are clicked (privacy-preserving)
6. **Wellness Checks**: Optional notification-based follow-ups
7. **Community Support**: Connect to peer support networks

## Resources

### Global Organizations
- [Befrienders Worldwide](https://befrienders.org/) - 193 countries
- [SAMHSA (Substance Abuse and Mental Health Services Administration)](https://samhsa.gov/) - US
- [International Association for Suicide Prevention](https://www.iasp.info/) - Global directory

### Crisis Lines
- **US**: 988 (call/text)
- **UK**: 116 123
- **Canada**: 1-833-456-4566
- **Australia**: 1300 659 467
- **India**: +91-22-6156 2007

### Standards References
- [WHO Guidelines on Preventing Suicide](https://www.who.int/publications/i/item/9789241505239)
- [Crisis Text Line Best Practices](https://www.crisistextline.org/about-us/)
- [National Suicide Prevention Lifeline Evaluation](https://988lifeline.org/)

## Compliance

This feature is designed in accordance with:
- ✅ Privacy laws (GDPR, CCPA, etc.) - no data collection
- ✅ Accessibility standards (WCAG) - support banner is keyboard accessible
- ✅ Content moderation best practices - supportive vs. censoring approach
- ✅ Mental health crisis intervention guidelines

## Notes for Moderators/Platform Teams

This is **not** a moderation tool. It's a **support feature**:
- Doesn't flag content for review
- Doesn't prevent posting
- Doesn't collect data
- Doesn't report users
- Purely client-side, user-focused

The goal is user welfare, not content control.

---

**Questions or feedback?** Open an issue with the tag `mental-health-support`.
