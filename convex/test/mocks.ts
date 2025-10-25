/**
 * Mock External Services for Testing
 *
 * This module provides mocks for external services used in the LinkedUp application,
 * including WorkOS, GetStream, WebRTC, AI providers, and Next.js API routes.
 *
 * Requirements: 3.4, 6.2, 6.3, 7.3
 * Compliance: steering/convex_rules.mdc - Proper testing patterns
 */

import { vi } from "vitest";
import { Id } from "@convex/_generated/dataModel";

/**
 * Mock WorkOS authentication context
 */
export const mockWorkOSAuth = {
  /**
   * Mock user identity for testing
   */
  getUserIdentity: vi.fn().mockImplementation((workosUserId?: string) => ({
    subject: workosUserId || "test-workos-user-1",
    email: "test@example.com",
    name: "Test User",
    org_id: "test-org",
    org_role: "member",
  })),

  /**
   * Mock unauthenticated context
   */
  getUnauthenticatedIdentity: vi.fn().mockReturnValue(null),

  /**
   * Mock admin user identity
   */
  getAdminIdentity: vi.fn().mockReturnValue({
    subject: "test-admin-user",
    email: "admin@example.com",
    name: "Admin User",
    org_id: "test-org",
    org_role: "admin",
  }),

  /**
   * Mock expired token
   */
  getExpiredIdentity: vi.fn().mockImplementation(() => {
    throw new Error("Token expired");
  }),

  /**
   * Mock malformed token
   */
  getMalformedIdentity: vi.fn().mockImplementation(() => {
    throw new Error("Invalid token format");
  }),
};

/**
 * Mock GetStream Video API (Paid Tier)
 */
export const mockGetStreamAPI = {
  /**
   * Mock room creation
   */
  createRoom: vi.fn().mockResolvedValue({
    roomId: "test-getstream-room-id",
    url: "https://getstream.io/video/room/test-room",
    token: "test-getstream-token",
  }),

  /**
   * Mock token generation
   */
  generateToken: vi.fn().mockResolvedValue("test-getstream-token"),

  /**
   * Mock recording start
   */
  startRecording: vi.fn().mockResolvedValue({
    recordingId: "test-recording-id",
    status: "recording",
  }),

  /**
   * Mock recording stop
   */
  stopRecording: vi.fn().mockResolvedValue({
    recordingId: "test-recording-id",
    status: "stopped",
    url: "https://getstream.io/recordings/test-recording",
  }),

  /**
   * Mock webhook payload
   */
  mockWebhookPayload: {
    type: "call.ended",
    call: {
      id: "test-call-id",
      type: "default",
      created_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    },
    user: {
      id: "test-user-id",
      name: "Test User",
    },
  },
};

/**
 * Mock WebRTC Provider (Free Tier)
 */
export const mockWebRTCProvider = {
  /**
   * Mock WebRTC room creation
   */
  createRoom: vi.fn().mockResolvedValue({
    roomId: "webrtc-room-id",
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:turn.example.com:3478",
        username: "test-user",
        credential: "test-credential",
      },
    ],
  }),

  /**
   * Mock session ID generation
   */
  generateSessionId: vi.fn().mockResolvedValue("webrtc-session-id"),

  /**
   * Mock signaling server
   */
  mockSignalingServer: {
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(true),
    sendOffer: vi.fn().mockResolvedValue(true),
    sendAnswer: vi.fn().mockResolvedValue(true),
    sendIceCandidate: vi.fn().mockResolvedValue(true),
  },

  /**
   * Mock peer connection
   */
  mockPeerConnection: {
    createOffer: vi.fn().mockResolvedValue({
      type: "offer",
      sdp: "mock-offer-sdp",
    }),
    createAnswer: vi.fn().mockResolvedValue({
      type: "answer",
      sdp: "mock-answer-sdp",
    }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
  },
};

/**
 * Mock Next.js API Routes
 */
export const mockNextJSAPI = {
  /**
   * Mock fetch for API calls
   */
  fetch: vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    // Mock different responses based on URL
    if (url.includes("/api/auth")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            user: mockWorkOSAuth.getUserIdentity(),
          }),
      });
    }

    if (url.includes("/api/webhooks")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ received: true }),
      });
    }

    // Default success response
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });
  }),

  /**
   * Mock webhook signature verification
   */
  verifyWebhookSignature: vi.fn().mockReturnValue(true),

  /**
   * Mock file upload
   */
  uploadFile: vi.fn().mockResolvedValue({
    fileId: "test-file-id",
    url: "https://example.com/uploads/test-file.jpg",
  }),
};

/**
 * Mock AI Providers
 */
