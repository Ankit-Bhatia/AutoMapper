#!/bin/bash

# Test connections to Salesforce and SAP systems

set -e

echo "🔍 Testing system connections..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found. Please run setup.sh first."
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ Environment file not found. Please create .env file from .env.example"
    exit 1
fi

# Set Python path
export PYTHONPATH=/workspace

# Test Salesforce connection
echo "🔗 Testing Salesforce connection..."
python -c "
import asyncio
import sys
import os
sys.path.append('/workspace')
from app.connectors.salesforce import SalesforceConnector
from app.core.config import settings

async def test_salesforce():
    config = {
        'username': settings.salesforce_username,
        'password': settings.salesforce_password,
        'security_token': settings.salesforce_security_token,
        'domain': settings.salesforce_domain
    }
    
    connector = SalesforceConnector(config)
    try:
        connected = await connector.connect()
        if connected:
            test_result = await connector.test_connection()
            if test_result:
                print('✅ Salesforce connection successful')
            else:
                print('❌ Salesforce connection test failed')
        else:
            print('❌ Failed to connect to Salesforce')
    except Exception as e:
        print(f'❌ Salesforce connection error: {e}')
    finally:
        await connector.disconnect()

asyncio.run(test_salesforce())
"

# Test SAP connection
echo "🔗 Testing SAP connection..."
python -c "
import asyncio
import sys
import os
sys.path.append('/workspace')
from app.connectors.sap import SAPConnector
from app.core.config import settings

async def test_sap():
    config = {
        'ashost': settings.sap_ashost,
        'sysnr': settings.sap_sysnr,
        'client': settings.sap_client,
        'user': settings.sap_user,
        'passwd': settings.sap_passwd,
        'lang': settings.sap_lang
    }
    
    connector = SAPConnector(config)
    try:
        connected = await connector.connect()
        if connected:
            test_result = await connector.test_connection()
            if test_result:
                print('✅ SAP connection successful')
            else:
                print('❌ SAP connection test failed')
        else:
            print('❌ Failed to connect to SAP')
    except Exception as e:
        print(f'❌ SAP connection error: {e}')
    finally:
        await connector.disconnect()

asyncio.run(test_sap())
"

echo "🏁 Connection tests completed"