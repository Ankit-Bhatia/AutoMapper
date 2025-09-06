from fastapi import APIRouter, HTTPException, Depends, Query, Response
from fastapi.responses import FileResponse
from typing import Optional, List
from app.services.data_export import DataExporter
from app.database.connection import get_db
from sqlalchemy.orm import Session
from loguru import logger
import os

router = APIRouter(prefix="/api/v1/export", tags=["export"])

# Global data exporter instance
data_exporter = DataExporter()


@router.get("/objects/csv")
async def export_objects_csv(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    include_custom_mappings: bool = Query(True, description="Include custom mappings"),
    db: Session = Depends(get_db)
):
    """Export metadata objects to CSV"""
    try:
        filepath = await data_exporter.export_objects_to_csv(
            system_type=system_type,
            include_custom_mappings=include_custom_mappings
        )
        
        return FileResponse(
            path=filepath,
            filename=os.path.basename(filepath),
            media_type='text/csv'
        )
    
    except Exception as e:
        logger.error(f"Error exporting objects to CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tables/csv")
async def export_tables_csv(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    object_name: Optional[str] = Query(None, description="Filter by object name"),
    include_custom_mappings: bool = Query(True, description="Include custom mappings"),
    db: Session = Depends(get_db)
):
    """Export metadata tables to CSV"""
    try:
        filepath = await data_exporter.export_tables_to_csv(
            system_type=system_type,
            object_name=object_name,
            include_custom_mappings=include_custom_mappings
        )
        
        return FileResponse(
            path=filepath,
            filename=os.path.basename(filepath),
            media_type='text/csv'
        )
    
    except Exception as e:
        logger.error(f"Error exporting tables to CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/columns/csv")
async def export_columns_csv(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    table_name: Optional[str] = Query(None, description="Filter by table name"),
    include_custom_mappings: bool = Query(True, description="Include custom mappings"),
    db: Session = Depends(get_db)
):
    """Export metadata columns to CSV"""
    try:
        filepath = await data_exporter.export_columns_to_csv(
            system_type=system_type,
            table_name=table_name,
            include_custom_mappings=include_custom_mappings
        )
        
        return FileResponse(
            path=filepath,
            filename=os.path.basename(filepath),
            media_type='text/csv'
        )
    
    except Exception as e:
        logger.error(f"Error exporting columns to CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/mappings/csv")
async def export_mappings_csv(
    source_system: Optional[str] = Query(None, description="Filter by source system"),
    target_system: Optional[str] = Query(None, description="Filter by target system"),
    mapping_type: Optional[str] = Query(None, description="Filter by mapping type"),
    db: Session = Depends(get_db)
):
    """Export metadata mappings to CSV"""
    try:
        filepath = await data_exporter.export_mappings_to_csv(
            source_system=source_system,
            target_system=target_system,
            mapping_type=mapping_type
        )
        
        return FileResponse(
            path=filepath,
            filename=os.path.basename(filepath),
            media_type='text/csv'
        )
    
    except Exception as e:
        logger.error(f"Error exporting mappings to CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/complete/excel")
async def export_complete_metadata_excel(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    include_custom_mappings: bool = Query(True, description="Include custom mappings"),
    db: Session = Depends(get_db)
):
    """Export complete metadata to Excel with multiple sheets"""
    try:
        filepath = await data_exporter.export_complete_metadata_to_excel(
            system_type=system_type,
            include_custom_mappings=include_custom_mappings
        )
        
        return FileResponse(
            path=filepath,
            filename=os.path.basename(filepath),
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    
    except Exception as e:
        logger.error(f"Error exporting complete metadata to Excel: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/complete/json")
async def export_complete_metadata_json(
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    include_custom_mappings: bool = Query(True, description="Include custom mappings"),
    db: Session = Depends(get_db)
):
    """Export complete metadata to JSON"""
    try:
        filepath = await data_exporter.export_to_json(
            system_type=system_type,
            include_custom_mappings=include_custom_mappings
        )
        
        return FileResponse(
            path=filepath,
            filename=os.path.basename(filepath),
            media_type='application/json'
        )
    
    except Exception as e:
        logger.error(f"Error exporting complete metadata to JSON: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files")
async def get_export_files():
    """Get list of available export files"""
    try:
        files = data_exporter.get_export_files()
        return {
            "status": "success",
            "files": files,
            "count": len(files)
        }
    
    except Exception as e:
        logger.error(f"Error getting export files: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/{filename}")
async def download_export_file(filename: str):
    """Download a specific export file"""
    try:
        # Security check - only allow files from export directory
        if ".." in filename or "/" in filename or "\\" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        filepath = data_exporter.export_dir / filename
        
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="File not found")
        
        # Determine media type based on file extension
        media_type = "application/octet-stream"
        if filename.endswith('.csv'):
            media_type = 'text/csv'
        elif filename.endswith('.json'):
            media_type = 'application/json'
        elif filename.endswith('.xlsx'):
            media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        
        return FileResponse(
            path=str(filepath),
            filename=filename,
            media_type=media_type
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading export file {filename}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/files/{filename}")
async def delete_export_file(filename: str):
    """Delete a specific export file"""
    try:
        # Security check - only allow files from export directory
        if ".." in filename or "/" in filename or "\\" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        filepath = data_exporter.export_dir / filename
        
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="File not found")
        
        filepath.unlink()
        
        return {
            "status": "success",
            "message": f"File {filename} deleted successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting export file {filename}: {e}")
        raise HTTPException(status_code=500, detail=str(e))