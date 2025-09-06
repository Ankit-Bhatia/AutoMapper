from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from app.models.metadata import ObjectMetadata, TableMetadata, ColumnMetadata, SystemType


class BaseConnector(ABC):
    """Base class for all system connectors"""
    
    def __init__(self, system_type: SystemType, config: Dict[str, Any]):
        self.system_type = system_type
        self.config = config
        self.connection = None
    
    @abstractmethod
    async def connect(self) -> bool:
        """Establish connection to the system"""
        pass
    
    @abstractmethod
    async def disconnect(self) -> bool:
        """Close connection to the system"""
        pass
    
    @abstractmethod
    async def get_objects(self) -> List[ObjectMetadata]:
        """Retrieve all objects from the system"""
        pass
    
    @abstractmethod
    async def get_tables(self, object_name: Optional[str] = None) -> List[TableMetadata]:
        """Retrieve tables from the system"""
        pass
    
    @abstractmethod
    async def get_columns(self, table_name: str) -> List[ColumnMetadata]:
        """Retrieve columns for a specific table"""
        pass
    
    @abstractmethod
    async def get_object_metadata(self, object_name: str) -> Optional[ObjectMetadata]:
        """Get complete metadata for a specific object"""
        pass
    
    @abstractmethod
    async def get_table_metadata(self, table_name: str) -> Optional[TableMetadata]:
        """Get complete metadata for a specific table"""
        pass
    
    @abstractmethod
    async def test_connection(self) -> bool:
        """Test if the connection is working"""
        pass
    
    def get_system_type(self) -> SystemType:
        """Get the system type for this connector"""
        return self.system_type