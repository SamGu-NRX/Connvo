#!/bin/bash

echo "🔍 LinkedUp Setup Verification"
echo "=============================="

# Check Node.js version
echo "📦 Checking Node.js version..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "✅ Node.js: $NODE_VERSION"
else
    echo "❌ Node.js not found"
    exit 1
fi

# Check if dependencies are installed
echo "📦 Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "✅ Dependencies installed"
else
    echo "❌ Dependencies not installed. Run: npm install"
    exit 1
fi

# Check environment variables
echo "🔧 Checking environment variables..."
if [ -f ".env" ]; then
    echo "✅ .env file exists"

    # Check required variables
    if grep -q "WORKOS_CLIENT_ID=" .env; then
        echo "✅ WORKOS_CLIENT_ID configured"
    else
        echo "❌ WORKOS_CLIENT_ID missing in .env"
    fi

    if grep -q "WORKOS_API_KEY=" .env; then
        echo "✅ WORKOS_API_KEY configured"
    else
        echo "❌ WORKOS_API_KEY missing in .env"
    fi

    if grep -q "WORKOS_COOKIE_PASSWORD=" .env; then
        echo "✅ WORKOS_COOKIE_PASSWORD configured"
    else
        echo "❌ WORKOS_COOKIE_PASSWORD missing in .env"
    fi
else
    echo "❌ .env file not found. Copy from .env.example"
    exit 1
fi

# Check Convex configuration
echo "🔧 Checking Convex configuration..."
if [ -f "convex.json" ]; then
    echo "✅ convex.json exists"
else
    echo "❌ convex.json not found"
fi

if [ -f "convex/schema.ts" ]; then
    echo "✅ Convex schema exists"
else
    echo "❌ Convex schema not found"
fi

if [ -f "convex/auth.config.ts" ]; then
    echo "✅ Convex auth config exists"
else
    echo "❌ Convex auth config not found"
fi

# Check if Convex types are generated
echo "🔧 Checking Convex types..."
if [ -f "convex/_generated/api.d.ts" ]; then
    echo "✅ Convex types generated"
else
    echo "⚠️  Convex types not generated. Run: npm run convex:codegen"
fi

# Check TypeScript configuration
echo "🔧 Checking TypeScript..."
if [ -f "tsconfig.json" ]; then
    echo "✅ TypeScript config exists"
else
    echo "❌ TypeScript config not found"
fi

# Test TypeScript compilation
echo "🔍 Testing TypeScript compilation..."
if npm run type-check > /dev/null 2>&1; then
    echo "✅ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed. Run: npm run type-check"
fi

echo ""
echo "🚀 Setup Status Summary:"
echo "======================="

# Count checks
TOTAL_CHECKS=8
PASSED_CHECKS=0

# Recheck everything for summary
command -v node &> /dev/null && ((PASSED_CHECKS++))
[ -d "node_modules" ] && ((PASSED_CHECKS++))
[ -f ".env" ] && ((PASSED_CHECKS++))
grep -q "WORKOS_CLIENT_ID=" .env 2>/dev/null && ((PASSED_CHECKS++))
[ -f "convex.json" ] && ((PASSED_CHECKS++))
[ -f "convex/schema.ts" ] && ((PASSED_CHECKS++))
[ -f "convex/auth.config.ts" ] && ((PASSED_CHECKS++))
[ -f "tsconfig.json" ] && ((PASSED_CHECKS++))

echo "Passed: $PASSED_CHECKS/$TOTAL_CHECKS checks"

if [ $PASSED_CHECKS -eq $TOTAL_CHECKS ]; then
    echo "✅ Setup looks good! Ready to start testing."
    echo ""
    echo "🎯 Next steps:"
    echo "1. Start Convex: npm run convex:dev"
    echo "2. Start Next.js: npm run dev"
    echo "3. Open: http://localhost:3000/auth-test"
else
    echo "❌ Setup incomplete. Please fix the issues above."
    exit 1
fi
