# Insights Module

This module implements AI-powered post-call insights generation for Connvo meetings, providing personalized analysis, action items, and connection recommendations with strict privacy controls.

## Features

### Post-Call Insights Generation (Task 8.3)

- **Per-User Analysis**: Generates personalized insights for each meeting participant
- **Privacy Controls**: Strict isolation ensuring users only see their own insights
- **Comprehensive Analysis**: Extracts summaries, action items, and recommendations
- **Connection Recommendations**: Suggests relevant connections based on shared interests and complementary skills
- **Automatic Processing**: Scheduled generation for concluded meetings
- **Retention Policies**: Configurable data retention with automatic cleanup

### Key Components

- **AI Integration**: Structured for future AI provider integration with heuristic fallback
- **Heuristic Analysis**: Robust fallback system for reliable insights generation
- **Privacy by Design**: Per-user data isolation and access controls
- **Scalable Processing**: Batch processing and scheduled generation
- **Rich Recommendations**: Connection, collaboration, and learning suggestions

## API Reference

### Queries

- `getMeetingInsights(meetingId)`: Get user's insights for a specific meeting
- `getUserInsights(limit?, offset?)`: List all insights for the current user
- `getInsightById(insightId)`: Get specific insight with ownership verification
- `getConnectionRecommendations(limit?)`: Get connection recommendations from insights

### Mutations

- `updateInsightsFeedback(insightId, feedback)`: Update user feedback on insights
- `deleteInsights(insightId)`: Delete user's own insights
- `createInsights(...)`: Create insights (internal)
- `batchCreateInsights(insights)`: Create multiple insights (internal)

### Actions

- `generateMeetingInsights(meetingId, forceRegenerate?)`: Generate insights for all participants
- `generateParticipantInsights(userId, meetingId)`: Generate insights for specific participant (internal)

## Implementation Details

### Privacy Controls

The system implements strict privacy controls:

1. **Per-User Isolation**: Each participant gets their own insights document
2. **Access Verification**: All queries verify user ownership or meeting participation
3. **No Cross-User Data**: Users cannot access other participants' insights
4. **Admin Override**: Organization admins can access insights within their org (configurable)

### Insights Generation Process

1. **Meeting Completion**: Triggered when meeting state changes to "concluded"
2. **Data Gathering**: Collects transcripts, notes, prompts, and participant profiles
3. **Analysis**: Processes data using AI or heuristic methods
4. **Personalization**: Generates user-specific insights based on their participation
5. **Storage**: Creates isolated insights documents per participant

### Heuristic Analysis

When AI generation is unavailable, the system uses heuristic analysis:

#### Summary Generation

- Meeting duration and participant count
- Key topics discussed
- User's speaking time and engagement level
- Role-specific context (host vs participant)

#### Action Item Extraction

- Scans transcripts for action-oriented language
- Identifies commitments and next steps
- Extracts structured action items from notes
- Deduplicates and prioritizes items

#### Recommendation Generation

- **Connection Recommendations**: Based on shared interests and complementary skills
- **Collaboration Opportunities**: Identifies potential partnerships
- **Follow-up Actions**: Suggests next steps based on meeting type
- **Learning Resources**: Recommends relevant content based on user goals

### Data Analysis

The system analyzes multiple data sources:

- **Transcripts**: Speaking patterns, topics, sentiment
- **Notes**: Structured information and action items
- **Prompts**: Used prompts and engagement patterns
- **Profiles**: Participant backgrounds and interests
- **Meeting Metadata**: Duration, type, participants

### Confidence Scoring

Recommendations include confidence scores (0.0-1.0):

- **0.8-1.0**: High confidence (shared interests, clear complementary skills)
- **0.6-0.8**: Medium confidence (potential synergies, contextual matches)
- **0.4-0.6**: Low confidence (general recommendations, exploratory)

## Scheduling and Automation

### Automatic Processing

- **Hourly Check**: Processes recently concluded meetings
- **Batch Processing**: Handles multiple meetings efficiently
- **Error Handling**: Robust error handling with retry logic

### Cleanup Jobs

- **Weekly Cleanup**: Removes old insights based on retention policy
- **Configurable Retention**: Default 1 year, configurable per deployment
- **Batch Processing**: Efficient cleanup in manageable batches

## Future Enhancements

### AI Integration (Planned)

The module is structured to support AI providers:

- **OpenAI GPT-4**: For natural language analysis and summary generation
- **Anthropic Claude**: For detailed conversation analysis
- **Custom Models**: For domain-specific insights and recommendations

### Advanced Features (Planned)

- **Sentiment Analysis**: Emotional tone and engagement metrics
- **Topic Modeling**: Advanced topic extraction and trend analysis
- **Predictive Recommendations**: ML-based connection success prediction
- **Multi-language Support**: Insights in participant preferred languages
- **Integration APIs**: Export insights to CRM and productivity tools

## Testing

Run tests with:

```bash
npm test convex/insights/insights.test.ts
```

Tests cover:

- Insights generation for concluded meetings
- Privacy controls and access verification
- Recommendation generation logic
- Cleanup and retention policies
- Error handling and edge cases

## Requirements Compliance

This implementation satisfies:

### Post-Call Features (Task 8.3)

- **Requirement 11.1**: Transcript and notes analysis for topics, decisions, and action items
- **Requirement 11.2**: Per-user insights creation with privacy controls and reactive queries
- **Requirement 11.3**: Connection recommendations and follow-ups with rationale and confidence
- **Requirement 11.4**: Performant, access-controlled queries with transcript segment links
- **Requirement 11.5**: Feedback loop integration with matching analytics and profile preferences

## Security and Privacy

### Data Protection

- **Encryption**: All insights data encrypted at rest and in transit
- **Access Logs**: Comprehensive audit logging for all access
- **Retention**: Configurable retention policies with automatic cleanup
- **Deletion**: User-initiated deletion with complete data removal

### Compliance Features

- **GDPR Ready**: Right to access, rectify, and delete personal insights
- **Audit Trail**: Complete access and modification history
- **Data Minimization**: Only necessary data collected and processed
- **Consent Management**: Clear consent for insights generation and storage
