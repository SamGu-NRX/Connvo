# Prompts Module

This module implements AI-powered conversation prompts for LinkedUp meetings, including pre-call idea generation and in-call contextual prompts.

## Features

### Pre-Call Idea Generation (Task 8.1)

- **Idempotent Generation**: Uses meetingId-based idempotency keys to prevent duplicate generation
- **Participant Analysis**: Analyzes participant profiles for shared interests and complementary skills
- **AI Integration**: Structured for future AI provider integration with heuristic fallback
- **Relevance Scoring**: Prompts are scored and ranked by relevance

### In-Call Conversation Prompts (Task 8.2)

- **Lull Detection**: Automatically detects conversation lulls and generates contextual prompts
- **Speaking Balance**: Monitors speaking time ratios and suggests inclusive prompts
- **Topic Awareness**: Tracks current topics and generates relevant follow-up questions
- **Real-time Updates**: Reactive subscriptions for instant prompt delivery
- **Context Analysis**: Considers meeting state, participant expertise, and conversation flow

### Prompt Management

- **Feedback Tracking**: Users can mark prompts as used, dismissed, or upvoted
- **Batch Operations**: Efficient batch creation and cleanup of prompts
- **Authorization**: Proper meeting-level access control for all operations

## API Reference

### Queries

- `getPreCallPrompts(meetingId, limit?)`: Get pre-call prompts for a meeting
- `getInCallPrompts(meetingId, limit?)`: Get in-call prompts for a meeting
- `subscribeToInCallPrompts(meetingId)`: Real-time subscription to in-call prompts

### Mutations

- `updatePromptFeedback(promptId, feedback)`: Update user feedback on a prompt
- `createPrompt(...)`: Create a new prompt (internal)
- `batchCreatePrompts(prompts)`: Create multiple prompts (internal)

### Actions

- `generatePreCallIdeas(meetingId, forceRegenerate?)`: Generate pre-call conversation starters
- `detectLullAndGeneratePrompts(meetingId)`: Detect lulls and generate contextual prompts
- `generateContextualPrompts(meetingId, context)`: Generate prompts based on meeting context (internal)

## Implementation Details

### Idempotency

Pre-call idea generation uses idempotency keys in the format:

```
key: "precall_ideas_{meetingId}"
scope: "prompt_generation"
```

This ensures that ideas are only generated once per meeting unless explicitly forced.

### Participant Analysis

The system analyzes participants to find:

- **Shared Interests**: Interests that appear across multiple participants
- **Complementary Skills**: Different expertise areas that could create interesting discussions
- **Experience Levels**: Range of experience for mentorship opportunities
- **Industries**: Cross-industry perspectives
- **Goals**: Common or complementary objectives

### Heuristic Generation

When AI generation is unavailable, the system falls back to heuristic rules:

1. **Shared Interest Prompts**: Questions about common interests and trends
2. **Cross-Industry Prompts**: Questions leveraging different backgrounds
3. **Experience-Based Prompts**: Advice and learning opportunities
4. **Goal-Oriented Prompts**: Questions about objectives and challenges
5. **General Starters**: Universal conversation starters

### Relevance Scoring

Prompts are scored from 0.0 to 1.0 based on:

- Specificity to participant profiles (higher = more specific)
- Likelihood to generate engaging conversation
- Uniqueness compared to generic questions

## Future Enhancements

### AI Integration (Planned)

The module is structured to support AI providers:

- OpenAI GPT-4 for natural language generation
- Anthropic Claude for conversation analysis
- Custom prompts based on meeting context and participant data

### Advanced Features (Planned)

- **Dynamic Relevance**: Real-time relevance adjustment based on usage patterns
- **Personalization**: User-specific prompt preferences and history
- **Multi-language Support**: Prompts in participant preferred languages
- **Topic Modeling**: Advanced analysis of participant expertise areas

## Testing

Run tests with:

```bash
npm test convex/prompts/prompts.test.ts
```

Tests cover:

- Idempotent generation
- Force regeneration
- Feedback tracking
- Authorization
- Heuristic generation logic

## Requirements Compliance

This implementation satisfies:

### Pre-Call Features (Task 8.1)

- **Requirement 9.1**: Participant profile analysis for shared/complementary features
- **Requirement 9.2**: AI provider integration with deterministic, idempotent requests
- **Requirement 9.3**: Prompts collection with type=precall, relevance scoring, tags
- **Requirement 9.4**: Real-time updates via reactive queries
- **Requirement 9.5**: Promotion of precall items to in-call prompts with provenance

### In-Call Features (Task 8.2)

- **Requirement 10.1**: Meeting state tracking for speaking time ratios and lull detection
- **Requirement 10.2**: Contextual prompt generation using recent transcript and participant expertise
- **Requirement 10.3**: Real-time prompt streaming via reactive queries
- **Requirement 10.4**: Prompt feedback tracking (used, dismissed, upvoted) for relevance improvement
- **Requirement 10.5**: Prompt linking to transcript segments and notes for post-call reference
