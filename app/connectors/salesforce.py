import asyncio
from typing import List, Dict, Any, Optional
from simple_salesforce import Salesforce
from app.connectors.base import BaseConnector
from app.models.metadata import (
    ObjectMetadata, TableMetadata, ColumnMetadata, 
    SystemType, DataType
)
from loguru import logger


class SalesforceConnector(BaseConnector):
    """Salesforce connector for metadata extraction"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(SystemType.SALESFORCE, config)
        self.sf = None
    
    async def connect(self) -> bool:
        """Establish connection to Salesforce"""
        try:
            self.sf = Salesforce(
                username=self.config['username'],
                password=self.config['password'],
                security_token=self.config['security_token'],
                domain=self.config.get('domain', 'login')
            )
            logger.info("Successfully connected to Salesforce")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to Salesforce: {e}")
            return False
    
    async def disconnect(self) -> bool:
        """Close Salesforce connection"""
        try:
            self.sf = None
            logger.info("Disconnected from Salesforce")
            return True
        except Exception as e:
            logger.error(f"Error disconnecting from Salesforce: {e}")
            return False
    
    async def test_connection(self) -> bool:
        """Test Salesforce connection"""
        try:
            if not self.sf:
                return False
            # Simple query to test connection
            result = self.sf.query("SELECT Id FROM User LIMIT 1")
            return result['totalSize'] >= 0
        except Exception as e:
            logger.error(f"Salesforce connection test failed: {e}")
            return False
    
    async def get_objects(self) -> List[ObjectMetadata]:
        """Retrieve all Salesforce objects"""
        if not self.sf:
            raise Exception("Not connected to Salesforce")
        
        try:
            # Get all objects
            describe_global = self.sf.describe()
            objects = []
            
            for obj in describe_global['sobjects']:
                if obj['queryable']:  # Only include queryable objects
                    object_metadata = ObjectMetadata(
                        name=obj['name'],
                        label=obj['label'],
                        description=obj.get('description'),
                        system_type=SystemType.SALESFORCE,
                        system_attributes={
                            'custom': obj['custom'],
                            'createable': obj['createable'],
                            'updateable': obj['updateable'],
                            'deletable': obj['deletable'],
                            'queryable': obj['queryable'],
                            'searchable': obj['searchable'],
                            'triggerable': obj['triggerable'],
                            'undeletable': obj['undeletable']
                        }
                    )
                    objects.append(object_metadata)
            
            logger.info(f"Retrieved {len(objects)} Salesforce objects")
            return objects
            
        except Exception as e:
            logger.error(f"Error retrieving Salesforce objects: {e}")
            return []
    
    async def get_tables(self, object_name: Optional[str] = None) -> List[TableMetadata]:
        """Retrieve Salesforce objects as tables"""
        objects = await self.get_objects()
        tables = []
        
        for obj in objects:
            if object_name is None or obj.name == object_name:
                # Get detailed metadata for the object
                try:
                    describe_result = self.sf.__getattr__(obj.name).describe()
                    
                    table_metadata = TableMetadata(
                        name=obj.name,
                        label=obj.label,
                        description=obj.description,
                        system_type=SystemType.SALESFORCE,
                        system_attributes=obj.system_attributes
                    )
                    
                    # Convert fields to columns
                    columns = []
                    for field in describe_result['fields']:
                        column = await self._convert_field_to_column(field)
                        columns.append(column)
                    
                    table_metadata.columns = columns
                    tables.append(table_metadata)
                    
                except Exception as e:
                    logger.warning(f"Could not get metadata for object {obj.name}: {e}")
        
        return tables
    
    async def get_columns(self, table_name: str) -> List[ColumnMetadata]:
        """Retrieve columns for a specific Salesforce object"""
        try:
            describe_result = self.sf.__getattr__(table_name).describe()
            columns = []
            
            for field in describe_result['fields']:
                column = await self._convert_field_to_column(field)
                columns.append(column)
            
            return columns
            
        except Exception as e:
            logger.error(f"Error retrieving columns for {table_name}: {e}")
            return []
    
    async def get_object_metadata(self, object_name: str) -> Optional[ObjectMetadata]:
        """Get complete metadata for a specific Salesforce object"""
        try:
            describe_result = self.sf.__getattr__(object_name).describe()
            
            object_metadata = ObjectMetadata(
                name=object_name,
                label=describe_result['label'],
                description=describe_result.get('description'),
                system_type=SystemType.SALESFORCE,
                system_attributes={
                    'custom': describe_result['custom'],
                    'createable': describe_result['createable'],
                    'updateable': describe_result['updateable'],
                    'deletable': describe_result['deletable'],
                    'queryable': describe_result['queryable'],
                    'searchable': describe_result['searchable'],
                    'triggerable': describe_result['triggerable'],
                    'undeletable': describe_result['undeletable']
                }
            )
            
            # Get table metadata
            table_metadata = TableMetadata(
                name=object_name,
                label=describe_result['label'],
                description=describe_result.get('description'),
                system_type=SystemType.SALESFORCE,
                system_attributes=object_metadata.system_attributes
            )
            
            # Convert fields to columns
            columns = []
            for field in describe_result['fields']:
                column = await self._convert_field_to_column(field)
                columns.append(column)
            
            table_metadata.columns = columns
            object_metadata.tables = [table_metadata]
            
            return object_metadata
            
        except Exception as e:
            logger.error(f"Error retrieving metadata for object {object_name}: {e}")
            return None
    
    async def get_table_metadata(self, table_name: str) -> Optional[TableMetadata]:
        """Get complete metadata for a specific Salesforce object as table"""
        try:
            describe_result = self.sf.__getattr__(table_name).describe()
            
            table_metadata = TableMetadata(
                name=table_name,
                label=describe_result['label'],
                description=describe_result.get('description'),
                system_type=SystemType.SALESFORCE,
                system_attributes={
                    'custom': describe_result['custom'],
                    'createable': describe_result['createable'],
                    'updateable': describe_result['updateable'],
                    'deletable': describe_result['deletable'],
                    'queryable': describe_result['queryable'],
                    'searchable': describe_result['searchable'],
                    'triggerable': describe_result['triggerable'],
                    'undeletable': describe_result['undeletable']
                }
            )
            
            # Convert fields to columns
            columns = []
            for field in describe_result['fields']:
                column = await self._convert_field_to_column(field)
                columns.append(column)
            
            table_metadata.columns = columns
            return table_metadata
            
        except Exception as e:
            logger.error(f"Error retrieving table metadata for {table_name}: {e}")
            return None
    
    async def _convert_field_to_column(self, field: Dict[str, Any]) -> ColumnMetadata:
        """Convert Salesforce field to ColumnMetadata"""
        # Map Salesforce field types to our DataType enum
        type_mapping = {
            'string': DataType.STRING,
            'textarea': DataType.TEXT,
            'int': DataType.INTEGER,
            'double': DataType.DECIMAL,
            'currency': DataType.CURRENCY,
            'percent': DataType.PERCENT,
            'date': DataType.DATE,
            'datetime': DataType.DATETIME,
            'boolean': DataType.BOOLEAN,
            'email': DataType.EMAIL,
            'phone': DataType.PHONE,
            'url': DataType.URL,
            'picklist': DataType.PICKLIST,
            'multipicklist': DataType.MULTIPICKLIST,
            'reference': DataType.REFERENCE,
            'lookup': DataType.LOOKUP,
            'masterdetail': DataType.MASTER_DETAIL
        }
        
        data_type = type_mapping.get(field['type'], DataType.STRING)
        
        # Get picklist values if applicable
        picklist_values = None
        if field.get('picklistValues'):
            picklist_values = [pv['value'] for pv in field['picklistValues']]
        
        # Determine if it's a foreign key
        is_foreign_key = field['type'] in ['reference', 'lookup', 'masterdetail']
        referenced_table = None
        referenced_column = None
        
        if is_foreign_key and field.get('referenceTo'):
            referenced_table = field['referenceTo'][0] if field['referenceTo'] else None
            referenced_column = 'Id'  # Salesforce references always point to Id
        
        return ColumnMetadata(
            name=field['name'],
            label=field['label'],
            data_type=data_type,
            length=field.get('length'),
            precision=field.get('precision'),
            scale=field.get('scale'),
            nullable=not field.get('nillable', True),
            unique=field.get('unique', False),
            primary_key=field['name'] == 'Id',
            foreign_key=is_foreign_key,
            referenced_table=referenced_table,
            referenced_column=referenced_column,
            default_value=field.get('defaultValue'),
            description=field.get('inlineHelpText'),
            picklist_values=picklist_values,
            system_attributes={
                'type': field['type'],
                'createable': field.get('createable', False),
                'updateable': field.get('updateable', False),
                'sortable': field.get('sortable', False),
                'filterable': field.get('filterable', False),
                'groupable': field.get('groupable', False),
                'custom': field.get('custom', False),
                'externalId': field.get('externalId', False),
                'calculated': field.get('calculated', False),
                'calculatedFormula': field.get('calculatedFormula'),
                'cascadeDelete': field.get('cascadeDelete', False),
                'restrictedDelete': field.get('restrictedDelete', False)
            }
        )