export const mockAIProvider = {
  /**
   * Mock embedding generation
   */
  generateEmbedding: vi.fn().mockResolvedValue([
    0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0,
    // ... more values to simulate a real embedding vector
  ]),

  /**
   * Mock insights generation
   */
  generateInsights: vi.fn().mockResolvedValue({
    summary:
      "This was a productive meeting about project planning and team coordination.",
    actionItems: [
      "Follow up on budget approval by Friday",
      "Schedule design review meeting",
      "Update project timeline",
    ],
    keyTopics: ["budget", "design", "timeline"],
    sentiment: "positive",
    participants: ["John Doe", "Jane Smith"],
  }),

  /**
   * Mock conversation prompts
   */
  generatePrompts: vi
    .fn()
    .mockResolvedValue([
      "What are your main goals for this project?",
      "How can we improve team collaboration?",
      "What challenges are you currently facing?",
    ]),

  /**
   * Mock transcription
   */
  transcribeAudio: vi.fn().mockResolvedValue({
    text: "Hello, this is a test transcription.",
    confidence: 0.95,
    speakerId: "speaker-1",
    startTime: 0,
    endTime: 3000,
  }),

  /**
   * Mock OpenAI API response
   */
  mockOpenAIResponse: {
    choices: [
      {
        message: {
          content: "This is a mock AI response for testing purposes.",
        },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 15,
      total_tokens: 25,
    },
  },
};

/**
 * Mock Database Operations (for unit tests)
 */
export const mockDatabase = {
  /**
   * Mock query results
   */
  mockQueryResult: vi.fn().mockImplementation((tableName: string) => {
    const mockData: Record<string, any[]> = {
      users: [
        {
          _id: "test-user-id-1" as Id<"users">,
          _creationTime: Date.now(),
          workosUserId: "test-workos-user-1",
          email: "test1@example.com",
          displayName: "Test User 1",
          isActive: true,
        },
      ],
      meetings: [
        {
          _id: "test-meeting-id-1" as Id<"meetings">,
          _creationTime: Date.now(),
          organizerId: "test-user-id-1" as Id<"users">,
          title: "Test Meeting",
          state: "scheduled",
        },
      ],
      profiles: [
        {
          _id: "test-profile-id-1" as Id<"profiles">,
          _creationTime: Date.now(),
          userId: "test-user-id-1" as Id<"users">,
          displayName: "Test User 1",
          bio: "Test bio",
        },
      ],
    };

    return mockData[tableName] || [];
  }),

  /**
   * Mock insert operation
   */
  mockInsert: vi.fn().mockImplementation((tableName: string, data: any) => {
    return `test-${tableName}-id-${Date.now()}`;
  }),

  /**
   * Mock update operation
   */
  mockPatch: vi.fn().mockResolvedValue(undefined),

  /**
   * Mock delete operation
   */
  mockDelete: vi.fn().mockResolvedValue(undefined),
};

/**
 * Mock Scheduler for testing scheduled functions
 */
export const mockScheduler = {
  /**
   * Mock runAfter
   */
  runAfter: vi.fn().mockResolvedValue("test-scheduled-job-id"),

  /**
   * Mock runAt
   */
  runAt: vi.fn().mockResolvedValue("test-scheduled-job-id"),

  /**
   * Mock cancel
   */
  cancel: vi.fn().mockResolvedValue(true),
};

/**
 * Mock Storage for file operations
 */
export const mockStorage = {
  /**
   * Mock file upload
   */
  store: vi.fn().mockResolvedValue("test-storage-id" as Id<"_storage">),

  /**
   * Mock file URL generation
   */
  getUrl: vi.fn().mockResolvedValue("https://example.com/files/test-file.jpg"),

  /**
   * Mock file metadata
   */
  getMetadata: vi.fn().mockResolvedValue({
    _id: "test-storage-id" as Id<"_storage">,
    _creationTime: Date.now(),
    contentType: "image/jpeg",
    size: 1024,
    sha256: "test-hash",
  }),

  /**
   * Mock file deletion
   */
  delete: vi.fn().mockResolvedValue(undefined),
};

/**
 * Helper function to reset all mocks
 */
export function resetAllMocks(): void {
  vi.clearAllMocks();

  // Reset WorkOS mocks
  Object.values(mockWorkOSAuth).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });

  // Reset GetStream mocks
  Object.values(mockGetStreamAPI).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });

  // Reset WebRTC mocks
  Object.values(mockWebRTCProvider).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });

  // Reset Next.js API mocks
  Object.values(mockNextJSAPI).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });

  // Reset AI provider mocks
  Object.values(mockAIProvider).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });

  // Reset database mocks
  Object.values(mockDatabase).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });

  // Reset scheduler mocks
  Object.values(mockScheduler).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });

  // Reset storage mocks
  Object.values(mockStorage).forEach((mock) => {
    if (vi.isMockFunction(mock)) {
      mock.mockClear();
    }
  });
}

/**
 * Helper function to setup common test mocks
 */
export function setupTestMocks(): void {
  // Setup global fetch mock
  vi.stubGlobal("fetch", mockNextJSAPI.fetch);

  // Setup console mocks to reduce test noise
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/**
 * Helper function to cleanup test mocks
 */
export function cleanupTestMocks(): void {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
