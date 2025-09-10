// Production environment configuration
export const config = {
  environment: "production",
  debug: false,
  logLevel: "warn",

  // Feature flags for production (conservative rollout)
  features: {
    aiPrecallGeneration: true,
    aiIncallPrompts: true,
    aiPostcallInsights: true,
    intelligentMatching: true,
    liveTranscription: true,
    collaborativeNotes: true,
    vectorSimilarity: true,
  },

  // Rate limits (strict for production)
  rateLimits: {
    transcriptIngestion: {
      windowMs: 60000, // 1 minute
      maxRequests: 300, // 300 requests per minute per user
    },
    noteOperations: {
      windowMs: 60000,
      maxRequests: 200,
    },
    aiGeneration: {
      windowMs: 300000, // 5 minutes
      maxRequests: 20,
    },
  },

  // Batching configuration (optimized for performance)
  batching: {
    transcripts: {
      maxBatchSize: 50,
      maxWaitMs: 250,
    },
    noteOps: {
      maxBatchSize: 10,
      maxWaitMs: 500,
    },
  },
};
