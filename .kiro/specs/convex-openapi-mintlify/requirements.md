# Requirements Document

## Introduction

This specification defines the requirements for exposing the LinkedUp Convex backend through an OpenAPI specification that can be integrated with Mintlify for comprehensive API documentation. The system will leverage Convex's beta OpenAPI generation capabilities to create a complete, interactive API reference that includes all public queries, mutations, and actions, while maintaining security best practices and providing an excellent developer experience.

## Glossary

- **Convex Backend**: The reactive backend-as-a-service platform hosting LinkedUp's database and serverless functions
- **OpenAPI Specification**: A standard, language-agnostic interface description for HTTP APIs (formerly Swagger)
- **Mintlify**: A modern documentation platform that provides interactive API playgrounds and developer portals
- **Convex Functions API**: HTTP endpoints (`/api/query`, `/api/mutation`, `/api/action`, `/api/run/*`) that allow calling Convex functions via REST
- **Convex Validators**: TypeScript validators (using `v.*` syntax) that define argument and return types for Convex functions
- **HTTP Actions**: Custom HTTP endpoints defined in `convex/http.ts` using the `httpRouter`
- **Deployment URL**: The base URL for the Convex deployment (e.g., `https://your-deployment.convex.cloud`)
- **API Playground**: Interactive documentation feature in Mintlify that allows users to test API endpoints directly
- **Bearer Token**: Authentication token format used for user authentication in Convex Functions API
- **Deploy Key**: Admin-level authentication key used for deployment operations (must not be exposed publicly)

## Requirements

### Requirement 1: OpenAPI Spec Generation

**User Story:** As a developer, I want an automated process to generate an OpenAPI specification from my Convex backend, so that I can maintain accurate API documentation without manual updates.

#### Acceptance Criteria

1. WHEN the generation script is executed, THE System SHALL produce a valid OpenAPI 3.x specification file from the Convex deployment
2. WHEN Convex functions include argument and return validators, THE System SHALL generate accurate type schemas in the OpenAPI specification
3. WHEN the specification is generated, THE System SHALL include all public queries, mutations, and actions defined in the Convex backend
4. WHERE custom HTTP actions exist in `convex/http.ts`, THE System SHALL include these endpoints in the OpenAPI specification
5. WHEN the generation completes, THE System SHALL output the specification to a designated file path within the documentation directory

### Requirement 2: Server Configuration and Security

**User Story:** As a platform administrator, I want the OpenAPI specification to include proper server URLs and security schemes, so that developers can authenticate and connect to the correct deployment environment.

#### Acceptance Criteria

1. WHEN the OpenAPI specification is generated, THE System SHALL replace placeholder server URLs with the actual Convex deployment URL
2. WHEN authentication is required for an endpoint, THE System SHALL define appropriate security schemes in the OpenAPI components section
3. THE System SHALL define a `bearerAuth` security scheme for user-level authentication using JWT tokens
4. THE System SHALL define a `convexDeploy` security scheme for admin-level operations with clear warnings against public exposure
5. WHERE endpoints require authentication, THE System SHALL apply the appropriate security scheme to those operations

### Requirement 3: Request and Response Examples

**User Story:** As an API consumer, I want comprehensive request and response examples in the documentation, so that I can quickly understand how to use each endpoint.

#### Acceptance Criteria

1. WHEN an endpoint is documented, THE System SHALL include at least one request body example showing the required `args` and `format` parameters
2. WHEN an endpoint is documented, THE System SHALL include success response examples with realistic data
3. WHEN an endpoint can return errors, THE System SHALL include error response examples with appropriate error messages
4. WHERE Convex functions use complex validators, THE System SHALL generate examples that demonstrate the expected data structure
5. WHEN examples are provided, THE System SHALL ensure they are valid according to the defined schemas

### Requirement 4: Mintlify Integration

**User Story:** As a documentation maintainer, I want the OpenAPI specification to be properly integrated with Mintlify, so that developers have access to an interactive API playground.

#### Acceptance Criteria

1. WHEN the OpenAPI specification is added to Mintlify, THE System SHALL enable the interactive API Playground feature
2. WHEN users access the API documentation, THE System SHALL display all endpoints organized by functional groups
3. WHERE security schemes are defined, THE System SHALL provide input fields in the Playground for authentication credentials
4. WHEN the Mintlify configuration is updated, THE System SHALL reference the OpenAPI specification file location
5. THE System SHALL organize API endpoints into logical groups (Users, Meetings, Transcripts, Insights, Prompts, Notes)

