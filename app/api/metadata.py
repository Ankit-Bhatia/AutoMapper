from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from app.connectors.salesforce import SalesforceConnector
from app.connectors.sap import SAPConnector
from app.services.metadata_comparator import MetadataComparator
from app.services.metadata_sync import MetadataSyncService
from app.models.metadata import SystemType, MetadataComparison, MetadataSyncResult
from app.core.config import settings
from loguru import logger

router = APIRouter(prefix="/api/v1/metadata", tags=["metadata"])

# Global services
metadata_comparator = MetadataComparator()
metadata_sync_service = MetadataSyncService()


class ConnectionTestRequest(BaseModel):
    system_type: SystemType
    config: Dict[str, Any]


class MetadataExtractionRequest(BaseModel):
    system_type: SystemType
    config: Dict[str, Any]
    object_names: Optional[List[str]] = None


class MetadataComparisonRequest(BaseModel):
    source_system: SystemType
    target_system: SystemType
    source_config: Dict[str, Any]
    target_config: Dict[str, Any]
    object_names: Optional[List[str]] = None


class MetadataSyncRequest(BaseModel):
    source_system: SystemType
    target_system: SystemType
    source_config: Dict[str, Any]
    target_config: Dict[str, Any]
    object_names: Optional[List[str]] = None
    sync_options: Optional[Dict[str, Any]] = None


@router.post("/test-connection")
async def test_connection(request: ConnectionTestRequest):
    """Test connection to a system"""
    try:
        if request.system_type == SystemType.SALESFORCE:
            connector = SalesforceConnector(request.config)
        elif request.system_type == SystemType.SAP:
            connector = SAPConnector(request.config)
        else:
            raise HTTPException(status_code=400, detail="Unsupported system type")
        
        connected = await connector.connect()
        if connected:
            test_result = await connector.test_connection()
            await connector.disconnect()
            return {"status": "success", "connected": test_result}
        else:
            return {"status": "error", "message": "Failed to establish connection"}
    
    except Exception as e:
        logger.error(f"Connection test failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extract")
async def extract_metadata(request: MetadataExtractionRequest):
    """Extract metadata from a system"""
    try:
        if request.system_type == SystemType.SALESFORCE:
            connector = SalesforceConnector(request.config)
        elif request.system_type == SystemType.SAP:
            connector = SAPConnector(request.config)
        else:
            raise HTTPException(status_code=400, detail="Unsupported system type")
        
        connected = await connector.connect()
        if not connected:
            raise HTTPException(status_code=500, detail="Failed to connect to system")
        
        try:
            if request.object_names:
                # Extract specific objects
                objects = []
                for object_name in request.object_names:
                    obj_metadata = await connector.get_object_metadata(object_name)
                    if obj_metadata:
                        objects.append(obj_metadata)
            else:
                # Extract all objects
                objects = await connector.get_objects()
            
            return {
                "status": "success",
                "system_type": request.system_type,
                "object_count": len(objects),
                "objects": [obj.dict() for obj in objects]
            }
        
        finally:
            await connector.disconnect()
    
    except Exception as e:
        logger.error(f"Metadata extraction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compare")
