/**
 * Mental Health Detection Test Cases
 *
 * This file demonstrates the mental health crisis detection functionality
 * integrated into the sentiment analyzer.
 */
export declare const mentalHealthTestCases: {
    'Self-Harm Indicators': string[];
    'Suicidal Ideation': string[];
    'Severe Depression': string[];
    'Hopelessness About Life': string[];
    'Isolation & Loneliness': string[];
    'Normal Posts (Control)': string[];
};
/**
 * Run all tests and display results
 */
export declare function runMentalHealthTests(): {
    total: number;
    passed: number;
    passRate: string;
};
/**
 * Test individual mental health concerns
 */
export declare function testMentalHealthDetection(text: string): {
    text: string;
    detected: boolean;
    category: "isolation" | "self-harm" | "suicidal" | "severe-depression" | "hopelessness" | undefined;
    level: import("../lib/sentiment").SentimentLevel;
    signals: string[];
};
//# sourceMappingURL=mentalHealthTests.d.ts.map