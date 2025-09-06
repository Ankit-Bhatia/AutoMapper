import asyncio
from typing import List, Dict, Any, Optional
from pyrfc import Connection, ABAPApplicationError, ABAPRuntimeError, LogonError, CommunicationError
from app.connectors.base import BaseConnector
from app.models.metadata import (
    ObjectMetadata, TableMetadata, ColumnMetadata, 
    SystemType, DataType
)
from loguru import logger


class SAPConnector(BaseConnector):
    """SAP connector for metadata extraction using RFC"""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(SystemType.SAP, config)
        self.connection = None
    
    async def connect(self) -> bool:
        """Establish connection to SAP system"""
        try:
            connection_params = {
                'ashost': self.config['ashost'],
                'sysnr': self.config['sysnr'],
                'client': self.config['client'],
                'user': self.config['user'],
                'passwd': self.config['passwd'],
                'lang': self.config.get('lang', 'EN')
            }
            
            self.connection = Connection(**connection_params)
            logger.info("Successfully connected to SAP system")
            return True
            
        except LogonError as e:
            logger.error(f"SAP logon failed: {e}")
            return False
        except CommunicationError as e:
            logger.error(f"SAP communication error: {e}")
            return False
        except Exception as e:
            logger.error(f"Failed to connect to SAP: {e}")
            return False
    
    async def disconnect(self) -> bool:
        """Close SAP connection"""
        try:
            if self.connection:
                self.connection.close()
                self.connection = None
            logger.info("Disconnected from SAP system")
            return True
        except Exception as e:
            logger.error(f"Error disconnecting from SAP: {e}")
            return False
    
    async def test_connection(self) -> bool:
        """Test SAP connection"""
        try:
            if not self.connection:
                return False
            
            # Simple RFC call to test connection
            result = self.connection.call('RFC_SYSTEM_INFO')
            return result is not None
            
        except Exception as e:
            logger.error(f"SAP connection test failed: {e}")
            return False
    
    async def get_objects(self) -> List[ObjectMetadata]:
        """Retrieve all SAP objects (tables, views, etc.)"""
        if not self.connection:
            raise Exception("Not connected to SAP system")
        
        try:
            objects = []
            
            # Get database tables
            tables = await self._get_database_tables()
            for table in tables:
                object_metadata = ObjectMetadata(
                    name=table['TABNAME'],
                    label=table.get('DDTEXT', table['TABNAME']),
                    description=table.get('DDTEXT'),
                    system_type=SystemType.SAP,
                    system_attributes={
                        'table_type': table.get('TABCLASS', 'TRANSP'),
                        'table_category': table.get('TABKAT', 'APPL0'),
                        'maintenance': table.get('MAINTVIEW', ''),
                        'exclass': table.get('EXCLASS', '0')
                    }
                )
                objects.append(object_metadata)
            
            # Get database views
            views = await self._get_database_views()
            for view in views:
                object_metadata = ObjectMetadata(
                    name=view['VIEWNAME'],
                    label=view.get('DDTEXT', view['VIEWNAME']),
                    description=view.get('DDTEXT'),
                    system_type=SystemType.SAP,
                    system_attributes={
                        'view_type': 'VIEW',
                        'view_category': view.get('VIEWCAT', 'V'),
                        'maintenance': view.get('MAINTVIEW', ''),
                        'exclass': view.get('EXCLASS', '0')
                    }
                )
                objects.append(object_metadata)
            
            logger.info(f"Retrieved {len(objects)} SAP objects")
            return objects
            
        except Exception as e:
            logger.error(f"Error retrieving SAP objects: {e}")
            return []
    
    async def get_tables(self, object_name: Optional[str] = None) -> List[TableMetadata]:
        """Retrieve SAP tables"""
        if not self.connection:
            raise Exception("Not connected to SAP system")
        
        try:
            tables = []
            
            if object_name:
                # Get specific table
                table_info = await self._get_table_info(object_name)
                if table_info:
                    table_metadata = await self._convert_to_table_metadata(table_info)
                    tables.append(table_metadata)
            else:
                # Get all tables
                table_list = await self._get_database_tables()
                for table_info in table_list:
                    table_metadata = await self._convert_to_table_metadata(table_info)
                    tables.append(table_metadata)
            
            return tables
            
        except Exception as e:
            logger.error(f"Error retrieving SAP tables: {e}")
            return []
    
    async def get_columns(self, table_name: str) -> List[ColumnMetadata]:
        """Retrieve columns for a specific SAP table"""
        try:
            # Get table fields
            fields = await self._get_table_fields(table_name)
            columns = []
            
            for field in fields:
                column = await self._convert_field_to_column(field)
                columns.append(column)
            
            return columns
            
        except Exception as e:
            logger.error(f"Error retrieving columns for {table_name}: {e}")
            return []
    
    async def get_object_metadata(self, object_name: str) -> Optional[ObjectMetadata]:
        """Get complete metadata for a specific SAP object"""
        try:
            # First check if it's a table
            table_info = await self._get_table_info(object_name)
            if table_info:
                table_metadata = await self._convert_to_table_metadata(table_info)
                object_metadata = ObjectMetadata(
                    name=object_name,
                    label=table_info.get('DDTEXT', object_name),
                    description=table_info.get('DDTEXT'),
                    system_type=SystemType.SAP,
                    tables=[table_metadata],
                    system_attributes={
                        'table_type': table_info.get('TABCLASS', 'TRANSP'),
                        'table_category': table_info.get('TABKAT', 'APPL0'),
                        'maintenance': table_info.get('MAINTVIEW', ''),
                        'exclass': table_info.get('EXCLASS', '0')
                    }
                )
                return object_metadata
            
            # Check if it's a view
            view_info = await self._get_view_info(object_name)
            if view_info:
                view_metadata = await self._convert_to_table_metadata(view_info, is_view=True)
                object_metadata = ObjectMetadata(
                    name=object_name,
                    label=view_info.get('DDTEXT', object_name),
                    description=view_info.get('DDTEXT'),
                    system_type=SystemType.SAP,
                    tables=[view_metadata],
                    system_attributes={
                        'view_type': 'VIEW',
                        'view_category': view_info.get('VIEWCAT', 'V'),
                        'maintenance': view_info.get('MAINTVIEW', ''),
                        'exclass': view_info.get('EXCLASS', '0')
                    }
                )
                return object_metadata
            
            return None
            
        except Exception as e:
            logger.error(f"Error retrieving metadata for object {object_name}: {e}")
            return None
    
    async def get_table_metadata(self, table_name: str) -> Optional[TableMetadata]:
        """Get complete metadata for a specific SAP table"""
        try:
            table_info = await self._get_table_info(table_name)
            if table_info:
                return await self._convert_to_table_metadata(table_info)
            
            # Check if it's a view
            view_info = await self._get_view_info(table_name)
            if view_info:
                return await self._convert_to_table_metadata(view_info, is_view=True)
            
            return None
            
        except Exception as e:
            logger.error(f"Error retrieving table metadata for {table_name}: {e}")
            return None
    
    async def _get_database_tables(self) -> List[Dict[str, Any]]:
        """Get list of database tables"""
        try:
            result = self.connection.call('RFC_READ_TABLE', 
                                        QUERY_TABLE='DD02L',
                                        DELIMITER='|',
                                        FIELDS=[{'FIELDNAME': 'TABNAME'},
                                               {'FIELDNAME': 'DDTEXT'},
                                               {'FIELDNAME': 'TABCLASS'},
                                               {'FIELDNAME': 'TABKAT'},
                                               {'FIELDNAME': 'MAINTVIEW'},
                                               {'FIELDNAME': 'EXCLASS'}])
            
            tables = []
            for row in result['DATA']:
                fields = row['WA'].split('|')
                if len(fields) >= 6:
                    tables.append({
                        'TABNAME': fields[0],
                        'DDTEXT': fields[1],
                        'TABCLASS': fields[2],
                        'TABKAT': fields[3],
                        'MAINTVIEW': fields[4],
                        'EXCLASS': fields[5]
                    })
            
            return tables
            
        except Exception as e:
            logger.error(f"Error getting database tables: {e}")
            return []
    
    async def _get_database_views(self) -> List[Dict[str, Any]]:
        """Get list of database views"""
        try:
            result = self.connection.call('RFC_READ_TABLE', 
                                        QUERY_TABLE='DD25L',
                                        DELIMITER='|',
                                        FIELDS=[{'FIELDNAME': 'VIEWNAME'},
                                               {'FIELDNAME': 'DDTEXT'},
                                               {'FIELDNAME': 'VIEWCAT'},
                                               {'FIELDNAME': 'MAINTVIEW'},
                                               {'FIELDNAME': 'EXCLASS'}])
            
            views = []
            for row in result['DATA']:
                fields = row['WA'].split('|')
                if len(fields) >= 5:
                    views.append({
                        'VIEWNAME': fields[0],
                        'DDTEXT': fields[1],
                        'VIEWCAT': fields[2],
                        'MAINTVIEW': fields[3],
                        'EXCLASS': fields[4]
                    })
            
            return views
            
        except Exception as e:
            logger.error(f"Error getting database views: {e}")
            return []
    
    async def _get_table_info(self, table_name: str) -> Optional[Dict[str, Any]]:
        """Get detailed information for a specific table"""
        try:
            result = self.connection.call('RFC_READ_TABLE', 
                                        QUERY_TABLE='DD02L',
                                        DELIMITER='|',
                                        OPTIONS=[{'TEXT': f"TABNAME = '{table_name}'"}],
                                        FIELDS=[{'FIELDNAME': 'TABNAME'},
                                               {'FIELDNAME': 'DDTEXT'},
                                               {'FIELDNAME': 'TABCLASS'},
                                               {'FIELDNAME': 'TABKAT'},
                                               {'FIELDNAME': 'MAINTVIEW'},
                                               {'FIELDNAME': 'EXCLASS'}])
            
            if result['DATA']:
                fields = result['DATA'][0]['WA'].split('|')
                if len(fields) >= 6:
                    return {
                        'TABNAME': fields[0],
                        'DDTEXT': fields[1],
                        'TABCLASS': fields[2],
                        'TABKAT': fields[3],
                        'MAINTVIEW': fields[4],
                        'EXCLASS': fields[5]
                    }
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting table info for {table_name}: {e}")
            return None
    
    async def _get_view_info(self, view_name: str) -> Optional[Dict[str, Any]]:
        """Get detailed information for a specific view"""
        try:
            result = self.connection.call('RFC_READ_TABLE', 
                                        QUERY_TABLE='DD25L',
                                        DELIMITER='|',
                                        OPTIONS=[{'TEXT': f"VIEWNAME = '{view_name}'"}],
                                        FIELDS=[{'FIELDNAME': 'VIEWNAME'},
                                               {'FIELDNAME': 'DDTEXT'},
                                               {'FIELDNAME': 'VIEWCAT'},
                                               {'FIELDNAME': 'MAINTVIEW'},
                                               {'FIELDNAME': 'EXCLASS'}])
            
            if result['DATA']:
                fields = result['DATA'][0]['WA'].split('|')
                if len(fields) >= 5:
                    return {
                        'VIEWNAME': fields[0],
                        'DDTEXT': fields[1],
                        'VIEWCAT': fields[2],
                        'MAINTVIEW': fields[3],
                        'EXCLASS': fields[4]
                    }
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting view info for {view_name}: {e}")
            return None
    
    async def _get_table_fields(self, table_name: str) -> List[Dict[str, Any]]:
        """Get fields for a specific table"""
        try:
            result = self.connection.call('RFC_READ_TABLE', 
                                        QUERY_TABLE='DD03L',
                                        DELIMITER='|',
                                        OPTIONS=[{'TEXT': f"TABNAME = '{table_name}'"}],
                                        FIELDS=[{'FIELDNAME': 'FIELDNAME'},
                                               {'FIELDNAME': 'DDTEXT'},
                                               {'FIELDNAME': 'DATATYPE'},
                                               {'FIELDNAME': 'LENG'},
                                               {'FIELDNAME': 'DECIMALS'},
                                               {'FIELDNAME': 'KEYFLAG'},
                                               {'FIELDNAME': 'NOTNULL'},
                                               {'FIELDNAME': 'CHECKTABLE'},
                                               {'FIELDNAME': 'CHECKFIELD'}])
            
            fields = []
            for row in result['DATA']:
                field_data = row['WA'].split('|')
                if len(field_data) >= 8:
                    fields.append({
                        'FIELDNAME': field_data[0],
                        'DDTEXT': field_data[1],
                        'DATATYPE': field_data[2],
                        'LENG': field_data[3],
                        'DECIMALS': field_data[4],
                        'KEYFLAG': field_data[5],
                        'NOTNULL': field_data[6],
                        'CHECKTABLE': field_data[7],
                        'CHECKFIELD': field_data[8] if len(field_data) > 8 else ''
                    })
            
            return fields
            
        except Exception as e:
            logger.error(f"Error getting table fields for {table_name}: {e}")
            return []
    
    async def _convert_to_table_metadata(self, table_info: Dict[str, Any], is_view: bool = False) -> TableMetadata:
        """Convert SAP table info to TableMetadata"""
        table_name = table_info.get('TABNAME') or table_info.get('VIEWNAME')
        
        table_metadata = TableMetadata(
            name=table_name,
            label=table_info.get('DDTEXT', table_name),
            description=table_info.get('DDTEXT'),
            system_type=SystemType.SAP,
            system_attributes=table_info
        )
        
        # Get columns
        columns = await self.get_columns(table_name)
        table_metadata.columns = columns
        
        return table_metadata
    
    async def _convert_field_to_column(self, field: Dict[str, Any]) -> ColumnMetadata:
        """Convert SAP field to ColumnMetadata"""
        # Map SAP data types to our DataType enum
        type_mapping = {
            'CHAR': DataType.STRING,
            'NUMC': DataType.STRING,
            'CLNT': DataType.STRING,
            'CUKY': DataType.STRING,
            'LANG': DataType.STRING,
            'UNIT': DataType.STRING,
            'INT1': DataType.INTEGER,
            'INT2': DataType.INTEGER,
            'INT4': DataType.INTEGER,
            'DEC': DataType.DECIMAL,
            'CURR': DataType.CURRENCY,
            'QUAN': DataType.DECIMAL,
            'FLTP': DataType.DECIMAL,
            'DATS': DataType.DATE,
            'TIMS': DataType.STRING,
            'TEXT': DataType.TEXT,
            'RAW': DataType.STRING,
            'LRAW': DataType.STRING
        }
        
        data_type = type_mapping.get(field['DATATYPE'], DataType.STRING)
        length = int(field['LENG']) if field['LENG'] else None
        scale = int(field['DECIMALS']) if field['DECIMALS'] else None
        
        # Determine if it's a foreign key
        is_foreign_key = bool(field.get('CHECKTABLE'))
        referenced_table = field.get('CHECKTABLE')
        referenced_column = field.get('CHECKFIELD')
        
        return ColumnMetadata(
            name=field['FIELDNAME'],
            label=field.get('DDTEXT', field['FIELDNAME']),
            data_type=data_type,
            length=length,
            scale=scale,
            nullable=field.get('NOTNULL', '') != 'X',
            primary_key=field.get('KEYFLAG', '') == 'X',
            foreign_key=is_foreign_key,
            referenced_table=referenced_table,
            referenced_column=referenced_column,
            description=field.get('DDTEXT'),
            system_attributes={
                'sap_datatype': field['DATATYPE'],
                'sap_length': field['LENG'],
                'sap_decimals': field['DECIMALS'],
                'key_flag': field.get('KEYFLAG', ''),
                'not_null': field.get('NOTNULL', ''),
                'check_table': field.get('CHECKTABLE', ''),
                'check_field': field.get('CHECKFIELD', '')
            }
        )