### Requirement 5: Automation and Maintenance

**User Story:** As a development team member, I want an automated workflow to regenerate and validate the OpenAPI specification, so that documentation stays synchronized with code changes.

#### Acceptance Criteria

1. WHEN the automation script is executed, THE System SHALL regenerate the OpenAPI specification from the latest Convex deployment
2. WHEN the specification is regenerated, THE System SHALL validate the output against OpenAPI 3.x standards
3. WHEN validation fails, THE System SHALL report specific errors with actionable guidance
4. WHERE the specification file already exists, THE System SHALL preserve custom descriptions and examples while updating schemas
5. WHEN the process completes successfully, THE System SHALL output a summary of changes and any warnings

### Requirement 6: Documentation Quality and Completeness

**User Story:** As an API consumer, I want clear, comprehensive documentation for each endpoint, so that I can integrate with the API without confusion.

#### Acceptance Criteria

1. WHEN an endpoint is documented, THE System SHALL include a clear summary and detailed description
2. WHEN parameters are defined, THE System SHALL include descriptions explaining their purpose and constraints
3. WHERE endpoints have specific requirements or limitations, THE System SHALL document these in the endpoint description
4. WHEN response schemas are defined, THE System SHALL include field-level descriptions for all properties
5. THE System SHALL include usage notes for Convex-specific concepts like reactive queries and the `format` parameter

### Requirement 7: Security and Privacy Controls

**User Story:** As a security engineer, I want the OpenAPI specification to exclude sensitive information and clearly mark admin-only endpoints, so that we maintain proper security boundaries.

#### Acceptance Criteria

1. THE System SHALL NOT include internal queries or mutations in the public OpenAPI specification
2. WHEN admin-level endpoints are documented, THE System SHALL clearly mark them with security warnings
3. THE System SHALL NOT include actual API keys, deploy keys, or other credentials in examples
4. WHERE examples require authentication, THE System SHALL use placeholder tokens like `<your-token-here>`
5. WHEN documenting authentication, THE System SHALL include guidance on obtaining and managing credentials securely

### Requirement 8: Convex-Specific Features Documentation

**User Story:** As a developer new to Convex, I want documentation that explains Convex-specific concepts and patterns, so that I can effectively use the API.

#### Acceptance Criteria

1. WHEN the OpenAPI specification is generated, THE System SHALL include descriptions of the Convex Functions API endpoints (`/api/query`, `/api/mutation`, `/api/action`)
2. WHEN documenting the `/api/run/*` endpoint pattern, THE System SHALL explain the function identifier format (using `/` instead of `:`)
3. THE System SHALL document the `format` parameter and its valid values (currently only `json`)
4. WHERE reactive queries are relevant, THE System SHALL explain the difference between HTTP API calls and WebSocket subscriptions
5. WHEN documenting responses, THE System SHALL explain the `logLines` field and its debugging utility

### Requirement 9: Type Safety and Validation

**User Story:** As a TypeScript developer, I want the OpenAPI specification to accurately reflect Convex validators, so that I can generate type-safe client code.

#### Acceptance Criteria

1. WHEN Convex functions use `v.object()` validators, THE System SHALL generate corresponding JSON Schema objects
2. WHEN Convex functions use `v.union()` validators, THE System SHALL generate `oneOf` or `anyOf` schemas as appropriate
3. WHERE Convex functions use `v.id()` validators, THE System SHALL document these as strings with format descriptions
4. WHEN optional fields are defined with `v.optional()`, THE System SHALL mark these fields as not required in the schema
5. THE System SHALL preserve type constraints like `v.number()`, `v.string()`, `v.boolean()` in the generated schemas

### Requirement 10: Deployment Environment Support

**User Story:** As a DevOps engineer, I want the OpenAPI specification to support multiple deployment environments, so that developers can test against staging before production.

#### Acceptance Criteria

1. WHEN the OpenAPI specification is generated, THE System SHALL support multiple server configurations
2. THE System SHALL include server variables for deployment slug customization
3. WHERE environment-specific URLs are needed, THE System SHALL provide clear instructions for configuration
4. WHEN developers access the documentation, THE System SHALL allow selection of the target environment
5. THE System SHALL include descriptions for each server configuration explaining its purpose (development, staging, production)
