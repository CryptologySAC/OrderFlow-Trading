#!/bin/bash

# Build script for Rust BTreeMap native addon
# This consolidates the existing btreemap library with Neon FFI bindings

set -e

echo "🔨 Building Rust BTreeMap native addon..."

# Navigate to the btreemap directory
cd rust/btreemap

# Build the native addon
echo "📦 Building native addon..."
npm run build 2>/dev/null || (
    echo "⚠️  npm build failed, trying direct neon build..."
    # Fallback to direct neon build if npm script doesn't exist
    npx neon build --release
)

# Copy the built addon to the expected location
echo "📋 Copying native addon..."
mkdir -p native
cp -f ../../target/release/index.node native/index.node 2>/dev/null || cp -f target/release/index.node native/index.node

echo "✅ Rust BTreeMap native addon built successfully!"
echo "📁 Addon location: rust/btreemap/native/index.node"