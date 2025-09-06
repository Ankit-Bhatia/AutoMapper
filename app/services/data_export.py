import pandas as pd
import json
import csv
from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path
from app.database.models import MetadataObject, MetadataTable, MetadataColumn, MetadataMapping
from app.database.connection import get_db
from loguru import logger
import io


class DataExporter:
    """Service for exporting metadata to various formats"""
    
    def __init__(self):
        self.export_dir = Path("exports")
        self.export_dir.mkdir(exist_ok=True)
    
    async def export_objects_to_csv(
        self, 
        system_type: Optional[str] = None,
        include_custom_mappings: bool = True
    ) -> str:
        """Export metadata objects to CSV"""
        try:
            db = next(get_db())
            
            query = db.query(MetadataObject)
            if system_type:
                query = query.filter(MetadataObject.system_type == system_type)
            
            objects = query.all()
            
            # Prepare data for CSV
            data = []
            for obj in objects:
                row = {
                    'object_name': obj.name,
                    'label': obj.label,
                    'description': obj.description,
                    'system_type': obj.system_type,
                    'is_custom': obj.is_custom,
                    'last_extracted': obj.last_extracted.isoformat() if obj.last_extracted else None,
                    'created_at': obj.created_at.isoformat() if obj.created_at else None,
                    'updated_at': obj.updated_at.isoformat() if obj.updated_at else None
                }
                
                if include_custom_mappings and obj.custom_mapping:
                    row['custom_mapping'] = json.dumps(obj.custom_mapping)
                
                data.append(row)
            
            # Create DataFrame and export
            df = pd.DataFrame(data)
            filename = f"metadata_objects_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            filepath = self.export_dir / filename
            
            df.to_csv(filepath, index=False)
            logger.info(f"Exported {len(objects)} objects to {filepath}")
            
            return str(filepath)
            
        except Exception as e:
            logger.error(f"Error exporting objects to CSV: {e}")
            raise
    
    async def export_tables_to_csv(
        self, 
        system_type: Optional[str] = None,
        object_name: Optional[str] = None,
        include_custom_mappings: bool = True
    ) -> str:
        """Export metadata tables to CSV"""
        try:
            db = next(get_db())
            
            query = db.query(MetadataTable)
            if system_type:
                query = query.filter(MetadataTable.system_type == system_type)
            if object_name:
                query = query.join(MetadataObject).filter(MetadataObject.name == object_name)
            
            tables = query.all()
            
            # Prepare data for CSV
            data = []
            for table in tables:
                row = {
                    'table_name': table.name,
                    'label': table.label,
                    'description': table.description,
                    'system_type': table.system_type,
                    'object_name': table.object_ref.name if table.object_ref else None,
                    'is_custom': table.is_custom,
                    'last_extracted': table.last_extracted.isoformat() if table.last_extracted else None,
                    'created_at': table.created_at.isoformat() if table.created_at else None,
                    'updated_at': table.updated_at.isoformat() if table.updated_at else None
                }
                
                if include_custom_mappings and table.custom_mapping:
                    row['custom_mapping'] = json.dumps(table.custom_mapping)
                
                data.append(row)
            
            # Create DataFrame and export
            df = pd.DataFrame(data)
            filename = f"metadata_tables_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            filepath = self.export_dir / filename
            
            df.to_csv(filepath, index=False)
            logger.info(f"Exported {len(tables)} tables to {filepath}")
            
            return str(filepath)
            
        except Exception as e:
            logger.error(f"Error exporting tables to CSV: {e}")
            raise
    
    async def export_columns_to_csv(
        self, 
        system_type: Optional[str] = None,
        table_name: Optional[str] = None,
        include_custom_mappings: bool = True
    ) -> str:
        """Export metadata columns to CSV"""
        try:
            db = next(get_db())
            
            query = db.query(MetadataColumn)
            if system_type:
                query = query.filter(MetadataColumn.system_connection_id.in_(
                    db.query(MetadataObject.system_connection_id).filter(
                        MetadataObject.system_type == system_type
                    )
                ))
            if table_name:
                query = query.join(MetadataTable).filter(MetadataTable.name == table_name)
            
            columns = query.all()
            
            # Prepare data for CSV
            data = []
            for col in columns:
                row = {
                    'column_name': col.name,
                    'label': col.label,
                    'description': col.description,
                    'data_type': col.data_type,
                    'length': col.length,
                    'precision': col.precision,
                    'scale': col.scale,
                    'nullable': col.nullable,
                    'unique': col.unique,
                    'primary_key': col.primary_key,
                    'foreign_key': col.foreign_key,
                    'referenced_table': col.referenced_table,
                    'referenced_column': col.referenced_column,
                    'default_value': col.default_value,
                    'table_name': col.table_ref.name if col.table_ref else None,
                    'object_name': col.table_ref.object_ref.name if col.table_ref and col.table_ref.object_ref else None,
                    'system_type': col.table_ref.system_type if col.table_ref else None,
                    'is_custom': col.is_custom,
                    'custom_data_type': col.custom_data_type,
                    'custom_label': col.custom_label,
                    'custom_description': col.custom_description,
                    'mapping_notes': col.mapping_notes,
                    'last_extracted': col.last_extracted.isoformat() if col.last_extracted else None,
                    'created_at': col.created_at.isoformat() if col.created_at else None,
                    'updated_at': col.updated_at.isoformat() if col.updated_at else None,
                    'updated_by': col.updated_by
                }
                
                if include_custom_mappings and col.custom_mapping:
                    row['custom_mapping'] = json.dumps(col.custom_mapping)
                
                if col.picklist_values:
                    row['picklist_values'] = json.dumps(col.picklist_values)
                
                if col.system_attributes:
                    row['system_attributes'] = json.dumps(col.system_attributes)
                
                data.append(row)
            
            # Create DataFrame and export
            df = pd.DataFrame(data)
            filename = f"metadata_columns_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            filepath = self.export_dir / filename
            
            df.to_csv(filepath, index=False)
            logger.info(f"Exported {len(columns)} columns to {filepath}")
            
            return str(filepath)
            
        except Exception as e:
            logger.error(f"Error exporting columns to CSV: {e}")
            raise
    
    async def export_mappings_to_csv(
        self, 
        source_system: Optional[str] = None,
        target_system: Optional[str] = None,
        mapping_type: Optional[str] = None
    ) -> str:
        """Export metadata mappings to CSV"""
        try:
            db = next(get_db())
            
            query = db.query(MetadataMapping)
            if source_system:
                query = query.filter(MetadataMapping.source_system == source_system)
            if target_system:
                query = query.filter(MetadataMapping.target_system == target_system)
            if mapping_type:
                query = query.filter(MetadataMapping.mapping_type == mapping_type)
            
            mappings = query.all()
            
            # Prepare data for CSV
            data = []
            for mapping in mappings:
                row = {
                    'source_system': mapping.source_system,
                    'target_system': mapping.target_system,
                    'source_object': mapping.source_object,
                    'target_object': mapping.target_object,
                    'source_table': mapping.source_table,
                    'target_table': mapping.target_table,
                    'source_column': mapping.source_column,
                    'target_column': mapping.target_column,
                    'mapping_type': mapping.mapping_type,
                    'mapping_status': mapping.mapping_status,
                    'confidence_score': mapping.confidence_score,
                    'mapping_notes': mapping.mapping_notes,
                    'created_at': mapping.created_at.isoformat() if mapping.created_at else None,
                    'updated_at': mapping.updated_at.isoformat() if mapping.updated_at else None,
                    'created_by': mapping.created_by,
                    'approved_by': mapping.approved_by,
                    'approved_at': mapping.approved_at.isoformat() if mapping.approved_at else None
                }
                
                if mapping.custom_transformation:
                    row['custom_transformation'] = json.dumps(mapping.custom_transformation)
                
                data.append(row)
            
            # Create DataFrame and export
            df = pd.DataFrame(data)
            filename = f"metadata_mappings_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            filepath = self.export_dir / filename
            
            df.to_csv(filepath, index=False)
            logger.info(f"Exported {len(mappings)} mappings to {filepath}")
            
            return str(filepath)
            
        except Exception as e:
            logger.error(f"Error exporting mappings to CSV: {e}")
            raise
    
    async def export_complete_metadata_to_excel(
        self, 
        system_type: Optional[str] = None,
        include_custom_mappings: bool = True
    ) -> str:
        """Export complete metadata to Excel with multiple sheets"""
        try:
            db = next(get_db())
            
            filename = f"complete_metadata_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
            filepath = self.export_dir / filename
            
            with pd.ExcelWriter(filepath, engine='openpyxl') as writer:
                # Objects sheet
                objects_query = db.query(MetadataObject)
                if system_type:
                    objects_query = objects_query.filter(MetadataObject.system_type == system_type)
                
                objects_data = []
                for obj in objects_query.all():
                    row = {
                        'object_name': obj.name,
                        'label': obj.label,
                        'description': obj.description,
                        'system_type': obj.system_type,
                        'is_custom': obj.is_custom,
                        'last_extracted': obj.last_extracted.isoformat() if obj.last_extracted else None
                    }
                    if include_custom_mappings and obj.custom_mapping:
                        row['custom_mapping'] = json.dumps(obj.custom_mapping)
                    objects_data.append(row)
                
                if objects_data:
                    pd.DataFrame(objects_data).to_excel(writer, sheet_name='Objects', index=False)
                
                # Tables sheet
                tables_query = db.query(MetadataTable)
                if system_type:
                    tables_query = tables_query.filter(MetadataTable.system_type == system_type)
                
                tables_data = []
                for table in tables_query.all():
                    row = {
                        'table_name': table.name,
                        'label': table.label,
                        'description': table.description,
                        'system_type': table.system_type,
                        'object_name': table.object_ref.name if table.object_ref else None,
                        'is_custom': table.is_custom,
                        'last_extracted': table.last_extracted.isoformat() if table.last_extracted else None
                    }
                    if include_custom_mappings and table.custom_mapping:
                        row['custom_mapping'] = json.dumps(table.custom_mapping)
                    tables_data.append(row)
                
                if tables_data:
                    pd.DataFrame(tables_data).to_excel(writer, sheet_name='Tables', index=False)
                
                # Columns sheet
                columns_query = db.query(MetadataColumn)
                if system_type:
                    columns_query = columns_query.filter(MetadataColumn.system_connection_id.in_(
                        db.query(MetadataObject.system_connection_id).filter(
                            MetadataObject.system_type == system_type
                        )
                    ))
                
                columns_data = []
                for col in columns_query.all():
                    row = {
                        'column_name': col.name,
                        'label': col.label,
                        'description': col.description,
                        'data_type': col.data_type,
                        'length': col.length,
                        'precision': col.precision,
                        'scale': col.scale,
                        'nullable': col.nullable,
                        'unique': col.unique,
                        'primary_key': col.primary_key,
                        'foreign_key': col.foreign_key,
                        'referenced_table': col.referenced_table,
                        'referenced_column': col.referenced_column,
                        'default_value': col.default_value,
                        'table_name': col.table_ref.name if col.table_ref else None,
                        'object_name': col.table_ref.object_ref.name if col.table_ref and col.table_ref.object_ref else None,
                        'system_type': col.table_ref.system_type if col.table_ref else None,
                        'is_custom': col.is_custom,
                        'custom_data_type': col.custom_data_type,
                        'custom_label': col.custom_label,
                        'custom_description': col.custom_description,
                        'mapping_notes': col.mapping_notes,
                        'updated_by': col.updated_by
                    }
                    if include_custom_mappings and col.custom_mapping:
                        row['custom_mapping'] = json.dumps(col.custom_mapping)
                    if col.picklist_values:
                        row['picklist_values'] = json.dumps(col.picklist_values)
                    if col.system_attributes:
                        row['system_attributes'] = json.dumps(col.system_attributes)
                    columns_data.append(row)
                
                if columns_data:
                    pd.DataFrame(columns_data).to_excel(writer, sheet_name='Columns', index=False)
                
                # Mappings sheet
                mappings_data = []
                for mapping in db.query(MetadataMapping).all():
                    row = {
                        'source_system': mapping.source_system,
                        'target_system': mapping.target_system,
                        'source_object': mapping.source_object,
                        'target_object': mapping.target_object,
                        'source_table': mapping.source_table,
                        'target_table': mapping.target_table,
                        'source_column': mapping.source_column,
                        'target_column': mapping.target_column,
                        'mapping_type': mapping.mapping_type,
                        'mapping_status': mapping.mapping_status,
                        'confidence_score': mapping.confidence_score,
                        'mapping_notes': mapping.mapping_notes,
                        'created_by': mapping.created_by,
                        'approved_by': mapping.approved_by
                    }
                    if mapping.custom_transformation:
                        row['custom_transformation'] = json.dumps(mapping.custom_transformation)
                    mappings_data.append(row)
                
                if mappings_data:
                    pd.DataFrame(mappings_data).to_excel(writer, sheet_name='Mappings', index=False)
            
            logger.info(f"Exported complete metadata to {filepath}")
            return str(filepath)
            
        except Exception as e:
            logger.error(f"Error exporting complete metadata to Excel: {e}")
            raise
    
    async def export_to_json(
        self, 
        system_type: Optional[str] = None,
        include_custom_mappings: bool = True
    ) -> str:
        """Export metadata to JSON format"""
        try:
            db = next(get_db())
            
            # Build complete metadata structure
            metadata = {
                'export_timestamp': datetime.utcnow().isoformat(),
                'system_type': system_type,
                'include_custom_mappings': include_custom_mappings,
                'objects': [],
                'tables': [],
                'columns': [],
                'mappings': []
            }
            
            # Objects
            objects_query = db.query(MetadataObject)
            if system_type:
                objects_query = objects_query.filter(MetadataObject.system_type == system_type)
            
            for obj in objects_query.all():
                obj_data = {
                    'name': obj.name,
                    'label': obj.label,
                    'description': obj.description,
                    'system_type': obj.system_type,
                    'is_custom': obj.is_custom,
                    'last_extracted': obj.last_extracted.isoformat() if obj.last_extracted else None
                }
                if include_custom_mappings and obj.custom_mapping:
                    obj_data['custom_mapping'] = obj.custom_mapping
                metadata['objects'].append(obj_data)
            
            # Tables
            tables_query = db.query(MetadataTable)
            if system_type:
                tables_query = tables_query.filter(MetadataTable.system_type == system_type)
            
            for table in tables_query.all():
                table_data = {
                    'name': table.name,
                    'label': table.label,
                    'description': table.description,
                    'system_type': table.system_type,
                    'object_name': table.object_ref.name if table.object_ref else None,
                    'is_custom': table.is_custom,
                    'last_extracted': table.last_extracted.isoformat() if table.last_extracted else None
                }
                if include_custom_mappings and table.custom_mapping:
                    table_data['custom_mapping'] = table.custom_mapping
                metadata['tables'].append(table_data)
            
            # Columns
            columns_query = db.query(MetadataColumn)
            if system_type:
                columns_query = columns_query.filter(MetadataColumn.system_connection_id.in_(
                    db.query(MetadataObject.system_connection_id).filter(
                        MetadataObject.system_type == system_type
                    )
                ))
            
            for col in columns_query.all():
                col_data = {
                    'name': col.name,
                    'label': col.label,
                    'description': col.description,
                    'data_type': col.data_type,
                    'length': col.length,
                    'precision': col.precision,
                    'scale': col.scale,
                    'nullable': col.nullable,
                    'unique': col.unique,
                    'primary_key': col.primary_key,
                    'foreign_key': col.foreign_key,
                    'referenced_table': col.referenced_table,
                    'referenced_column': col.referenced_column,
                    'default_value': col.default_value,
                    'table_name': col.table_ref.name if col.table_ref else None,
                    'object_name': col.table_ref.object_ref.name if col.table_ref and col.table_ref.object_ref else None,
                    'system_type': col.table_ref.system_type if col.table_ref else None,
                    'is_custom': col.is_custom,
                    'custom_data_type': col.custom_data_type,
                    'custom_label': col.custom_label,
                    'custom_description': col.custom_description,
                    'mapping_notes': col.mapping_notes,
                    'updated_by': col.updated_by
                }
                if include_custom_mappings and col.custom_mapping:
                    col_data['custom_mapping'] = col.custom_mapping
                if col.picklist_values:
                    col_data['picklist_values'] = col.picklist_values
                if col.system_attributes:
                    col_data['system_attributes'] = col.system_attributes
                metadata['columns'].append(col_data)
            
            # Mappings
            for mapping in db.query(MetadataMapping).all():
                mapping_data = {
                    'source_system': mapping.source_system,
                    'target_system': mapping.target_system,
                    'source_object': mapping.source_object,
                    'target_object': mapping.target_object,
                    'source_table': mapping.source_table,
                    'target_table': mapping.target_table,
                    'source_column': mapping.source_column,
                    'target_column': mapping.target_column,
                    'mapping_type': mapping.mapping_type,
                    'mapping_status': mapping.mapping_status,
                    'confidence_score': mapping.confidence_score,
                    'mapping_notes': mapping.mapping_notes,
                    'created_by': mapping.created_by,
                    'approved_by': mapping.approved_by
                }
                if mapping.custom_transformation:
                    mapping_data['custom_transformation'] = mapping.custom_transformation
                metadata['mappings'].append(mapping_data)
            
            # Write to file
            filename = f"metadata_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = self.export_dir / filename
            
            with open(filepath, 'w') as f:
                json.dump(metadata, f, indent=2, default=str)
            
            logger.info(f"Exported metadata to {filepath}")
            return str(filepath)
            
        except Exception as e:
            logger.error(f"Error exporting metadata to JSON: {e}")
            raise
    
    def get_export_files(self) -> List[Dict[str, Any]]:
        """Get list of available export files"""
        try:
            files = []
            for file_path in self.export_dir.glob("*"):
                if file_path.is_file():
                    stat = file_path.stat()
                    files.append({
                        'filename': file_path.name,
                        'filepath': str(file_path),
                        'size_bytes': stat.st_size,
                        'created_at': datetime.fromtimestamp(stat.st_ctime).isoformat(),
                        'modified_at': datetime.fromtimestamp(stat.st_mtime).isoformat()
                    })
            
            return sorted(files, key=lambda x: x['modified_at'], reverse=True)
            
        except Exception as e:
            logger.error(f"Error getting export files: {e}")
            return []