#!/bin/bash

# Deploy to staging environment
echo "🚀 Deploying to staging environment..."

# Set environment variables
export NODE_ENV=staging

# Run type checking
echo "🔍 Running type checks..."
npm run type-check

if [ $? -ne 0 ]; then
  echo "❌ Type checking failed. Aborting deployment."
  exit 1
fi

# Run linting
echo "🧹 Running linter..."
npm run lint

if [ $? -ne 0 ]; then
  echo "❌ Linting failed. Aborting deployment."
  exit 1
fi

# Generate Convex code
echo "🔧 Generating Convex code..."
npm run convex:codegen

# Deploy to Convex staging
echo "📦 Deploying to Convex staging..."
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL

if [ $? -eq 0 ]; then
  echo "✅ Successfully deployed to staging!"
  echo "🌐 Staging URL: https://your-staging-url.vercel.app"
else
  echo "❌ Deployment failed!"
  exit 1
fi
