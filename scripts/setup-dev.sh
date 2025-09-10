#!/bin/bash

echo "🚀 Setting up LinkedUp development environment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from example..."
    cp .env.example .env
    echo "⚠️  Please update .env with your actual environment variables"
fi

# Initialize Convex (if not already done)
if [ ! -f "convex.json" ]; then
    echo "🔧 Initializing Convex..."
    npx convex dev --once
else
    echo "✅ Convex already initialized"
fi

# Generate Convex types
echo "🔧 Generating Convex types..."
npm run convex:codegen

# Run type checking
echo "🔍 Running type checks..."
npm run type-check

if [ $? -eq 0 ]; then
    echo "✅ Development environment setup complete!"
    echo ""
    echo "🎯 Next steps:"
    echo "1. Update .env with your actual environment variables"
    echo "2. Run 'npm run convex:dev' to start Convex development server"
    echo "3. Run 'npm run dev' to start Next.js development server"
    echo ""
    echo "📚 Documentation:"
    echo "- Convex functions: ./convex/README.md"
    echo "- API documentation: Generated after running convex dev"
else
    echo "❌ Type checking failed. Please fix the errors and try again."
    exit 1
fi
