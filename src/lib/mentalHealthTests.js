/**
 * Mental Health Detection Test Cases
 *
 * This file demonstrates the mental health crisis detection functionality
 * integrated into the sentiment analyzer.
 */
import { analyzeSentiment } from '../lib/sentiment';
// Test cases organized by mental health concern type
export const mentalHealthTestCases = {
    'Self-Harm Indicators': [
        'I\'ve been cutting myself again and I don\'t know how to stop',
        'The urge to hurt myself is getting stronger every day',
        'I tried to cut my wrists last night but I\'m scared to try again',
    ],
    'Suicidal Ideation': [
        'I want to die so badly',
        'Everyone would be better off if I was dead',
        'I\'m thinking about suicide and I don\'t think I can stop',
        'I just want to end it all',
    ],
    'Severe Depression': [
        'The emotional pain is unbearable and never stops',
        'I\'m drowning in despair and there\'s no way out',
        'Everything feels empty and numb inside',
        'I\'ve hit rock bottom and I can\'t get up',
    ],
    'Hopelessness About Life': [
        'There\'s no point in living anymore',
        'Nobody cares if I\'m alive or dead',
        'I\'m better off dead because nothing will ever get better',
        'My life is hopeless and there\'s no reason to continue',
    ],
    'Isolation & Loneliness': [
        'I\'m completely alone and no one understands what I\'m going through',
        'I feel totally isolated and nobody cares about me',
        'I have no one - I\'m so alone in this',
    ],
    'Normal Posts (Control)': [
        'Having a great day at the park',
        'Just finished a good book, really enjoyed it',
        'Making pizza for dinner tonight',
        'Looking forward to the weekend',
    ],
};
/**
 * Run all tests and display results
 */
export function runMentalHealthTests() {
    console.group('🚨 Mental Health Detection Tests');
    let totalTests = 0;
    let detectedTests = 0;
    for (const [category, testTexts] of Object.entries(mentalHealthTestCases)) {
        console.group(`\n${category}`);
        const isNegativeCategory = !category.includes('Normal');
        testTexts.forEach(text => {
            const result = analyzeSentiment(text);
            totalTests++;
            const detected = result.hasMentalHealthCrisis;
            const expected = isNegativeCategory;
            const passed = detected === expected;
            if (passed) {
                detectedTests++;
            }
            console.log({
                text: text.substring(0, 50) + '...',
                detected,
                expected,
                passed: passed ? '✓' : '✗',
                category: result.mentalHealthCategory,
            });
        });
        console.groupEnd();
    }
    console.log(`\n📊 Results: ${detectedTests}/${totalTests} tests passed`);
    console.groupEnd();
    return {
        total: totalTests,
        passed: detectedTests,
        passRate: `${Math.round((detectedTests / totalTests) * 100)}%`,
    };
}
/**
 * Test individual mental health concerns
 */
export function testMentalHealthDetection(text) {
    const result = analyzeSentiment(text);
    return {
        text,
        detected: result.hasMentalHealthCrisis,
        category: result.mentalHealthCategory,
        level: result.level,
        signals: result.signals,
    };
}
// Example usage:
// import { runMentalHealthTests, testMentalHealthDetection } from './mentalHealthTests';
// 
// // Run all tests
// runMentalHealthTests();
// 
// // Test individual text
// testMentalHealthDetection('I want to hurt myself');
//# sourceMappingURL=mentalHealthTests.js.map