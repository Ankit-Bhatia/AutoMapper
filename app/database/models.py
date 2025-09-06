from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()


class SystemConnection(Base):
    """Stored system connection configurations"""
    __tablename__ = "system_connections"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    system_type = Column(String(50), nullable=False)  # 'salesforce', 'sap', etc.
    config = Column(JSON, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String(100))
    description = Column(Text)


class MetadataObject(Base):
    """Stored metadata objects"""
    __tablename__ = "metadata_objects"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    label = Column(String(255))
    description = Column(Text)
    system_type = Column(String(50), nullable=False)
    system_connection_id = Column(Integer, ForeignKey("system_connections.id"))
    is_custom = Column(Boolean, default=False)
    custom_mapping = Column(JSON)  # Custom field mappings
    last_extracted = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    system_connection = relationship("SystemConnection")
    tables = relationship("MetadataTable", back_populates="object_ref", cascade="all, delete-orphan")


class MetadataTable(Base):
    """Stored metadata tables"""
    __tablename__ = "metadata_tables"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    label = Column(String(255))
    description = Column(Text)
    system_type = Column(String(50), nullable=False)
    object_id = Column(Integer, ForeignKey("metadata_objects.id"))
    system_connection_id = Column(Integer, ForeignKey("system_connections.id"))
    is_custom = Column(Boolean, default=False)
    custom_mapping = Column(JSON)  # Custom table mappings
    last_extracted = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    object_ref = relationship("MetadataObject", back_populates="tables")
    system_connection = relationship("SystemConnection")
    columns = relationship("MetadataColumn", back_populates="table_ref", cascade="all, delete-orphan")


class MetadataColumn(Base):
    """Stored metadata columns"""
    __tablename__ = "metadata_columns"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    label = Column(String(255))
    description = Column(Text)
    data_type = Column(String(50), nullable=False)
    length = Column(Integer)
    precision = Column(Integer)
    scale = Column(Integer)
    nullable = Column(Boolean, default=True)
    unique = Column(Boolean, default=False)
    primary_key = Column(Boolean, default=False)
    foreign_key = Column(Boolean, default=False)
    referenced_table = Column(String(255))
    referenced_column = Column(String(255))
    default_value = Column(String(500))
    picklist_values = Column(JSON)
    system_attributes = Column(JSON)
    
    # Foreign keys
    table_id = Column(Integer, ForeignKey("metadata_tables.id"))
    system_connection_id = Column(Integer, ForeignKey("system_connections.id"))
    
    # Custom mapping fields
    is_custom = Column(Boolean, default=False)
    custom_mapping = Column(JSON)  # Custom column mappings
    custom_data_type = Column(String(50))  # Override data type
    custom_label = Column(String(255))  # Override label
    custom_description = Column(Text)  # Override description
    mapping_notes = Column(Text)  # Notes about the mapping
    
    # Audit fields
    last_extracted = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String(100))
    
    # Relationships
    table_ref = relationship("MetadataTable", back_populates="columns")
    system_connection = relationship("SystemConnection")


class MetadataMapping(Base):
    """Cross-system metadata mappings"""
    __tablename__ = "metadata_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    source_system = Column(String(50), nullable=False)
    target_system = Column(String(50), nullable=False)
    source_object = Column(String(255), nullable=False)
    target_object = Column(String(255), nullable=False)
    source_table = Column(String(255))
    target_table = Column(String(255))
    source_column = Column(String(255))
    target_column = Column(String(255))
    
    # Mapping details
    mapping_type = Column(String(50), nullable=False)  # 'object', 'table', 'column'
    mapping_status = Column(String(50), default='pending')  # 'pending', 'approved', 'rejected', 'custom'
    confidence_score = Column(Float)  # AI confidence in the mapping
    mapping_notes = Column(Text)
    custom_transformation = Column(JSON)  # Custom transformation rules
    
    # Audit fields
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String(100))
    approved_by = Column(String(100))
    approved_at = Column(DateTime)


class MetadataExtractionLog(Base):
    """Log of metadata extraction operations"""
    __tablename__ = "metadata_extraction_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    system_connection_id = Column(Integer, ForeignKey("system_connections.id"))
    extraction_type = Column(String(50), nullable=False)  # 'full', 'incremental', 'custom'
    objects_extracted = Column(Integer, default=0)
    tables_extracted = Column(Integer, default=0)
    columns_extracted = Column(Integer, default=0)
    status = Column(String(50), nullable=False)  # 'running', 'completed', 'failed'
    error_message = Column(Text)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)
    duration_seconds = Column(Float)
    
    # Relationships
    system_connection = relationship("SystemConnection")


class MetadataSyncLog(Base):
    """Log of metadata synchronization operations"""
    __tablename__ = "metadata_sync_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    sync_id = Column(String(100), unique=True, index=True)
    source_system = Column(String(50), nullable=False)
    target_system = Column(String(50), nullable=False)
    objects_synced = Column(JSON)  # List of object names
    objects_failed = Column(JSON)  # List of failed object names
    status = Column(String(50), nullable=False)  # 'running', 'completed', 'failed', 'partial'
    error_details = Column(JSON)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)
    duration_seconds = Column(Float)
    created_by = Column(String(100))