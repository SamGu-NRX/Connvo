# Connvo Deployment Guide

This guide covers deployment procedures for the Connvo Convex backend across different environments.

## Prerequisites

- Node.js 18+
- npm or yarn
- Convex CLI (`npm install -g convex`)
- Access to environment-specific secrets

## Environment Setup

### Local Development

1. **Initial Setup**

   ```bash
   # Run the setup script
   ./scripts/setup-dev.sh

   # Or manually:
   npm install
   cp .env.example .env
   # Update .env with your values
   ```

2. **Start Development Servers**

   ```bash
   # Terminal 1: Start Convex dev server
   npm run convex:dev

   # Terminal 2: Start Next.js dev server
   npm run dev
   ```

3. **Environment Variables**

   ```env
   # Required for local development
   WORKOS_CLIENT_ID=client_your_client_id_here
   WORKOS_API_KEY=sk_test_your_api_key_here
   WORKOS_COOKIE_PASSWORD=your_secure_password_here_must_be_at_least_32_characters_long
   NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback

   # Set by Convex CLI
   CONVEX_DEPLOY_KEY=your_convex_deploy_key_here
   NEXT_PUBLIC_CONVEX_URL=https://your-convex-url.convex.cloud
   ```

### Staging Environment

1. **Manual Deployment**

   ```bash
   ./scripts/deploy-staging.sh
   ```

2. **Environment Variables**

   ```env
   NODE_ENV=staging
   WORKOS_CLIENT_ID=client_staging_id_here
   WORKOS_API_KEY=sk_test_staging_key_here
   WORKOS_COOKIE_PASSWORD=staging_secure_password_32_chars_minimum
   NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://staging.Connvo.com/callback
   CONVEX_DEPLOY_KEY=staging_convex_deploy_key
   NEXT_PUBLIC_CONVEX_URL=https://staging-convex-url.convex.cloud
   ```

3. **Automatic Deployment**
   - Pushes to `develop` branch trigger automatic staging deployment
   - Requires GitHub secrets to be configured

### Production Environment

1. **Manual Deployment**

   ```bash
   ./scripts/deploy-production.sh
   ```

2. **Environment Variables**

   ```env
   NODE_ENV=production
   WORKOS_CLIENT_ID=client_production_id_here
   WORKOS_API_KEY=sk_live_production_key_here
   WORKOS_COOKIE_PASSWORD=production_secure_password_32_chars_minimum
   NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://Connvo.com/callback
   CONVEX_DEPLOY_KEY=production_convex_deploy_key
   NEXT_PUBLIC_CONVEX_URL=https://production-convex-url.convex.cloud
   ```

3. **Automatic Deployment**
   - Pushes to `main` branch trigger automatic production deployment
   - Requires GitHub secrets to be configured
   - Includes comprehensive pre-deployment checks

## GitHub Secrets Configuration

Configure these secrets in your GitHub repository settings:

### Staging Secrets

- `CONVEX_DEPLOY_KEY_STAGING`
- `WORKOS_CLIENT_ID_STAGING`
- `WORKOS_API_KEY_STAGING`

### Production Secrets

- `CONVEX_DEPLOY_KEY_PROD`
- `WORKOS_CLIENT_ID_PROD`
- `WORKOS_API_KEY_PROD`

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Build succeeds
- [ ] Environment variables configured
- [ ] Database migrations ready (if any)

### Post-Deployment

- [ ] Verify deployment in Convex dashboard
- [ ] Check application health endpoints
- [ ] Verify authentication flow
- [ ] Test critical user journeys
- [ ] Monitor error rates and performance

## Monitoring and Observability

### Convex Dashboard

- **URL**: https://dashboard.convex.dev
- **Metrics**: Function performance, error rates, database usage
- **Logs**: Real-time function execution logs

### Application Monitoring

- Function latency (target: p95 < 120ms)
- WebSocket connection health
- Authentication success rates
- Meeting creation/join success rates

### Alerts

Configure alerts for:

- High error rates (>5%)
- Slow function performance (p95 > 200ms)
- Authentication failures
- Database connection issues

## Rollback Procedures

### Convex Rollback

```bash
# List recent deployments
npx convex deployments list

# Rollback to specific deployment
npx convex deployments rollback <deployment-id>
```

### Application Rollback

```bash
# Revert to previous commit
git revert <commit-hash>
git push origin main

# Or rollback via hosting platform (Vercel/Netlify)
```

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify WorkOS configuration
   - Check JWT issuer and JWKS URLs
   - Validate environment variables

2. **Database Connection Issues**
   - Check Convex deployment status
   - Verify CONVEX_URL environment variable
   - Review function logs in dashboard

3. **Performance Issues**
   - Monitor function execution times
   - Check for missing indexes
   - Review query patterns

### Debug Commands

```bash
# Check Convex status
npx convex status

# View function logs
npx convex logs

# Test database connection
npx convex run users/queries:getCurrentUser

# Generate fresh types
npm run convex:codegen
```

## Security Considerations

### Environment Variables

- Never commit secrets to version control
- Use different secrets for each environment
- Rotate secrets regularly
- Use strong, unique passwords (32+ characters)

### Access Control

- Limit Convex dashboard access
- Use principle of least privilege
- Regular access reviews
- Monitor audit logs

### Data Protection

- Enable audit logging
- Implement data retention policies
- Regular security assessments
- Incident response procedures

## Performance Optimization

### Database

- Monitor query performance
- Optimize indexes based on usage patterns
- Implement proper pagination
- Use time-based sharding for high-frequency data

### Functions

- Minimize function execution time
- Implement proper error handling
- Use batching for bulk operations
- Monitor memory usage

### Real-time Features

- Optimize WebSocket connections
- Implement backpressure handling
- Use appropriate batching windows
- Monitor subscription counts

## Maintenance

### Regular Tasks

- Review and update dependencies
- Monitor performance metrics
- Clean up old data per retention policies
- Update documentation

### Quarterly Reviews

- Security assessment
- Performance optimization
- Cost analysis
- Capacity planning

## Support

### Documentation

- [Convex Documentation](https://docs.convex.dev)
- [WorkOS Documentation](https://workos.com/docs)
- [Project README](./README.md)
- [Convex Functions README](./convex/README.md)

### Emergency Contacts

- Platform Team: platform@Connvo.com
- DevOps Team: devops@Connvo.com
- On-call: +1-XXX-XXX-XXXX
