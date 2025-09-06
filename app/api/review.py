from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from app.database.models import MetadataObject, MetadataTable, MetadataColumn, MetadataMapping
from app.database.connection import get_db
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from datetime import datetime
from loguru import logger

router = APIRouter(prefix="/api/v1/review", tags=["review"])


class ColumnUpdateRequest(BaseModel):
    """Request model for updating column metadata"""
    custom_data_type: Optional[str] = None
    custom_label: Optional[str] = None
    custom_description: Optional[str] = None
    mapping_notes: Optional[str] = None
    custom_mapping: Optional[Dict[str, Any]] = None


class MappingUpdateRequest(BaseModel):
    """Request model for updating metadata mappings"""
    mapping_status: Optional[str] = None
    mapping_notes: Optional[str] = None
    custom_transformation: Optional[Dict[str, Any]] = None
    approved_by: Optional[str] = None


class MappingCreateRequest(BaseModel):
    """Request model for creating new metadata mappings"""
    source_system: str
    target_system: str
    source_object: str
    target_object: str
    source_table: Optional[str] = None
    target_table: Optional[str] = None
    source_column: Optional[str] = None
    target_column: Optional[str] = None
    mapping_type: str
    mapping_notes: Optional[str] = None
    custom_transformation: Optional[Dict[str, Any]] = None


@router.get("/objects")
async def get_objects_for_review(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    is_custom: Optional[bool] = Query(None, description="Filter by custom flag"),
    db: Session = Depends(get_db)
):
    """Get objects for review and update"""
    try:
        query = db.query(MetadataObject)
        
        if system_type:
            query = query.filter(MetadataObject.system_type == system_type)
        if is_custom is not None:
            query = query.filter(MetadataObject.is_custom == is_custom)
        
        objects = query.all()
        
        result = []
        for obj in objects:
            obj_data = {
                "id": obj.id,
                "name": obj.name,
                "label": obj.label,
                "description": obj.description,
                "system_type": obj.system_type,
                "is_custom": obj.is_custom,
                "custom_mapping": obj.custom_mapping,
                "last_extracted": obj.last_extracted.isoformat() if obj.last_extracted else None,
                "created_at": obj.created_at.isoformat() if obj.created_at else None,
                "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
                "table_count": len(obj.tables)
            }
            result.append(obj_data)
        
        return {
            "status": "success",
            "objects": result,
            "count": len(result)
        }
    
    except Exception as e:
        logger.error(f"Error getting objects for review: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tables")
async def get_tables_for_review(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    object_name: Optional[str] = Query(None, description="Filter by object name"),
    is_custom: Optional[bool] = Query(None, description="Filter by custom flag"),
    db: Session = Depends(get_db)
):
    """Get tables for review and update"""
    try:
        query = db.query(MetadataTable)
        
        if system_type:
            query = query.filter(MetadataTable.system_type == system_type)
        if object_name:
            query = query.join(MetadataObject).filter(MetadataObject.name == object_name)
        if is_custom is not None:
            query = query.filter(MetadataTable.is_custom == is_custom)
        
        tables = query.all()
        
        result = []
        for table in tables:
            table_data = {
                "id": table.id,
                "name": table.name,
                "label": table.label,
                "description": table.description,
                "system_type": table.system_type,
                "object_name": table.object_ref.name if table.object_ref else None,
                "is_custom": table.is_custom,
                "custom_mapping": table.custom_mapping,
                "last_extracted": table.last_extracted.isoformat() if table.last_extracted else None,
                "created_at": table.created_at.isoformat() if table.created_at else None,
                "updated_at": table.updated_at.isoformat() if table.updated_at else None,
                "column_count": len(table.columns)
            }
            result.append(table_data)
        
        return {
            "status": "success",
            "tables": result,
            "count": len(result)
        }
    
    except Exception as e:
        logger.error(f"Error getting tables for review: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/columns")
