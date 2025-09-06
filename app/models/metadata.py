from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class SystemType(str, Enum):
    SALESFORCE = "salesforce"
    SAP = "sap"


class DataType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    DECIMAL = "decimal"
    DATE = "date"
    DATETIME = "datetime"
    BOOLEAN = "boolean"
    TEXT = "text"
    CURRENCY = "currency"
    PERCENT = "percent"
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    PICKLIST = "picklist"
    MULTIPICKLIST = "multipicklist"
    REFERENCE = "reference"
    LOOKUP = "lookup"
    MASTER_DETAIL = "master_detail"


class ColumnMetadata(BaseModel):
    name: str
    label: Optional[str] = None
    data_type: DataType
    length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    nullable: bool = True
    unique: bool = False
    primary_key: bool = False
    foreign_key: bool = False
    referenced_table: Optional[str] = None
    referenced_column: Optional[str] = None
    default_value: Optional[str] = None
    description: Optional[str] = None
    picklist_values: Optional[List[str]] = None
    system_attributes: Optional[Dict[str, Any]] = None


class TableMetadata(BaseModel):
    name: str
    label: Optional[str] = None
    description: Optional[str] = None
    system_type: SystemType
    columns: List[ColumnMetadata] = []
    primary_keys: List[str] = []
    indexes: Optional[List[Dict[str, Any]]] = None
    relationships: Optional[List[Dict[str, Any]]] = None
    system_attributes: Optional[Dict[str, Any]] = None
    last_modified: Optional[datetime] = None


class ObjectMetadata(BaseModel):
    name: str
    label: Optional[str] = None
    description: Optional[str] = None
    system_type: SystemType
    tables: List[TableMetadata] = []
    system_attributes: Optional[Dict[str, Any]] = None
    last_modified: Optional[datetime] = None


class MetadataComparison(BaseModel):
    source_system: SystemType
    target_system: SystemType
    object_name: str
    differences: List[Dict[str, Any]]
    status: str  # "identical", "different", "missing_in_target", "missing_in_source"
    last_compared: datetime


class MetadataSyncResult(BaseModel):
    sync_id: str
    source_system: SystemType
    target_system: SystemType
    objects_synced: List[str]
    objects_failed: List[str]
    sync_start_time: datetime
    sync_end_time: Optional[datetime] = None
    status: str  # "running", "completed", "failed", "partial"
    error_details: Optional[Dict[str, Any]] = None