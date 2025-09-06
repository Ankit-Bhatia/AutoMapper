#!/bin/bash

# Metadata Automation Agent Setup Script

set -e

echo "🚀 Setting up Metadata Automation Agent..."

# Check Python version
echo "📋 Checking Python version..."
python_version=$(python3 --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)
required_version="3.8"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" = "$required_version" ]; then
    echo "✅ Python $python_version is supported"
else
    echo "❌ Python $python_version is not supported. Please install Python 3.8 or higher."
    exit 1
fi

# Create virtual environment
echo "📦 Creating virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "📚 Installing dependencies..."
pip install -r requirements.txt

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs
mkdir -p data
mkdir -p config

# Copy environment file
echo "⚙️ Setting up environment configuration..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "✅ Environment file created from template"
    echo "⚠️  Please edit .env file with your system credentials"
else
    echo "✅ Environment file already exists"
fi

# Set permissions
echo "🔐 Setting permissions..."
chmod +x scripts/*.sh 2>/dev/null || true

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your system credentials"
echo "2. Activate virtual environment: source venv/bin/activate"
echo "3. Run the application: python -m app.main"
echo "4. Access API documentation: http://localhost:8000/docs"
echo ""
echo "For more information, see README.md"