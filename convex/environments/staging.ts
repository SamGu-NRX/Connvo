// Staging environment configuration
export const config = {
  environment: "staging",
  debug: true,
  logLevel: "info",

  // Feature flags for staging (test all features)
  features: {
    aiPrecallGeneration: true,
    aiIncallPrompts: true,
    aiPostcallInsights: true,
    intelligentMatching: true,
    liveTranscription: true,
    collaborativeNotes: true,
    vectorSimilarity: true,
  },

  // Rate limits (production-like but more permissive)
  rateLimits: {
    transcriptIngestion: {
      windowMs: 60000, // 1 minute
      maxRequests: 600, // 600 requests per minute
    },
    noteOperations: {
      windowMs: 60000,
      maxRequests: 300,
    },
    aiGeneration: {
      windowMs: 300000, // 5 minutes
      maxRequests: 30,
    },
  },

  // Batching configuration
  batching: {
    transcripts: {
      maxBatchSize: 20,
      maxWaitMs: 100,
    },
    noteOps: {
      maxBatchSize: 10,
      maxWaitMs: 250,
    },
  },
};
