from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from app.database.models import MetadataObject, MetadataTable, MetadataColumn, MetadataMapping
from app.database.connection import get_db
from app.models.metadata import SystemType, DataType
from loguru import logger
import json


class CustomMappingService:
    """Service for managing custom metadata mappings"""
    
    def __init__(self):
        pass
    
    async def create_custom_object_mapping(
        self,
        object_name: str,
        system_type: SystemType,
        custom_mapping: Dict[str, Any],
        created_by: str
    ) -> bool:
        """Create custom mapping for an object"""
        try:
            db = next(get_db())
            
            # Find the object
            obj = db.query(MetadataObject).filter(
                MetadataObject.name == object_name,
                MetadataObject.system_type == system_type
            ).first()
            
            if not obj:
                logger.error(f"Object {object_name} not found in system {system_type}")
                return False
            
            # Update object with custom mapping
            obj.custom_mapping = custom_mapping
            obj.is_custom = True
            obj.updated_at = datetime.utcnow()
            
            db.commit()
            logger.info(f"Created custom mapping for object {object_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error creating custom object mapping: {e}")
            db.rollback()
            return False
    
    async def create_custom_table_mapping(
        self,
        table_name: str,
        system_type: SystemType,
        custom_mapping: Dict[str, Any],
        created_by: str
    ) -> bool:
        """Create custom mapping for a table"""
        try:
            db = next(get_db())
            
            # Find the table
            table = db.query(MetadataTable).filter(
                MetadataTable.name == table_name,
                MetadataTable.system_type == system_type
            ).first()
            
            if not table:
                logger.error(f"Table {table_name} not found in system {system_type}")
                return False
            
            # Update table with custom mapping
            table.custom_mapping = custom_mapping
            table.is_custom = True
            table.updated_at = datetime.utcnow()
            
            db.commit()
            logger.info(f"Created custom mapping for table {table_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error creating custom table mapping: {e}")
            db.rollback()
            return False
    
    async def create_custom_column_mapping(
        self,
        column_name: str,
        table_name: str,
        system_type: SystemType,
        custom_mapping: Dict[str, Any],
        created_by: str
    ) -> bool:
        """Create custom mapping for a column"""
        try:
            db = next(get_db())
            
            # Find the column
            column = db.query(MetadataColumn).join(MetadataTable).filter(
                MetadataColumn.name == column_name,
                MetadataTable.name == table_name,
                MetadataTable.system_type == system_type
            ).first()
            
            if not column:
                logger.error(f"Column {column_name} in table {table_name} not found in system {system_type}")
                return False
            
            # Update column with custom mapping
            column.custom_mapping = custom_mapping
            column.is_custom = True
            column.updated_at = datetime.utcnow()
            column.updated_by = created_by
            
            db.commit()
            logger.info(f"Created custom mapping for column {column_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error creating custom column mapping: {e}")
            db.rollback()
            return False
    
    async def suggest_column_mappings(
        self,
        source_system: SystemType,
        target_system: SystemType,
        source_table: str,
        target_table: str
    ) -> List[Dict[str, Any]]:
        """Suggest column mappings between systems"""
        try:
            db = next(get_db())
            
            # Get source columns
            source_columns = db.query(MetadataColumn).join(MetadataTable).filter(
                MetadataTable.name == source_table,
                MetadataTable.system_type == source_system
            ).all()
            
            # Get target columns
            target_columns = db.query(MetadataColumn).join(MetadataTable).filter(
                MetadataTable.name == target_table,
                MetadataTable.system_type == target_system
            ).all()
            
            suggestions = []
            
            for source_col in source_columns:
                best_match = None
                best_score = 0.0
                
                for target_col in target_columns:
                    score = self._calculate_column_similarity(source_col, target_col)
                    if score > best_score:
                        best_score = score
                        best_match = target_col
                
                if best_match and best_score > 0.3:  # Minimum threshold
                    suggestions.append({
                        'source_column': source_col.name,
                        'target_column': best_match.name,
                        'source_data_type': source_col.data_type,
                        'target_data_type': best_match.data_type,
                        'confidence_score': best_score,
                        'mapping_type': 'column',
                        'suggested_transformation': self._suggest_transformation(
                            source_col, best_match
                        )
                    })
            
            return suggestions
            
        except Exception as e:
            logger.error(f"Error suggesting column mappings: {e}")
            return []
    
    def _calculate_column_similarity(
        self, 
        source_col: MetadataColumn, 
        target_col: MetadataColumn
    ) -> float:
        """Calculate similarity score between two columns"""
        score = 0.0
        
        # Name similarity (exact match = 1.0, partial match = 0.5)
        if source_col.name.lower() == target_col.name.lower():
            score += 0.4
        elif source_col.name.lower() in target_col.name.lower() or target_col.name.lower() in source_col.name.lower():
            score += 0.2
        
        # Label similarity
        if source_col.label and target_col.label:
            if source_col.label.lower() == target_col.label.lower():
                score += 0.3
            elif source_col.label.lower() in target_col.label.lower() or target_col.label.lower() in source_col.label.lower():
                score += 0.15
        
        # Data type compatibility
        if self._are_data_types_compatible(source_col.data_type, target_col.data_type):
            score += 0.2
        
        # Length compatibility
        if source_col.length and target_col.length:
            if source_col.length == target_col.length:
                score += 0.1
        
        return min(score, 1.0)
    
    def _are_data_types_compatible(self, source_type: str, target_type: str) -> bool:
        """Check if data types are compatible"""
        # Define compatibility matrix
        compatibility = {
            'string': ['string', 'text', 'char'],
            'integer': ['integer', 'int', 'number'],
            'decimal': ['decimal', 'float', 'number', 'currency'],
            'date': ['date', 'datetime'],
            'datetime': ['datetime', 'date'],
            'boolean': ['boolean', 'bool'],
            'text': ['text', 'string', 'textarea'],
            'currency': ['currency', 'decimal', 'number'],
            'percent': ['percent', 'decimal', 'number'],
            'email': ['email', 'string'],
            'phone': ['phone', 'string'],
            'url': ['url', 'string'],
            'picklist': ['picklist', 'string'],
            'multipicklist': ['multipicklist', 'picklist', 'string'],
            'reference': ['reference', 'lookup', 'string'],
            'lookup': ['lookup', 'reference', 'string'],
            'master_detail': ['master_detail', 'reference', 'lookup', 'string']
        }
        
        source_type_lower = source_type.lower()
        target_type_lower = target_type.lower()
        
        if source_type_lower in compatibility:
            return target_type_lower in compatibility[source_type_lower]
        
        return source_type_lower == target_type_lower
    
    def _suggest_transformation(
        self, 
        source_col: MetadataColumn, 
        target_col: MetadataColumn
    ) -> Optional[Dict[str, Any]]:
        """Suggest transformation rules for column mapping"""
        transformation = {}
        
        # Data type transformation
        if source_col.data_type != target_col.data_type:
            transformation['data_type_conversion'] = {
                'from': source_col.data_type,
                'to': target_col.data_type,
                'method': self._get_conversion_method(source_col.data_type, target_col.data_type)
            }
        
        # Length adjustment
        if source_col.length and target_col.length and source_col.length != target_col.length:
            transformation['length_adjustment'] = {
                'from': source_col.length,
                'to': target_col.length,
                'action': 'truncate' if source_col.length > target_col.length else 'pad'
            }
        
        # Nullable adjustment
        if source_col.nullable != target_col.nullable:
            transformation['nullable_adjustment'] = {
                'from': source_col.nullable,
                'to': target_col.nullable,
                'default_value': target_col.default_value if not target_col.nullable else None
            }
        
        return transformation if transformation else None
    
    def _get_conversion_method(self, from_type: str, to_type: str) -> str:
        """Get conversion method for data type transformation"""
        conversions = {
            ('string', 'integer'): 'parse_int',
            ('string', 'decimal'): 'parse_decimal',
            ('string', 'date'): 'parse_date',
            ('string', 'datetime'): 'parse_datetime',
            ('string', 'boolean'): 'parse_boolean',
            ('integer', 'string'): 'to_string',
            ('decimal', 'string'): 'to_string',
            ('date', 'string'): 'to_string',
            ('datetime', 'string'): 'to_string',
            ('boolean', 'string'): 'to_string',
            ('integer', 'decimal'): 'cast_to_decimal',
            ('decimal', 'integer'): 'cast_to_integer'
        }
        
        return conversions.get((from_type.lower(), to_type.lower()), 'direct_copy')
    
    async def apply_custom_mappings(
        self,
        source_system: SystemType,
        target_system: SystemType,
        object_name: str
    ) -> Dict[str, Any]:
        """Apply custom mappings for object synchronization"""
        try:
            db = next(get_db())
            
            # Get source object
            source_obj = db.query(MetadataObject).filter(
                MetadataObject.name == object_name,
                MetadataObject.system_type == source_system
            ).first()
            
            if not source_obj:
                return {'error': f'Source object {object_name} not found'}
            
            # Get target object
            target_obj = db.query(MetadataObject).filter(
                MetadataObject.name == object_name,
                MetadataObject.system_type == target_system
            ).first()
            
            if not target_obj:
                return {'error': f'Target object {object_name} not found'}
            
            # Apply custom mappings
            applied_mappings = {
                'object_mappings': [],
                'table_mappings': [],
                'column_mappings': []
            }
            
            # Object level mappings
            if source_obj.custom_mapping:
                applied_mappings['object_mappings'].append({
                    'source': source_obj.name,
                    'target': target_obj.name,
                    'mapping': source_obj.custom_mapping
                })
            
            # Table level mappings
            for source_table in source_obj.tables:
                target_table = next(
                    (t for t in target_obj.tables if t.name == source_table.name), 
                    None
                )
                
                if target_table and source_table.custom_mapping:
                    applied_mappings['table_mappings'].append({
                        'source': source_table.name,
                        'target': target_table.name,
                        'mapping': source_table.custom_mapping
                    })
                
                # Column level mappings
                if target_table:
                    for source_col in source_table.columns:
                        target_col = next(
                            (c for c in target_table.columns if c.name == source_col.name),
                            None
                        )
                        
                        if target_col and source_col.custom_mapping:
                            applied_mappings['column_mappings'].append({
                                'source': source_col.name,
                                'target': target_col.name,
                                'mapping': source_col.custom_mapping
                            })
            
            return {
                'status': 'success',
                'applied_mappings': applied_mappings,
                'total_mappings': (
                    len(applied_mappings['object_mappings']) +
                    len(applied_mappings['table_mappings']) +
                    len(applied_mappings['column_mappings'])
                )
            }
            
        except Exception as e:
            logger.error(f"Error applying custom mappings: {e}")
            return {'error': str(e)}
    
    async def get_mapping_templates(self) -> Dict[str, Any]:
        """Get common mapping templates"""
        templates = {
            'salesforce_to_sap': {
                'object_mappings': {
                    'Account': 'KNA1',  # Customer master
                    'Contact': 'KNVK',  # Customer contact
                    'Opportunity': 'VBAP',  # Sales document item
                    'Product': 'MARA',  # Material master
                    'PricebookEntry': 'A304'  # Pricing
                },
                'column_mappings': {
                    'Id': 'MANDT',  # Client
                    'Name': 'NAME1',  # Name
                    'Email': 'SMTP_ADDR',  # Email
                    'Phone': 'TEL_NUMBER',  # Phone
                    'CreatedDate': 'ERDAT',  # Created date
                    'LastModifiedDate': 'AEDAT'  # Changed date
                },
                'data_type_mappings': {
                    'string': 'CHAR',
                    'integer': 'INT4',
                    'decimal': 'DEC',
                    'date': 'DATS',
                    'datetime': 'DATS',
                    'boolean': 'CHAR'
                }
            },
            'sap_to_salesforce': {
                'object_mappings': {
                    'KNA1': 'Account',  # Customer master
                    'KNVK': 'Contact',  # Customer contact
                    'VBAP': 'Opportunity',  # Sales document item
                    'MARA': 'Product',  # Material master
                    'A304': 'PricebookEntry'  # Pricing
                },
                'column_mappings': {
                    'MANDT': 'Id',  # Client
                    'NAME1': 'Name',  # Name
                    'SMTP_ADDR': 'Email',  # Email
                    'TEL_NUMBER': 'Phone',  # Phone
                    'ERDAT': 'CreatedDate',  # Created date
                    'AEDAT': 'LastModifiedDate'  # Changed date
                },
                'data_type_mappings': {
                    'CHAR': 'string',
                    'INT4': 'integer',
                    'DEC': 'decimal',
                    'DATS': 'date',
                    'TIMS': 'string',
                    'TEXT': 'text'
                }
            }
        }
        
        return templates
    
    async def validate_custom_mapping(
        self,
        mapping: Dict[str, Any],
        mapping_type: str
    ) -> Dict[str, Any]:
        """Validate custom mapping structure"""
        validation_result = {
            'valid': True,
            'errors': [],
            'warnings': []
        }
        
        try:
            if mapping_type == 'object':
                required_fields = ['name', 'label', 'description']
                for field in required_fields:
                    if field not in mapping:
                        validation_result['errors'].append(f'Missing required field: {field}')
            
            elif mapping_type == 'table':
                required_fields = ['name', 'label']
                for field in required_fields:
                    if field not in mapping:
                        validation_result['errors'].append(f'Missing required field: {field}')
            
            elif mapping_type == 'column':
                required_fields = ['name', 'data_type']
                for field in required_fields:
                    if field not in mapping:
                        validation_result['errors'].append(f'Missing required field: {field}')
                
                # Validate data type
                if 'data_type' in mapping:
                    valid_types = [dt.value for dt in DataType]
                    if mapping['data_type'] not in valid_types:
                        validation_result['warnings'].append(
                            f'Data type {mapping["data_type"]} may not be supported'
                        )
            
            if validation_result['errors']:
                validation_result['valid'] = False
            
            return validation_result
            
        except Exception as e:
            logger.error(f"Error validating custom mapping: {e}")
            return {
                'valid': False,
                'errors': [str(e)],
                'warnings': []
            }