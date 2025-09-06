# Metadata Automation Agent

An intelligent agent for automating metadata management across enterprise systems, starting with Salesforce and SAP integration.

## Features

- **Multi-System Support**: Extract metadata from Salesforce and SAP systems
- **Unified Metadata Model**: Standardized representation of objects, tables, and columns
- **Metadata Comparison**: Compare metadata structures between systems
- **Synchronization**: Sync metadata changes across systems
- **Custom Mapping Management**: Handle customer-specific system modifications
- **Data Export/Import**: Export metadata to CSV, JSON, Excel and import custom mappings
- **Review & Update System**: Review and update metadata mappings through API
- **RESTful API**: Complete API for all metadata operations
- **Monitoring & Logging**: Comprehensive monitoring and logging capabilities
- **Configuration Management**: Flexible configuration system for different environments

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Salesforce    │    │   Metadata      │    │      SAP        │
│   Connector     │◄──►│   Agent         │◄──►│   Connector     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   REST API      │
                       │   Endpoints     │
                       └─────────────────┘
```

## Quick Start

### Prerequisites

- Python 3.8+
- Access to Salesforce and/or SAP systems
- Required credentials for both systems

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd metadata-automation-agent
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your system credentials
   ```

4. **Run the application**
   ```bash
   python -m app.main
   ```

5. **Access the API documentation**
   - Open your browser to `http://localhost:8000/docs`
   - Interactive API documentation with Swagger UI

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Salesforce Configuration
SALESFORCE_USERNAME=your_salesforce_username
SALESFORCE_PASSWORD=your_salesforce_password
SALESFORCE_SECURITY_TOKEN=your_salesforce_security_token
SALESFORCE_DOMAIN=login.salesforce.com

# SAP Configuration
SAP_ASHOST=your_sap_host
SAP_SYSNR=00
SAP_CLIENT=100
SAP_USER=your_sap_user
SAP_PASSWD=your_sap_password
SAP_LANG=EN

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
API_DEBUG=True

# Logging
LOG_LEVEL=INFO
LOG_FILE=logs/metadata_agent.log
```

### Salesforce Setup

1. **Get Security Token**
   - Log into Salesforce
   - Go to Setup → My Personal Information → Reset My Security Token
   - Click "Reset Security Token"

2. **API Access**
   - Ensure your user has API access enabled
   - Required permissions: "API Enabled", "View All Data" (for metadata extraction)

### SAP Setup

1. **RFC Connection**
   - Ensure RFC connections are enabled
   - User must have appropriate authorizations for metadata access
   - Required authorizations: S_TABU_DIS, S_TABU_NAM

2. **Network Access**
   - Ensure network connectivity to SAP system
   - Firewall rules allow RFC connections

## API Usage

### Test Connection

```bash
curl -X POST "http://localhost:8000/api/v1/metadata/test-connection" \
  -H "Content-Type: application/json" \
  -d '{
    "system_type": "salesforce",
    "config": {
      "username": "user@company.com",
      "password": "password123",
      "security_token": "abc123def456"
    }
  }'
```

### Extract Metadata

```bash
curl -X POST "http://localhost:8000/api/v1/metadata/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "system_type": "salesforce",
    "config": {
      "username": "user@company.com",
      "password": "password123",
      "security_token": "abc123def456"
    },
    "object_names": ["Account", "Contact", "Opportunity"]
  }'
```

### Compare Metadata

```bash
curl -X POST "http://localhost:8000/api/v1/metadata/compare" \
  -H "Content-Type: application/json" \
  -d '{
    "source_system": "salesforce",
    "target_system": "sap",
    "source_config": {
      "username": "user@company.com",
      "password": "password123",
      "security_token": "abc123def456"
    },
    "target_config": {
      "ashost": "sap-server.company.com",
      "user": "SAP_USER",
      "passwd": "password123"
    }
  }'
```

### Sync Metadata

```bash
curl -X POST "http://localhost:8000/api/v1/metadata/sync" \
  -H "Content-Type: application/json" \
  -d '{
    "source_system": "salesforce",
    "target_system": "sap",
    "source_config": {
      "username": "user@company.com",
      "password": "password123",
      "security_token": "abc123def456"
    },
    "target_config": {
      "ashost": "sap-server.company.com",
      "user": "SAP_USER",
      "passwd": "password123"
    },
    "object_names": ["Account", "Contact"]
  }'
```

### Export Metadata for Review

```bash
# Export columns to CSV
curl "http://localhost:8000/api/v1/export/columns/csv?system_type=salesforce" \
  -o salesforce_columns.csv

# Export complete metadata to Excel
curl "http://localhost:8000/api/v1/export/complete/excel" \
  -o complete_metadata.xlsx

# Export to JSON
curl "http://localhost:8000/api/v1/export/complete/json" \
  -o metadata_export.json
```

### Review and Update Custom Mappings

```bash
# Get columns for review
curl "http://localhost:8000/api/v1/review/columns?system_type=salesforce&has_custom_mapping=false"

# Update column metadata
curl -X PUT "http://localhost:8000/api/v1/review/columns/123" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_data_type": "string",
    "custom_label": "Account Name",
    "mapping_notes": "Maps to SAP KNA1.NAME1"
  }' \
  -G -d "updated_by=admin"

