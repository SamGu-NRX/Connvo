// Local development environment configuration
export const config = {
  environment: "local",
  debug: true,
  logLevel: "debug",

  // Feature flags for local development
  features: {
    aiPrecallGeneration: true,
    aiIncallPrompts: true,
    aiPostcallInsights: true,
    intelligentMatching: true,
    liveTranscription: true,
    collaborativeNotes: true,
    vectorSimilarity: false, // Disabled locally to avoid API costs
  },

  // Rate limits (more permissive for development)
  rateLimits: {
    transcriptIngestion: {
      windowMs: 60000, // 1 minute
      maxRequests: 1000, // 1000 requests per minute
    },
    noteOperations: {
      windowMs: 60000,
      maxRequests: 500,
    },
    aiGeneration: {
      windowMs: 300000, // 5 minutes
      maxRequests: 50,
    },
  },

  // Batching configuration
  batching: {
    transcripts: {
      maxBatchSize: 10,
      maxWaitMs: 100,
    },
    noteOps: {
      maxBatchSize: 5,
      maxWaitMs: 250,
    },
  },
};