async def compare_metadata(request: MetadataComparisonRequest):
    """Compare metadata between two systems"""
    try:
        # Create connectors
        if request.source_system == SystemType.SALESFORCE:
            source_connector = SalesforceConnector(request.source_config)
        elif request.source_system == SystemType.SAP:
            source_connector = SAPConnector(request.source_config)
        else:
            raise HTTPException(status_code=400, detail="Unsupported source system type")
        
        if request.target_system == SystemType.SALESFORCE:
            target_connector = SalesforceConnector(request.target_config)
        elif request.target_system == SystemType.SAP:
            target_connector = SAPConnector(request.target_config)
        else:
            raise HTTPException(status_code=400, detail="Unsupported target system type")
        
        # Connect to both systems
        source_connected = await source_connector.connect()
        target_connected = await target_connector.connect()
        
        if not source_connected or not target_connected:
            raise HTTPException(status_code=500, detail="Failed to connect to one or both systems")
        
        try:
            # Extract metadata from both systems
            if request.object_names:
                source_objects = []
                target_objects = []
                
                for object_name in request.object_names:
                    source_obj = await source_connector.get_object_metadata(object_name)
                    target_obj = await target_connector.get_object_metadata(object_name)
                    
                    if source_obj:
                        source_objects.append(source_obj)
                    if target_obj:
                        target_objects.append(target_obj)
            else:
                source_objects = await source_connector.get_objects()
                target_objects = await target_connector.get_objects()
            
            # Compare metadata
            comparisons = await metadata_comparator.compare_objects(
                source_objects, target_objects, 
                request.source_system, request.target_system
            )
            
            # Get summary
            summary = metadata_comparator.get_comparison_summary(comparisons)
            
            return {
                "status": "success",
                "source_system": request.source_system,
                "target_system": request.target_system,
                "summary": summary,
                "comparisons": [comp.dict() for comp in comparisons]
            }
        
        finally:
            await source_connector.disconnect()
            await target_connector.disconnect()
    
    except Exception as e:
        logger.error(f"Metadata comparison failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync")
async def sync_metadata(request: MetadataSyncRequest, background_tasks: BackgroundTasks):
    """Synchronize metadata between two systems"""
    try:
        # Create connectors
        if request.source_system == SystemType.SALESFORCE:
            source_connector = SalesforceConnector(request.source_config)
        elif request.source_system == SystemType.SAP:
            source_connector = SAPConnector(request.source_config)
        else:
            raise HTTPException(status_code=400, detail="Unsupported source system type")
        
        if request.target_system == SystemType.SALESFORCE:
            target_connector = SalesforceConnector(request.target_config)
        elif request.target_system == SystemType.SAP:
            target_connector = SAPConnector(request.target_config)
        else:
            raise HTTPException(status_code=400, detail="Unsupported target system type")
        
        # Start sync in background
        sync_result = await metadata_sync_service.sync_metadata(
            source_connector=source_connector,
            target_connector=target_connector,
            object_names=request.object_names,
            sync_options=request.sync_options
        )
        
        return {
            "status": "success",
            "sync_id": sync_result.sync_id,
            "sync_status": sync_result.status,
            "message": f"Sync {sync_result.sync_id} started"
        }
    
    except Exception as e:
        logger.error(f"Metadata sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sync/{sync_id}")
async def get_sync_status(sync_id: str):
    """Get status of a sync operation"""
    sync_result = metadata_sync_service.get_sync_status(sync_id)
    
    if not sync_result:
        raise HTTPException(status_code=404, detail="Sync not found")
    
    return {
        "status": "success",
        "sync_result": sync_result.dict()
    }


@router.get("/sync")
async def get_active_syncs():
    """Get all active sync operations"""
    active_syncs = metadata_sync_service.get_active_syncs()
    
    return {
        "status": "success",
        "active_syncs": {sync_id: sync_result.dict() for sync_id, sync_result in active_syncs.items()}
    }


@router.delete("/sync/{sync_id}")
async def cancel_sync(sync_id: str):
    """Cancel an active sync operation"""
    cancelled = await metadata_sync_service.cancel_sync(sync_id)
    
    if not cancelled:
        raise HTTPException(status_code=404, detail="Sync not found or not active")
    
    return {
        "status": "success",
        "message": f"Sync {sync_id} cancelled"
    }


@router.get("/systems")
async def get_supported_systems():
    """Get list of supported systems"""
    return {
        "status": "success",
        "supported_systems": [
            {
                "type": SystemType.SALESFORCE,
                "name": "Salesforce",
                "description": "Salesforce CRM platform"
            },
            {
                "type": SystemType.SAP,
                "name": "SAP",
                "description": "SAP ERP system"
            }
        ]
    }


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "metadata-agent",
        "version": "1.0.0"
    }