# Create custom mapping
curl -X POST "http://localhost:8000/api/v1/review/mappings" \
  -H "Content-Type: application/json" \
  -d '{
    "source_system": "salesforce",
    "target_system": "sap",
    "source_object": "Account",
    "target_object": "KNA1",
    "mapping_type": "object",
    "mapping_notes": "Customer master mapping"
  }' \
  -G -d "created_by=admin"
```

### Import Updated Mappings

```bash
# Import column updates from CSV
curl -X POST "http://localhost:8000/api/v1/import/columns/csv" \
  -F "file=@updated_columns.csv" \
  -F "system_type=salesforce" \
  -F "update_mode=update_only"

# Import mappings from Excel
curl -X POST "http://localhost:8000/api/v1/import/excel" \
  -F "file=@mappings.xlsx" \
  -F "system_type=salesforce"
```

## Monitoring

### Health Check

```bash
curl "http://localhost:8000/api/v1/metadata/health"
```

### Metrics

The agent collects various metrics including:
- Connection success/failure rates
- Metadata extraction times
- Sync operation durations
- Error rates

### Logging

Logs are written to:
- Console (with color formatting)
- File: `logs/metadata_agent.log`
- Error file: `logs/metadata_agent_error.log`

Log rotation is configured for:
- Size: 10MB per file
- Retention: 7 days for regular logs, 30 days for error logs

## Development

### Project Structure

```
app/
├── api/                    # API endpoints
│   └── metadata.py        # Metadata API routes
├── config/                # Configuration management
│   └── connector_configs.py
├── connectors/            # System connectors
│   ├── base.py           # Base connector class
│   ├── salesforce.py     # Salesforce connector
│   └── sap.py            # SAP connector
├── core/                 # Core functionality
│   ├── config.py         # Application configuration
│   └── logging.py        # Logging setup
├── models/               # Data models
│   └── metadata.py       # Metadata models
├── monitoring/           # Monitoring and metrics
│   ├── health.py         # Health checks
│   └── metrics.py        # Metrics collection
├── services/             # Business logic
│   ├── metadata_comparator.py  # Metadata comparison
│   └── metadata_sync.py       # Metadata synchronization
└── main.py               # Application entry point
```

### Adding New Connectors

1. **Create connector class**
   ```python
   from app.connectors.base import BaseConnector
   
   class NewSystemConnector(BaseConnector):
       async def connect(self) -> bool:
           # Implementation
           pass
       
       async def get_objects(self) -> List[ObjectMetadata]:
           # Implementation
           pass
   ```

2. **Add to API**
   ```python
   # In app/api/metadata.py
   if request.system_type == SystemType.NEW_SYSTEM:
       connector = NewSystemConnector(request.config)
   ```

3. **Update models**
   ```python
   # In app/models/metadata.py
   class SystemType(str, Enum):
       SALESFORCE = "salesforce"
       SAP = "sap"
       NEW_SYSTEM = "new_system"
   ```

### Testing

```bash
# Run tests (when implemented)
pytest tests/

# Run with coverage
pytest --cov=app tests/
```

## Security Considerations

1. **Credentials Management**
   - Never commit credentials to version control
   - Use environment variables or secure credential stores
   - Rotate credentials regularly

2. **Network Security**
   - Use HTTPS in production
   - Implement proper firewall rules
   - Consider VPN for SAP connections

3. **Access Control**
   - Implement API authentication/authorization
   - Use least privilege principle for system accounts
   - Monitor access logs

## Troubleshooting

### Common Issues

1. **Salesforce Connection Failed**
   - Verify username/password/security token
   - Check if IP is whitelisted
   - Ensure API access is enabled

2. **SAP Connection Failed**
   - Verify host, system number, and client
   - Check network connectivity
   - Ensure RFC authorizations

3. **Metadata Extraction Errors**
   - Check user permissions
   - Verify object/table names exist
   - Review system-specific limitations

### Debug Mode

Enable debug mode for detailed logging:

```env
API_DEBUG=True
LOG_LEVEL=DEBUG
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

[Add your license information here]

## Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

## Custom Mapping Workflow

The agent provides a comprehensive workflow for handling customer-specific system modifications:

### 1. Extract and Export
- Extract metadata from both systems
- Export to CSV, JSON, or Excel for review
- Include custom mappings and notes

### 2. Review and Update
- Review exported metadata in familiar tools (Excel, etc.)
- Add custom mappings, notes, and transformations
- Update data types, labels, and descriptions

### 3. Import and Apply
- Import updated mappings back to the system
- Validate custom mappings
- Apply mappings during synchronization

### 4. Monitor and Maintain
- Track mapping changes and approvals
- Monitor sync operations with custom mappings
- Maintain mapping documentation

## Example Workflow

```python
# Run the custom mapping workflow demo
python examples/custom_mapping_workflow.py
```

This example demonstrates:
- Testing system connections
- Extracting metadata from both systems
- Comparing metadata structures
- Exporting data for review
- Creating custom mappings
- Reviewing and updating mappings

## Roadmap

- [x] Custom mapping management system
- [x] Data export/import functionality
- [x] Review and update API endpoints
- [ ] Additional system connectors (Oracle, SQL Server, etc.)
- [ ] Web UI for metadata management
- [ ] Automated metadata validation
- [ ] Metadata lineage tracking
- [ ] Integration with data governance tools
- [ ] Real-time metadata synchronization
- [ ] Advanced conflict resolution
- [ ] Metadata versioning