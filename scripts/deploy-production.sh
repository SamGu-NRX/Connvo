#!/bin/bash

# Deploy to production environment
echo "🚀 Deploying to production environment..."

# Set environment variables
export NODE_ENV=production

# Confirmation prompt
read -p "⚠️  Are you sure you want to deploy to PRODUCTION? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Deployment cancelled."
  exit 1
fi

# Run comprehensive checks
echo "🔍 Running comprehensive pre-deployment checks..."

# Type checking
echo "📝 Type checking..."
npm run type-check
if [ $? -ne 0 ]; then
  echo "❌ Type checking failed. Aborting deployment."
  exit 1
fi

# Linting
echo "🧹 Linting..."
npm run lint
if [ $? -ne 0 ]; then
  echo "❌ Linting failed. Aborting deployment."
  exit 1
fi

# Tests (when available)
echo "🧪 Running tests..."
npm test
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Aborting deployment."
  exit 1
fi

# Build check
echo "🏗️  Testing build..."
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Build failed. Aborting deployment."
  exit 1
fi

# Generate Convex code
echo "🔧 Generating Convex code..."
npm run convex:codegen

# Deploy to Convex production
echo "📦 Deploying to Convex production..."
npx convex deploy --prod --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL

if [ $? -eq 0 ]; then
  echo "✅ Successfully deployed to production!"
  echo "🌐 Production URL: https://your-production-url.vercel.app"
  echo "📊 Monitor at: https://dashboard.convex.dev"
else
  echo "❌ Production deployment failed!"
  exit 1
fi
