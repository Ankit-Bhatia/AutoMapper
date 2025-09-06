from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query, Form
from typing import Optional, List
from app.services.data_import import DataImporter
from app.models.metadata import SystemType
from app.database.connection import get_db
from sqlalchemy.orm import Session
from loguru import logger
import tempfile
import os

router = APIRouter(prefix="/api/v1/import", tags=["import"])

# Global data importer instance
data_importer = DataImporter()


@router.post("/columns/csv")
async def import_columns_csv(
    file: UploadFile = File(...),
    system_type: SystemType = Form(...),
    update_mode: str = Form(default="update_only", description="update_only, create_new, replace_all"),
    db: Session = Depends(get_db)
):
    """Import column metadata updates from CSV file"""
    try:
        # Validate file type
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="File must be a CSV file")
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        try:
            # Import the data
            result = await data_importer.import_columns_from_csv(
                temp_file_path, system_type, update_mode
            )
            
            return {
                "status": "success",
                "message": f"CSV import completed for {file.filename}",
                "result": result
            }
        
        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing columns CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mappings/csv")
async def import_mappings_csv(
    file: UploadFile = File(...),
    update_mode: str = Form(default="update_only", description="update_only, create_new, replace_all"),
    db: Session = Depends(get_db)
):
    """Import metadata mappings from CSV file"""
    try:
        # Validate file type
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="File must be a CSV file")
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        try:
            # Import the data
            result = await data_importer.import_mappings_from_csv(
                temp_file_path, update_mode
            )
            
            return {
                "status": "success",
                "message": f"CSV import completed for {file.filename}",
                "result": result
            }
        
        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing mappings CSV: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/excel")
async def import_excel(
    file: UploadFile = File(...),
    system_type: SystemType = Form(...),
    sheets_to_import: Optional[str] = Form(None, description="Comma-separated list of sheet names"),
    db: Session = Depends(get_db)
):
    """Import metadata from Excel file with multiple sheets"""
    try:
        # Validate file type
        if not file.filename.endswith(('.xlsx', '.xls')):
            raise HTTPException(status_code=400, detail="File must be an Excel file")
        
        # Parse sheets to import
        sheets_list = None
        if sheets_to_import:
            sheets_list = [sheet.strip() for sheet in sheets_to_import.split(',')]
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.xlsx', delete=False) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        try:
            # Import the data
            result = await data_importer.import_from_excel(
                temp_file_path, system_type, sheets_list
            )
            
            return {
                "status": "success",
                "message": f"Excel import completed for {file.filename}",
                "result": result
            }
        
        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing Excel file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/json")
async def import_json(
    file: UploadFile = File(...),
    system_type: SystemType = Form(...),
    db: Session = Depends(get_db)
):
    """Import metadata from JSON file"""
    try:
        # Validate file type
        if not file.filename.endswith('.json'):
            raise HTTPException(status_code=400, detail="File must be a JSON file")
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.json', delete=False) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        try:
            # Import the data
            result = await data_importer.import_from_json(
                temp_file_path, system_type
            )
            
            return {
                "status": "success",
                "message": f"JSON import completed for {file.filename}",
                "result": result
            }
        
        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing JSON file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates")
async def get_import_templates():
    """Get import templates for different file types"""
    try:
        templates = data_importer.get_import_templates()
        
        return {
            "status": "success",
            "templates": templates
        }
    
    except Exception as e:
        logger.error(f"Error getting import templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_type}")
async def get_import_template(template_type: str):
    """Get specific import template"""
    try:
        templates = data_importer.get_import_templates()
        
        if template_type not in templates:
            raise HTTPException(status_code=404, detail="Template not found")
        
        return {
            "status": "success",
            "template": templates[template_type]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting import template {template_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_type}/download")
async def download_import_template(template_type: str):
    """Download import template as CSV file"""
    try:
        templates = data_importer.get_import_templates()
        
        if template_type not in templates:
            raise HTTPException(status_code=404, detail="Template not found")
        
        template = templates[template_type]
        
        # Create CSV content
        import csv
        import io
        
        output = io.StringIO()
        
        # Get all columns (required + optional)
        all_columns = template['required_columns'] + template['optional_columns']
        
        writer = csv.DictWriter(output, fieldnames=all_columns)
        writer.writeheader()
        
        # Write sample data
        for sample in template.get('sample_data', []):
            writer.writerow(sample)
        
        csv_content = output.getvalue()
        output.close()
        
        # Return as downloadable file
        from fastapi.responses import Response
        
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={template_type}_template.csv"}
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading import template {template_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/validation/{file_type}")
async def validate_import_file(
    file_type: str,
    file: UploadFile = File(...)
):
    """Validate import file before processing"""
    try:
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(mode='wb', suffix=f'.{file_type}', delete=False) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        try:
            validation_result = {
                "valid": True,
                "errors": [],
                "warnings": [],
                "file_info": {
                    "filename": file.filename,
                    "size_bytes": len(content),
                    "file_type": file_type
                }
            }
            
            if file_type == "csv":
                import pandas as pd
                try:
                    df = pd.read_csv(temp_file_path)
                    validation_result["file_info"]["rows"] = len(df)
                    validation_result["file_info"]["columns"] = list(df.columns)
                    
                    # Basic validation
                    if len(df) == 0:
                        validation_result["warnings"].append("File is empty")
                    
                    # Check for required columns based on file name
                    if "columns" in file.filename.lower():
                        required_columns = ['column_name', 'table_name', 'object_name']
                        missing_columns = [col for col in required_columns if col not in df.columns]
                        if missing_columns:
                            validation_result["errors"].append(f"Missing required columns: {missing_columns}")
                    
                    elif "mappings" in file.filename.lower():
                        required_columns = ['source_system', 'target_system', 'source_object', 'target_object', 'mapping_type']
                        missing_columns = [col for col in required_columns if col not in df.columns]
                        if missing_columns:
                            validation_result["errors"].append(f"Missing required columns: {missing_columns}")
                    
                except Exception as e:
                    validation_result["valid"] = False
                    validation_result["errors"].append(f"Error reading CSV file: {str(e)}")
            
            elif file_type == "json":
                import json
                try:
                    with open(temp_file_path, 'r') as f:
                        data = json.load(f)
                    
                    validation_result["file_info"]["sections"] = list(data.keys())
                    
                    # Basic validation
                    if not isinstance(data, dict):
                        validation_result["errors"].append("JSON file must contain an object")
                    
                except Exception as e:
                    validation_result["valid"] = False
                    validation_result["errors"].append(f"Error reading JSON file: {str(e)}")
            
            elif file_type in ["xlsx", "xls"]:
                import pandas as pd
                try:
                    excel_file = pd.ExcelFile(temp_file_path)
                    validation_result["file_info"]["sheets"] = excel_file.sheet_names
                    
                    # Basic validation
                    if len(excel_file.sheet_names) == 0:
                        validation_result["warnings"].append("Excel file has no sheets")
                    
                except Exception as e:
                    validation_result["valid"] = False
                    validation_result["errors"].append(f"Error reading Excel file: {str(e)}")
            
            else:
                validation_result["valid"] = False
                validation_result["errors"].append(f"Unsupported file type: {file_type}")
            
            if validation_result["errors"]:
                validation_result["valid"] = False
            
            return {
                "status": "success",
                "validation": validation_result
            }
        
        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating import file: {e}")
        raise HTTPException(status_code=500, detail=str(e))