async def get_columns_for_review(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    table_name: Optional[str] = Query(None, description="Filter by table name"),
    object_name: Optional[str] = Query(None, description="Filter by object name"),
    is_custom: Optional[bool] = Query(None, description="Filter by custom flag"),
    has_custom_mapping: Optional[bool] = Query(None, description="Filter by custom mapping presence"),
    db: Session = Depends(get_db)
):
    """Get columns for review and update"""
    try:
        query = db.query(MetadataColumn)
        
        if system_type:
            query = query.filter(MetadataColumn.system_connection_id.in_(
                db.query(MetadataObject.system_connection_id).filter(
                    MetadataObject.system_type == system_type
                )
            ))
        if table_name:
            query = query.join(MetadataTable).filter(MetadataTable.name == table_name)
        if object_name:
            query = query.join(MetadataTable).join(MetadataObject).filter(MetadataObject.name == object_name)
        if is_custom is not None:
            query = query.filter(MetadataColumn.is_custom == is_custom)
        if has_custom_mapping is not None:
            if has_custom_mapping:
                query = query.filter(
                    or_(
                        MetadataColumn.custom_mapping.isnot(None),
                        MetadataColumn.custom_data_type.isnot(None),
                        MetadataColumn.custom_label.isnot(None),
                        MetadataColumn.custom_description.isnot(None),
                        MetadataColumn.mapping_notes.isnot(None)
                    )
                )
            else:
                query = query.filter(
                    and_(
                        MetadataColumn.custom_mapping.is_(None),
                        MetadataColumn.custom_data_type.is_(None),
                        MetadataColumn.custom_label.is_(None),
                        MetadataColumn.custom_description.is_(None),
                        MetadataColumn.mapping_notes.is_(None)
                    )
                )
        
        columns = query.all()
        
        result = []
        for col in columns:
            col_data = {
                "id": col.id,
                "name": col.name,
                "label": col.label,
                "description": col.description,
                "data_type": col.data_type,
                "length": col.length,
                "precision": col.precision,
                "scale": col.scale,
                "nullable": col.nullable,
                "unique": col.unique,
                "primary_key": col.primary_key,
                "foreign_key": col.foreign_key,
                "referenced_table": col.referenced_table,
                "referenced_column": col.referenced_column,
                "default_value": col.default_value,
                "picklist_values": col.picklist_values,
                "system_attributes": col.system_attributes,
                "table_name": col.table_ref.name if col.table_ref else None,
                "object_name": col.table_ref.object_ref.name if col.table_ref and col.table_ref.object_ref else None,
                "system_type": col.table_ref.system_type if col.table_ref else None,
                "is_custom": col.is_custom,
                "custom_data_type": col.custom_data_type,
                "custom_label": col.custom_label,
                "custom_description": col.custom_description,
                "mapping_notes": col.mapping_notes,
                "custom_mapping": col.custom_mapping,
                "last_extracted": col.last_extracted.isoformat() if col.last_extracted else None,
                "created_at": col.created_at.isoformat() if col.created_at else None,
                "updated_at": col.updated_at.isoformat() if col.updated_at else None,
                "updated_by": col.updated_by
            }
            result.append(col_data)
        
        return {
            "status": "success",
            "columns": result,
            "count": len(result)
        }
    
    except Exception as e:
        logger.error(f"Error getting columns for review: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/columns/{column_id}")
