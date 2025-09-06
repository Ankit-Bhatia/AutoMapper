from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from app.models.metadata import SystemType


class SalesforceConfig(BaseModel):
    """Salesforce connector configuration"""
    username: str = Field(..., description="Salesforce username")
    password: str = Field(..., description="Salesforce password")
    security_token: str = Field(..., description="Salesforce security token")
    domain: str = Field(default="login", description="Salesforce domain (login, test, custom)")
    sandbox: bool = Field(default=False, description="Whether to use sandbox environment")
    api_version: str = Field(default="58.0", description="Salesforce API version")
    timeout: int = Field(default=30, description="Request timeout in seconds")
    
    class Config:
        schema_extra = {
            "example": {
                "username": "user@company.com",
                "password": "password123",
                "security_token": "abc123def456",
                "domain": "login",
                "sandbox": False,
                "api_version": "58.0",
                "timeout": 30
            }
        }


class SAPConfig(BaseModel):
    """SAP connector configuration"""
    ashost: str = Field(..., description="SAP application server host")
    sysnr: str = Field(default="00", description="SAP system number")
    client: str = Field(default="100", description="SAP client number")
    user: str = Field(..., description="SAP username")
    passwd: str = Field(..., description="SAP password")
    lang: str = Field(default="EN", description="SAP language")
    trace: int = Field(default=0, description="RFC trace level")
    timeout: int = Field(default=30, description="Connection timeout in seconds")
    
    class Config:
        schema_extra = {
            "example": {
                "ashost": "sap-server.company.com",
                "sysnr": "00",
                "client": "100",
                "user": "SAP_USER",
                "passwd": "password123",
                "lang": "EN",
                "trace": 0,
                "timeout": 30
            }
        }


class ConnectorConfigManager:
    """Manages connector configurations"""
    
    def __init__(self):
        self.configs: Dict[str, Dict[str, Any]] = {}
    
    def add_salesforce_config(self, name: str, config: SalesforceConfig) -> None:
        """Add a Salesforce configuration"""
        self.configs[name] = {
            "system_type": SystemType.SALESFORCE,
            "config": config.dict()
        }
    
    def add_sap_config(self, name: str, config: SAPConfig) -> None:
        """Add an SAP configuration"""
        self.configs[name] = {
            "system_type": SystemType.SAP,
            "config": config.dict()
        }
    
    def get_config(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a configuration by name"""
        return self.configs.get(name)
    
    def get_all_configs(self) -> Dict[str, Dict[str, Any]]:
        """Get all configurations"""
        return self.configs.copy()
    
    def remove_config(self, name: str) -> bool:
        """Remove a configuration"""
        if name in self.configs:
            del self.configs[name]
            return True
        return False
    
    def validate_config(self, name: str) -> Dict[str, Any]:
        """Validate a configuration"""
        config = self.get_config(name)
        if not config:
            return {"valid": False, "error": "Configuration not found"}
        
        try:
            system_type = config["system_type"]
            config_data = config["config"]
            
            if system_type == SystemType.SALESFORCE:
                SalesforceConfig(**config_data)
            elif system_type == SystemType.SAP:
                SAPConfig(**config_data)
            else:
                return {"valid": False, "error": "Unknown system type"}
            
            return {"valid": True, "message": "Configuration is valid"}
        
        except Exception as e:
            return {"valid": False, "error": str(e)}
    
    def get_configs_by_system_type(self, system_type: SystemType) -> Dict[str, Dict[str, Any]]:
        """Get all configurations for a specific system type"""
        return {
            name: config for name, config in self.configs.items()
            if config["system_type"] == system_type
        }


# Global configuration manager instance
config_manager = ConnectorConfigManager()


def get_config_manager() -> ConnectorConfigManager:
    """Get the global configuration manager instance"""
    return config_manager