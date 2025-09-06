import pandas as pd
import json
from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path
from app.database.models import (
    MetadataObject, MetadataTable, MetadataColumn, MetadataMapping,
    SystemConnection
)
from app.database.connection import get_db
from app.models.metadata import SystemType, DataType
from app.services.custom_mapping import CustomMappingService
from loguru import logger
import io


class DataImporter:
    """Service for importing updated metadata mappings"""
    
    def __init__(self):
        self.custom_mapping_service = CustomMappingService()
        self.import_dir = Path("imports")
        self.import_dir.mkdir(exist_ok=True)
    
    async def import_columns_from_csv(
        self,
        file_path: str,
        system_type: SystemType,
        update_mode: str = "update_only"  # "update_only", "create_new", "replace_all"
    ) -> Dict[str, Any]:
        """Import column metadata updates from CSV"""
        try:
            # Read CSV file
            df = pd.read_csv(file_path)
            
            # Validate required columns
            required_columns = ['column_name', 'table_name', 'object_name']
            missing_columns = [col for col in required_columns if col not in df.columns]
            if missing_columns:
                return {
                    'status': 'error',
                    'message': f'Missing required columns: {missing_columns}'
                }
            
            db = next(get_db())
            results = {
                'imported': 0,
                'updated': 0,
                'errors': [],
                'warnings': []
            }
            
            for _, row in df.iterrows():
                try:
                    # Find the column
                    column = db.query(MetadataColumn).join(MetadataTable).join(MetadataObject).filter(
                        MetadataColumn.name == row['column_name'],
                        MetadataTable.name == row['table_name'],
                        MetadataObject.name == row['object_name'],
                        MetadataObject.system_type == system_type
                    ).first()
                    
                    if not column:
                        if update_mode == "create_new":
                            # Create new column (this would require more complex logic)
                            results['warnings'].append(
                                f"Column {row['column_name']} not found - creation not implemented"
                            )
                        else:
                            results['errors'].append(
                                f"Column {row['column_name']} not found in {row['table_name']}"
                            )
                        continue
                    
                    # Update column metadata
                    updated = False
                    
                    if 'custom_data_type' in df.columns and pd.notna(row['custom_data_type']):
                        column.custom_data_type = row['custom_data_type']
                        updated = True
                    
                    if 'custom_label' in df.columns and pd.notna(row['custom_label']):
                        column.custom_label = row['custom_label']
                        updated = True
                    
                    if 'custom_description' in df.columns and pd.notna(row['custom_description']):
                        column.custom_description = row['custom_description']
                        updated = True
                    
                    if 'mapping_notes' in df.columns and pd.notna(row['mapping_notes']):
                        column.mapping_notes = row['mapping_notes']
                        updated = True
                    
                    if 'custom_mapping' in df.columns and pd.notna(row['custom_mapping']):
                        try:
                            custom_mapping = json.loads(row['custom_mapping'])
                            column.custom_mapping = custom_mapping
                            updated = True
                        except json.JSONDecodeError:
                            results['errors'].append(
                                f"Invalid JSON in custom_mapping for {row['column_name']}"
                            )
                    
                    if updated:
                        column.is_custom = True
                        column.updated_at = datetime.utcnow()
                        column.updated_by = row.get('updated_by', 'import')
                        results['updated'] += 1
                    else:
                        results['imported'] += 1
                
                except Exception as e:
                    results['errors'].append(
                        f"Error processing row for {row['column_name']}: {str(e)}"
                    )
            
            db.commit()
            
            return {
                'status': 'success',
                'message': f'Import completed: {results["updated"]} updated, {results["imported"]} processed',
                'results': results
            }
            
        except Exception as e:
            logger.error(f"Error importing columns from CSV: {e}")
            return {
                'status': 'error',
                'message': str(e)
            }
    
    async def import_mappings_from_csv(
        self,
        file_path: str,
        update_mode: str = "update_only"
    ) -> Dict[str, Any]:
        """Import metadata mappings from CSV"""
        try:
            # Read CSV file
            df = pd.read_csv(file_path)
            
            # Validate required columns
            required_columns = ['source_system', 'target_system', 'source_object', 'target_object', 'mapping_type']
            missing_columns = [col for col in required_columns if col not in df.columns]
            if missing_columns:
                return {
                    'status': 'error',
                    'message': f'Missing required columns: {missing_columns}'
                }
            
            db = next(get_db())
            results = {
                'imported': 0,
                'updated': 0,
                'errors': [],
                'warnings': []
            }
            
            for _, row in df.iterrows():
                try:
                    # Check if mapping already exists
                    existing_mapping = db.query(MetadataMapping).filter(
                        MetadataMapping.source_system == row['source_system'],
                        MetadataMapping.target_system == row['target_system'],
                        MetadataMapping.source_object == row['source_object'],
                        MetadataMapping.target_object == row['target_object'],
                        MetadataMapping.mapping_type == row['mapping_type']
                    ).first()
                    
                    if existing_mapping:
                        if update_mode == "replace_all":
                            # Update existing mapping
                            if 'mapping_status' in df.columns and pd.notna(row['mapping_status']):
                                existing_mapping.mapping_status = row['mapping_status']
                            
                            if 'mapping_notes' in df.columns and pd.notna(row['mapping_notes']):
                                existing_mapping.mapping_notes = row['mapping_notes']
                            
                            if 'custom_transformation' in df.columns and pd.notna(row['custom_transformation']):
                                try:
                                    custom_transformation = json.loads(row['custom_transformation'])
                                    existing_mapping.custom_transformation = custom_transformation
                                except json.JSONDecodeError:
                                    results['errors'].append(
                                        f"Invalid JSON in custom_transformation for mapping {row['source_object']} -> {row['target_object']}"
                                    )
                            
                            if 'approved_by' in df.columns and pd.notna(row['approved_by']):
                                existing_mapping.approved_by = row['approved_by']
                                existing_mapping.approved_at = datetime.utcnow()
                            
                            existing_mapping.updated_at = datetime.utcnow()
                            results['updated'] += 1
                        else:
                            results['warnings'].append(
                                f"Mapping already exists: {row['source_object']} -> {row['target_object']}"
                            )
                    else:
                        # Create new mapping
                        new_mapping = MetadataMapping(
                            source_system=row['source_system'],
                            target_system=row['target_system'],
                            source_object=row['source_object'],
                            target_object=row['target_object'],
                            source_table=row.get('source_table'),
                            target_table=row.get('target_table'),
                            source_column=row.get('source_column'),
                            target_column=row.get('target_column'),
                            mapping_type=row['mapping_type'],
                            mapping_status=row.get('mapping_status', 'pending'),
                            mapping_notes=row.get('mapping_notes'),
                            created_by=row.get('created_by', 'import')
                        )
                        
                        if 'custom_transformation' in df.columns and pd.notna(row['custom_transformation']):
                            try:
                                custom_transformation = json.loads(row['custom_transformation'])
                                new_mapping.custom_transformation = custom_transformation
                            except json.JSONDecodeError:
                                results['errors'].append(
                                    f"Invalid JSON in custom_transformation for mapping {row['source_object']} -> {row['target_object']}"
                                )
                        
                        if 'confidence_score' in df.columns and pd.notna(row['confidence_score']):
                            new_mapping.confidence_score = float(row['confidence_score'])
                        
                        db.add(new_mapping)
                        results['imported'] += 1
                
                except Exception as e:
                    results['errors'].append(
                        f"Error processing mapping {row['source_object']} -> {row['target_object']}: {str(e)}"
                    )
            
            db.commit()
            
            return {
                'status': 'success',
                'message': f'Import completed: {results["imported"]} imported, {results["updated"]} updated',
                'results': results
            }
            
        except Exception as e:
            logger.error(f"Error importing mappings from CSV: {e}")
            return {
                'status': 'error',
                'message': str(e)
            }
    
    async def import_from_excel(
        self,
        file_path: str,
        system_type: SystemType,
        sheets_to_import: List[str] = None
    ) -> Dict[str, Any]:
        """Import metadata from Excel file with multiple sheets"""
        try:
            # Read Excel file
            excel_file = pd.ExcelFile(file_path)
            
            if sheets_to_import is None:
                sheets_to_import = excel_file.sheet_names
            
            results = {
                'sheets_processed': 0,
                'total_imported': 0,
                'total_updated': 0,
                'errors': [],
                'warnings': []
            }
            
            for sheet_name in sheets_to_import:
                if sheet_name not in excel_file.sheet_names:
                    results['warnings'].append(f"Sheet {sheet_name} not found in Excel file")
                    continue
                
                try:
                    df = pd.read_excel(file_path, sheet_name=sheet_name)
                    
                    if sheet_name.lower() == 'columns':
                        result = await self.import_columns_from_csv(
                            df.to_csv(index=False), system_type
                        )
                    elif sheet_name.lower() == 'mappings':
                        result = await self.import_mappings_from_csv(
                            df.to_csv(index=False)
                        )
                    else:
                        results['warnings'].append(f"Sheet {sheet_name} not supported for import")
                        continue
                    
                    if result['status'] == 'success':
                        results['sheets_processed'] += 1
                        if 'results' in result:
                            results['total_imported'] += result['results'].get('imported', 0)
                            results['total_updated'] += result['results'].get('updated', 0)
                            results['errors'].extend(result['results'].get('errors', []))
                            results['warnings'].extend(result['results'].get('warnings', []))
                    else:
                        results['errors'].append(f"Error processing sheet {sheet_name}: {result['message']}")
                
                except Exception as e:
                    results['errors'].append(f"Error processing sheet {sheet_name}: {str(e)}")
            
            return {
                'status': 'success',
                'message': f'Excel import completed: {results["sheets_processed"]} sheets processed',
                'results': results
            }
            
        except Exception as e:
            logger.error(f"Error importing from Excel: {e}")
            return {
                'status': 'error',
                'message': str(e)
            }
    
    async def import_from_json(
        self,
        file_path: str,
        system_type: SystemType
    ) -> Dict[str, Any]:
        """Import metadata from JSON file"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            results = {
                'objects_processed': 0,
                'tables_processed': 0,
                'columns_processed': 0,
                'mappings_processed': 0,
                'errors': [],
                'warnings': []
            }
            
            # Process objects
            if 'objects' in data:
                for obj_data in data['objects']:
                    try:
                        result = await self._import_object_from_json(obj_data, system_type)
                        if result['status'] == 'success':
                            results['objects_processed'] += 1
                        else:
                            results['errors'].append(result['message'])
                    except Exception as e:
                        results['errors'].append(f"Error processing object {obj_data.get('name', 'unknown')}: {str(e)}")
            
            # Process tables
            if 'tables' in data:
                for table_data in data['tables']:
                    try:
                        result = await self._import_table_from_json(table_data, system_type)
                        if result['status'] == 'success':
                            results['tables_processed'] += 1
                        else:
                            results['errors'].append(result['message'])
                    except Exception as e:
                        results['errors'].append(f"Error processing table {table_data.get('name', 'unknown')}: {str(e)}")
            
            # Process columns
            if 'columns' in data:
                for col_data in data['columns']:
                    try:
                        result = await self._import_column_from_json(col_data, system_type)
                        if result['status'] == 'success':
                            results['columns_processed'] += 1
                        else:
                            results['errors'].append(result['message'])
                    except Exception as e:
                        results['errors'].append(f"Error processing column {col_data.get('name', 'unknown')}: {str(e)}")
            
            # Process mappings
            if 'mappings' in data:
                for mapping_data in data['mappings']:
                    try:
                        result = await self._import_mapping_from_json(mapping_data)
                        if result['status'] == 'success':
                            results['mappings_processed'] += 1
                        else:
                            results['errors'].append(result['message'])
                    except Exception as e:
                        results['errors'].append(f"Error processing mapping: {str(e)}")
            
            return {
                'status': 'success',
                'message': 'JSON import completed',
                'results': results
            }
            
        except Exception as e:
            logger.error(f"Error importing from JSON: {e}")
            return {
                'status': 'error',
                'message': str(e)
            }
    
    async def _import_object_from_json(self, obj_data: Dict[str, Any], system_type: SystemType) -> Dict[str, Any]:
        """Import object from JSON data"""
        try:
            db = next(get_db())
            
            obj = db.query(MetadataObject).filter(
                MetadataObject.name == obj_data['name'],
                MetadataObject.system_type == system_type
            ).first()
            
            if not obj:
                return {'status': 'error', 'message': f"Object {obj_data['name']} not found"}
            
            # Update custom mapping if provided
            if 'custom_mapping' in obj_data and obj_data['custom_mapping']:
                obj.custom_mapping = obj_data['custom_mapping']
                obj.is_custom = True
                obj.updated_at = datetime.utcnow()
            
            db.commit()
            return {'status': 'success'}
            
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    async def _import_table_from_json(self, table_data: Dict[str, Any], system_type: SystemType) -> Dict[str, Any]:
        """Import table from JSON data"""
        try:
            db = next(get_db())
            
            table = db.query(MetadataTable).filter(
                MetadataTable.name == table_data['name'],
                MetadataTable.system_type == system_type
            ).first()
            
            if not table:
                return {'status': 'error', 'message': f"Table {table_data['name']} not found"}
            
            # Update custom mapping if provided
            if 'custom_mapping' in table_data and table_data['custom_mapping']:
                table.custom_mapping = table_data['custom_mapping']
                table.is_custom = True
                table.updated_at = datetime.utcnow()
            
            db.commit()
            return {'status': 'success'}
            
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    async def _import_column_from_json(self, col_data: Dict[str, Any], system_type: SystemType) -> Dict[str, Any]:
        """Import column from JSON data"""
        try:
            db = next(get_db())
            
            column = db.query(MetadataColumn).join(MetadataTable).filter(
                MetadataColumn.name == col_data['name'],
                MetadataTable.name == col_data['table_name'],
                MetadataTable.system_type == system_type
            ).first()
            
            if not column:
                return {'status': 'error', 'message': f"Column {col_data['name']} not found"}
            
            # Update custom fields
            updated = False
            if 'custom_data_type' in col_data and col_data['custom_data_type']:
                column.custom_data_type = col_data['custom_data_type']
                updated = True
            
            if 'custom_label' in col_data and col_data['custom_label']:
                column.custom_label = col_data['custom_label']
                updated = True
            
            if 'custom_description' in col_data and col_data['custom_description']:
                column.custom_description = col_data['custom_description']
                updated = True
            
            if 'mapping_notes' in col_data and col_data['mapping_notes']:
                column.mapping_notes = col_data['mapping_notes']
                updated = True
            
            if 'custom_mapping' in col_data and col_data['custom_mapping']:
                column.custom_mapping = col_data['custom_mapping']
                updated = True
            
            if updated:
                column.is_custom = True
                column.updated_at = datetime.utcnow()
                column.updated_by = col_data.get('updated_by', 'import')
            
            db.commit()
            return {'status': 'success'}
            
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    async def _import_mapping_from_json(self, mapping_data: Dict[str, Any]) -> Dict[str, Any]:
        """Import mapping from JSON data"""
        try:
            db = next(get_db())
            
            # Check if mapping exists
            existing_mapping = db.query(MetadataMapping).filter(
                MetadataMapping.source_system == mapping_data['source_system'],
                MetadataMapping.target_system == mapping_data['target_system'],
                MetadataMapping.source_object == mapping_data['source_object'],
                MetadataMapping.target_object == mapping_data['target_object'],
                MetadataMapping.mapping_type == mapping_data['mapping_type']
            ).first()
            
            if existing_mapping:
                # Update existing mapping
                if 'mapping_status' in mapping_data:
                    existing_mapping.mapping_status = mapping_data['mapping_status']
                if 'mapping_notes' in mapping_data:
                    existing_mapping.mapping_notes = mapping_data['mapping_notes']
                if 'custom_transformation' in mapping_data:
                    existing_mapping.custom_transformation = mapping_data['custom_transformation']
                existing_mapping.updated_at = datetime.utcnow()
            else:
                # Create new mapping
                new_mapping = MetadataMapping(
                    source_system=mapping_data['source_system'],
                    target_system=mapping_data['target_system'],
                    source_object=mapping_data['source_object'],
                    target_object=mapping_data['target_object'],
                    source_table=mapping_data.get('source_table'),
                    target_table=mapping_data.get('target_table'),
                    source_column=mapping_data.get('source_column'),
                    target_column=mapping_data.get('target_column'),
                    mapping_type=mapping_data['mapping_type'],
                    mapping_status=mapping_data.get('mapping_status', 'pending'),
                    mapping_notes=mapping_data.get('mapping_notes'),
                    custom_transformation=mapping_data.get('custom_transformation'),
                    created_by=mapping_data.get('created_by', 'import')
                )
                db.add(new_mapping)
            
            db.commit()
            return {'status': 'success'}
            
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    def get_import_templates(self) -> Dict[str, Any]:
        """Get import templates for different file types"""
        templates = {
            'columns_csv': {
                'description': 'CSV template for importing column metadata updates',
                'required_columns': ['column_name', 'table_name', 'object_name'],
                'optional_columns': [
                    'custom_data_type', 'custom_label', 'custom_description',
                    'mapping_notes', 'custom_mapping', 'updated_by'
                ],
                'sample_data': [
                    {
                        'column_name': 'AccountName',
                        'table_name': 'Account',
                        'object_name': 'Account',
                        'custom_data_type': 'string',
                        'custom_label': 'Account Name',
                        'custom_description': 'Name of the account',
                        'mapping_notes': 'Maps to SAP KNA1.NAME1',
                        'updated_by': 'admin'
                    }
                ]
            },
            'mappings_csv': {
                'description': 'CSV template for importing metadata mappings',
                'required_columns': ['source_system', 'target_system', 'source_object', 'target_object', 'mapping_type'],
                'optional_columns': [
                    'source_table', 'target_table', 'source_column', 'target_column',
                    'mapping_status', 'mapping_notes', 'custom_transformation',
                    'confidence_score', 'created_by', 'approved_by'
                ],
                'sample_data': [
                    {
                        'source_system': 'salesforce',
                        'target_system': 'sap',
                        'source_object': 'Account',
                        'target_object': 'KNA1',
                        'mapping_type': 'object',
                        'mapping_status': 'approved',
                        'mapping_notes': 'Customer master mapping',
                        'created_by': 'admin'
                    }
                ]
            }
        }
        
        return templates