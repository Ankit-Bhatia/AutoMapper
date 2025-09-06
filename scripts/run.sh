#!/bin/bash

# Metadata Automation Agent Run Script

set -e

echo "🚀 Starting Metadata Automation Agent..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found. Please run setup.sh first."
    exit 1
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ Environment file not found. Please create .env file from .env.example"
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Set Python path
export PYTHONPATH=/workspace

# Run the application
echo "🏃 Starting the application..."
python -m app.main