async def update_column_metadata(
    column_id: int,
    request: ColumnUpdateRequest,
    updated_by: str = Query(..., description="User updating the metadata"),
    db: Session = Depends(get_db)
):
    """Update column metadata with custom mappings"""
    try:
        column = db.query(MetadataColumn).filter(MetadataColumn.id == column_id).first()
        
        if not column:
            raise HTTPException(status_code=404, detail="Column not found")
        
        # Update fields if provided
        if request.custom_data_type is not None:
            column.custom_data_type = request.custom_data_type
        if request.custom_label is not None:
            column.custom_label = request.custom_label
        if request.custom_description is not None:
            column.custom_description = request.custom_description
        if request.mapping_notes is not None:
            column.mapping_notes = request.mapping_notes
        if request.custom_mapping is not None:
            column.custom_mapping = request.custom_mapping
        
        # Mark as custom if any custom fields are set
        if any([
            request.custom_data_type,
            request.custom_label,
            request.custom_description,
            request.mapping_notes,
            request.custom_mapping
        ]):
            column.is_custom = True
        
        column.updated_at = datetime.utcnow()
        column.updated_by = updated_by
        
        db.commit()
        db.refresh(column)
        
        return {
            "status": "success",
            "message": "Column metadata updated successfully",
            "column_id": column.id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating column metadata: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/mappings")
async def get_mappings_for_review(
    source_system: Optional[str] = Query(None, description="Filter by source system"),
    target_system: Optional[str] = Query(None, description="Filter by target system"),
    mapping_type: Optional[str] = Query(None, description="Filter by mapping type"),
    mapping_status: Optional[str] = Query(None, description="Filter by mapping status"),
    db: Session = Depends(get_db)
):
    """Get metadata mappings for review"""
    try:
        query = db.query(MetadataMapping)
        
        if source_system:
            query = query.filter(MetadataMapping.source_system == source_system)
        if target_system:
            query = query.filter(MetadataMapping.target_system == target_system)
        if mapping_type:
            query = query.filter(MetadataMapping.mapping_type == mapping_type)
        if mapping_status:
            query = query.filter(MetadataMapping.mapping_status == mapping_status)
        
        mappings = query.all()
        
        result = []
        for mapping in mappings:
            mapping_data = {
                "id": mapping.id,
                "source_system": mapping.source_system,
                "target_system": mapping.target_system,
                "source_object": mapping.source_object,
                "target_object": mapping.target_object,
                "source_table": mapping.source_table,
                "target_table": mapping.target_table,
                "source_column": mapping.source_column,
                "target_column": mapping.target_column,
                "mapping_type": mapping.mapping_type,
                "mapping_status": mapping.mapping_status,
                "confidence_score": mapping.confidence_score,
                "mapping_notes": mapping.mapping_notes,
                "custom_transformation": mapping.custom_transformation,
                "created_at": mapping.created_at.isoformat() if mapping.created_at else None,
                "updated_at": mapping.updated_at.isoformat() if mapping.updated_at else None,
                "created_by": mapping.created_by,
                "approved_by": mapping.approved_by,
                "approved_at": mapping.approved_at.isoformat() if mapping.approved_at else None
            }
            result.append(mapping_data)
        
        return {
            "status": "success",
            "mappings": result,
            "count": len(result)
        }
    
    except Exception as e:
        logger.error(f"Error getting mappings for review: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/mappings/{mapping_id}")
async def update_mapping(
    mapping_id: int,
    request: MappingUpdateRequest,
    db: Session = Depends(get_db)
):
    """Update metadata mapping"""
    try:
        mapping = db.query(MetadataMapping).filter(MetadataMapping.id == mapping_id).first()
        
        if not mapping:
            raise HTTPException(status_code=404, detail="Mapping not found")
        
        # Update fields if provided
        if request.mapping_status is not None:
            mapping.mapping_status = request.mapping_status
        if request.mapping_notes is not None:
            mapping.mapping_notes = request.mapping_notes
        if request.custom_transformation is not None:
            mapping.custom_transformation = request.custom_transformation
        if request.approved_by is not None:
            mapping.approved_by = request.approved_by
            mapping.approved_at = datetime.utcnow()
        
        mapping.updated_at = datetime.utcnow()
        
        db.commit()
        db.refresh(mapping)
        
        return {
            "status": "success",
            "message": "Mapping updated successfully",
            "mapping_id": mapping.id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating mapping: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mappings")
async def create_mapping(
    request: MappingCreateRequest,
    created_by: str = Query(..., description="User creating the mapping"),
    db: Session = Depends(get_db)
):
    """Create new metadata mapping"""
    try:
        # Check if mapping already exists
        existing_mapping = db.query(MetadataMapping).filter(
            and_(
                MetadataMapping.source_system == request.source_system,
                MetadataMapping.target_system == request.target_system,
                MetadataMapping.source_object == request.source_object,
                MetadataMapping.target_object == request.target_object,
                MetadataMapping.mapping_type == request.mapping_type
            )
        ).first()
        
        if existing_mapping:
            raise HTTPException(status_code=400, detail="Mapping already exists")
        
        # Create new mapping
        mapping = MetadataMapping(
            source_system=request.source_system,
            target_system=request.target_system,
            source_object=request.source_object,
            target_object=request.target_object,
            source_table=request.source_table,
            target_table=request.target_table,
            source_column=request.source_column,
            target_column=request.target_column,
            mapping_type=request.mapping_type,
            mapping_notes=request.mapping_notes,
            custom_transformation=request.custom_transformation,
            created_by=created_by
        )
        
        db.add(mapping)
        db.commit()
        db.refresh(mapping)
        
        return {
            "status": "success",
            "message": "Mapping created successfully",
            "mapping_id": mapping.id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating mapping: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/mappings/{mapping_id}")
async def delete_mapping(
    mapping_id: int,
    db: Session = Depends(get_db)
):
    """Delete metadata mapping"""
    try:
        mapping = db.query(MetadataMapping).filter(MetadataMapping.id == mapping_id).first()
        
        if not mapping:
            raise HTTPException(status_code=404, detail="Mapping not found")
        
        db.delete(mapping)
        db.commit()
        
        return {
            "status": "success",
            "message": "Mapping deleted successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting mapping: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def get_review_summary(db: Session = Depends(get_db)):
    """Get summary of metadata for review"""
    try:
        # Count objects
        total_objects = db.query(MetadataObject).count()
        custom_objects = db.query(MetadataObject).filter(MetadataObject.is_custom == True).count()
        
        # Count tables
        total_tables = db.query(MetadataTable).count()
        custom_tables = db.query(MetadataTable).filter(MetadataTable.is_custom == True).count()
        
        # Count columns
        total_columns = db.query(MetadataColumn).count()
        custom_columns = db.query(MetadataColumn).filter(MetadataColumn.is_custom == True).count()
        columns_with_notes = db.query(MetadataColumn).filter(MetadataColumn.mapping_notes.isnot(None)).count()
        
        # Count mappings
        total_mappings = db.query(MetadataMapping).count()
        pending_mappings = db.query(MetadataMapping).filter(MetadataMapping.mapping_status == 'pending').count()
        approved_mappings = db.query(MetadataMapping).filter(MetadataMapping.mapping_status == 'approved').count()
        rejected_mappings = db.query(MetadataMapping).filter(MetadataMapping.mapping_status == 'rejected').count()
        
        # System breakdown
        system_breakdown = {}
        for obj in db.query(MetadataObject.system_type).distinct():
            system_type = obj.system_type
            system_breakdown[system_type] = {
                'objects': db.query(MetadataObject).filter(MetadataObject.system_type == system_type).count(),
                'tables': db.query(MetadataTable).filter(MetadataTable.system_type == system_type).count(),
                'columns': db.query(MetadataColumn).join(MetadataTable).filter(MetadataTable.system_type == system_type).count()
            }
        
        return {
            "status": "success",
            "summary": {
                "objects": {
                    "total": total_objects,
                    "custom": custom_objects,
                    "standard": total_objects - custom_objects
                },
                "tables": {
                    "total": total_tables,
                    "custom": custom_tables,
                    "standard": total_tables - custom_tables
                },
                "columns": {
                    "total": total_columns,
                    "custom": custom_columns,
                    "standard": total_columns - custom_columns,
                    "with_notes": columns_with_notes
                },
                "mappings": {
                    "total": total_mappings,
                    "pending": pending_mappings,
                    "approved": approved_mappings,
                    "rejected": rejected_mappings
                },
                "system_breakdown": system_breakdown
            }
        }
    
    except Exception as e:
        logger.error(f"Error getting review summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))