import type { EndorsementConfig } from '../src/endorsement/types';

/**
 * Example endorsement configuration
 * Copy this file to endorsement.config.ts and customize for your project
 */
export default {
  sources: [
    {
      name: 'official-docs',
      patterns: [
        'docs.mycompany.com/**',
        'github.com/mycompany/docs/**',
      ],
      credibility: 100,
      contexts: ['architecture', 'api', 'best-practices'],
      temporalDecay: 0.05, // 5% decay per year
    },
    {
      name: 'confluence',
      patterns: ['confluence.mycompany.com/**'],
      credibility: 85,
      contexts: ['process', 'onboarding'],
      temporalDecay: 0.1, // 10% decay per year
    },
    {
      name: 'stackoverflow',
      patterns: ['stackoverflow.com/**'],
      credibility: 60,
      contexts: ['debugging', 'troubleshooting'],
      requireVerification: true,
    },
    {
      name: 'random-blogs',
      patterns: ['medium.com/**', 'dev.to/**'],
      credibility: 30,
      requireVerification: true,
    },
  ],
  weights: {
    embedding: 0.6,
    credibility: 0.4,
  },
  feedbackStoragePath: '.crag/feedback',
} as EndorsementConfig;

