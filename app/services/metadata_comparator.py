from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from app.models.metadata import (
    ObjectMetadata, TableMetadata, ColumnMetadata, 
    MetadataComparison, SystemType, DataType
)
from loguru import logger


class MetadataComparator:
    """Service for comparing metadata between different systems"""
    
    def __init__(self):
        self.comparison_cache = {}
    
    async def compare_objects(
        self, 
        source_objects: List[ObjectMetadata], 
        target_objects: List[ObjectMetadata],
        source_system: SystemType,
        target_system: SystemType
    ) -> List[MetadataComparison]:
        """Compare objects between two systems"""
        comparisons = []
        
        # Create lookup dictionaries for faster comparison
        source_lookup = {obj.name: obj for obj in source_objects}
        target_lookup = {obj.name: obj for obj in target_objects}
        
        # Get all unique object names
        all_object_names = set(source_lookup.keys()) | set(target_lookup.keys())
        
        for object_name in all_object_names:
            source_obj = source_lookup.get(object_name)
            target_obj = target_lookup.get(object_name)
            
            comparison = await self._compare_single_object(
                object_name, source_obj, target_obj, source_system, target_system
            )
            comparisons.append(comparison)
        
        return comparisons
    
    async def compare_tables(
        self, 
        source_tables: List[TableMetadata], 
        target_tables: List[TableMetadata],
        source_system: SystemType,
        target_system: SystemType
    ) -> List[MetadataComparison]:
        """Compare tables between two systems"""
        comparisons = []
        
        # Create lookup dictionaries
        source_lookup = {table.name: table for table in source_tables}
        target_lookup = {table.name: table for table in target_tables}
        
        # Get all unique table names
        all_table_names = set(source_lookup.keys()) | set(target_lookup.keys())
        
        for table_name in all_table_names:
            source_table = source_lookup.get(table_name)
            target_table = target_lookup.get(table_name)
            
            comparison = await self._compare_single_table(
                table_name, source_table, target_table, source_system, target_system
            )
            comparisons.append(comparison)
        
        return comparisons
    
    async def _compare_single_object(
        self,
        object_name: str,
        source_obj: Optional[ObjectMetadata],
        target_obj: Optional[ObjectMetadata],
        source_system: SystemType,
        target_system: SystemType
    ) -> MetadataComparison:
        """Compare a single object between systems"""
        differences = []
        status = "identical"
        
        if source_obj is None:
            status = "missing_in_source"
            differences.append({
                "type": "object_missing",
                "message": f"Object {object_name} exists in {target_system} but not in {source_system}",
                "target_details": {
                    "label": target_obj.label,
                    "description": target_obj.description,
                    "system_attributes": target_obj.system_attributes
                }
            })
        elif target_obj is None:
            status = "missing_in_target"
            differences.append({
                "type": "object_missing",
                "message": f"Object {object_name} exists in {source_system} but not in {target_system}",
                "source_details": {
                    "label": source_obj.label,
                    "description": source_obj.description,
                    "system_attributes": source_obj.system_attributes
                }
            })
        else:
            # Compare object properties
            object_diffs = await self._compare_object_properties(source_obj, target_obj)
            differences.extend(object_diffs)
            
            # Compare tables within the object
            table_diffs = await self._compare_object_tables(source_obj, target_obj)
            differences.extend(table_diffs)
            
            if differences:
                status = "different"
        
        return MetadataComparison(
            source_system=source_system,
            target_system=target_system,
            object_name=object_name,
            differences=differences,
            status=status,
            last_compared=datetime.utcnow()
        )
    
    async def _compare_single_table(
        self,
        table_name: str,
        source_table: Optional[TableMetadata],
        target_table: Optional[TableMetadata],
        source_system: SystemType,
        target_system: SystemType
    ) -> MetadataComparison:
        """Compare a single table between systems"""
        differences = []
        status = "identical"
        
        if source_table is None:
            status = "missing_in_source"
            differences.append({
                "type": "table_missing",
                "message": f"Table {table_name} exists in {target_system} but not in {source_system}",
                "target_details": {
                    "label": target_table.label,
                    "description": target_table.description,
                    "column_count": len(target_table.columns)
                }
            })
        elif target_table is None:
            status = "missing_in_target"
            differences.append({
                "type": "table_missing",
                "message": f"Table {table_name} exists in {source_system} but not in {target_system}",
                "source_details": {
                    "label": source_table.label,
                    "description": source_table.description,
                    "column_count": len(source_table.columns)
                }
            })
        else:
            # Compare table properties
            table_diffs = await self._compare_table_properties(source_table, target_table)
            differences.extend(table_diffs)
            
            # Compare columns
            column_diffs = await self._compare_table_columns(source_table, target_table)
            differences.extend(column_diffs)
            
            if differences:
                status = "different"
        
        return MetadataComparison(
            source_system=source_system,
            target_system=target_system,
            object_name=table_name,
            differences=differences,
            status=status,
            last_compared=datetime.utcnow()
        )
    
    async def _compare_object_properties(
        self, 
        source_obj: ObjectMetadata, 
        target_obj: ObjectMetadata
    ) -> List[Dict[str, Any]]:
        """Compare basic properties of objects"""
        differences = []
        
        # Compare labels
        if source_obj.label != target_obj.label:
            differences.append({
                "type": "property_difference",
                "property": "label",
                "source_value": source_obj.label,
                "target_value": target_obj.label,
                "message": f"Label differs: '{source_obj.label}' vs '{target_obj.label}'"
            })
        
        # Compare descriptions
        if source_obj.description != target_obj.description:
            differences.append({
                "type": "property_difference",
                "property": "description",
                "source_value": source_obj.description,
                "target_value": target_obj.description,
                "message": f"Description differs: '{source_obj.description}' vs '{target_obj.description}'"
            })
        
        return differences
    
    async def _compare_object_tables(
        self, 
        source_obj: ObjectMetadata, 
        target_obj: ObjectMetadata
    ) -> List[Dict[str, Any]]:
        """Compare tables within objects"""
        differences = []
        
        source_table_names = {table.name for table in source_obj.tables}
        target_table_names = {table.name for table in target_obj.tables}
        
        # Find missing tables
        missing_in_target = source_table_names - target_table_names
        missing_in_source = target_table_names - source_table_names
        
        for table_name in missing_in_target:
            differences.append({
                "type": "table_missing",
                "table_name": table_name,
                "message": f"Table {table_name} exists in source object but not in target object"
            })
        
        for table_name in missing_in_source:
            differences.append({
                "type": "table_missing",
                "table_name": table_name,
                "message": f"Table {table_name} exists in target object but not in source object"
            })
        
        # Compare common tables
        common_tables = source_table_names & target_table_names
        for table_name in common_tables:
            source_table = next(t for t in source_obj.tables if t.name == table_name)
            target_table = next(t for t in target_obj.tables if t.name == table_name)
            
            table_diffs = await self._compare_table_properties(source_table, target_table)
            column_diffs = await self._compare_table_columns(source_table, target_table)
            
            differences.extend(table_diffs)
            differences.extend(column_diffs)
        
        return differences
    
    async def _compare_table_properties(
        self, 
        source_table: TableMetadata, 
        target_table: TableMetadata
    ) -> List[Dict[str, Any]]:
        """Compare basic properties of tables"""
        differences = []
        
        # Compare labels
        if source_table.label != target_table.label:
            differences.append({
                "type": "property_difference",
                "property": "label",
                "source_value": source_table.label,
                "target_value": target_table.label,
                "message": f"Table label differs: '{source_table.label}' vs '{target_table.label}'"
            })
        
        # Compare descriptions
        if source_table.description != target_table.description:
            differences.append({
                "type": "property_difference",
                "property": "description",
                "source_value": source_table.description,
                "target_value": target_table.description,
                "message": f"Table description differs: '{source_table.description}' vs '{target_table.description}'"
            })
        
        # Compare column counts
        if len(source_table.columns) != len(target_table.columns):
            differences.append({
                "type": "column_count_difference",
                "source_count": len(source_table.columns),
                "target_count": len(target_table.columns),
                "message": f"Column count differs: {len(source_table.columns)} vs {len(target_table.columns)}"
            })
        
        return differences
    
    async def _compare_table_columns(
        self, 
        source_table: TableMetadata, 
        target_table: TableMetadata
    ) -> List[Dict[str, Any]]:
        """Compare columns between tables"""
        differences = []
        
        source_columns = {col.name: col for col in source_table.columns}
        target_columns = {col.name: col for col in target_table.columns}
        
        # Find missing columns
        missing_in_target = set(source_columns.keys()) - set(target_columns.keys())
        missing_in_source = set(target_columns.keys()) - set(source_columns.keys())
        
        for col_name in missing_in_target:
            differences.append({
                "type": "column_missing",
                "column_name": col_name,
                "message": f"Column {col_name} exists in source table but not in target table",
                "source_details": {
                    "data_type": source_columns[col_name].data_type,
                    "label": source_columns[col_name].label
                }
            })
        
        for col_name in missing_in_source:
            differences.append({
                "type": "column_missing",
                "column_name": col_name,
                "message": f"Column {col_name} exists in target table but not in source table",
                "target_details": {
                    "data_type": target_columns[col_name].data_type,
                    "label": target_columns[col_name].label
                }
            })
        
        # Compare common columns
        common_columns = set(source_columns.keys()) & set(target_columns.keys())
        for col_name in common_columns:
            source_col = source_columns[col_name]
            target_col = target_columns[col_name]
            
            column_diffs = await self._compare_column_properties(source_col, target_col)
            differences.extend(column_diffs)
        
        return differences
    
    async def _compare_column_properties(
        self, 
        source_col: ColumnMetadata, 
        target_col: ColumnMetadata
    ) -> List[Dict[str, Any]]:
        """Compare properties of individual columns"""
        differences = []
        
        # Compare data types
        if source_col.data_type != target_col.data_type:
            differences.append({
                "type": "column_property_difference",
                "column_name": source_col.name,
                "property": "data_type",
                "source_value": source_col.data_type,
                "target_value": target_col.data_type,
                "message": f"Data type differs for {source_col.name}: {source_col.data_type} vs {target_col.data_type}"
            })
        
        # Compare lengths
        if source_col.length != target_col.length:
            differences.append({
                "type": "column_property_difference",
                "column_name": source_col.name,
                "property": "length",
                "source_value": source_col.length,
                "target_value": target_col.length,
                "message": f"Length differs for {source_col.name}: {source_col.length} vs {target_col.length}"
            })
        
        # Compare nullable
        if source_col.nullable != target_col.nullable:
            differences.append({
                "type": "column_property_difference",
                "column_name": source_col.name,
                "property": "nullable",
                "source_value": source_col.nullable,
                "target_value": target_col.nullable,
                "message": f"Nullable differs for {source_col.name}: {source_col.nullable} vs {target_col.nullable}"
            })
        
        # Compare primary key
        if source_col.primary_key != target_col.primary_key:
            differences.append({
                "type": "column_property_difference",
                "column_name": source_col.name,
                "property": "primary_key",
                "source_value": source_col.primary_key,
                "target_value": target_col.primary_key,
                "message": f"Primary key differs for {source_col.name}: {source_col.primary_key} vs {target_col.primary_key}"
            })
        
        # Compare foreign key references
        if source_col.foreign_key != target_col.foreign_key:
            differences.append({
                "type": "column_property_difference",
                "column_name": source_col.name,
                "property": "foreign_key",
                "source_value": source_col.foreign_key,
                "target_value": target_col.foreign_key,
                "message": f"Foreign key differs for {source_col.name}: {source_col.foreign_key} vs {target_col.foreign_key}"
            })
        
        if source_col.foreign_key and target_col.foreign_key:
            if source_col.referenced_table != target_col.referenced_table:
                differences.append({
                    "type": "column_property_difference",
                    "column_name": source_col.name,
                    "property": "referenced_table",
                    "source_value": source_col.referenced_table,
                    "target_value": target_col.referenced_table,
                    "message": f"Referenced table differs for {source_col.name}: {source_col.referenced_table} vs {target_col.referenced_table}"
                })
        
        return differences
    
    def get_comparison_summary(self, comparisons: List[MetadataComparison]) -> Dict[str, Any]:
        """Get a summary of comparison results"""
        total = len(comparisons)
        identical = sum(1 for c in comparisons if c.status == "identical")
        different = sum(1 for c in comparisons if c.status == "different")
        missing_in_target = sum(1 for c in comparisons if c.status == "missing_in_target")
        missing_in_source = sum(1 for c in comparisons if c.status == "missing_in_source")
        
        return {
            "total_objects": total,
            "identical": identical,
            "different": different,
            "missing_in_target": missing_in_target,
            "missing_in_source": missing_in_source,
            "sync_percentage": round((identical / total * 100) if total > 0 else 0, 2)
        }