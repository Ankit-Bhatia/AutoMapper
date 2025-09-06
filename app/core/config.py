from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    # Salesforce Configuration
    salesforce_username: str
    salesforce_password: str
    salesforce_security_token: str
    salesforce_domain: str = "login.salesforce.com"
    
    # SAP Configuration
    sap_ashost: str
    sap_sysnr: str = "00"
    sap_client: str = "100"
    sap_user: str
    sap_passwd: str
    sap_lang: str = "EN"
    
    # Database Configuration
    database_url: str
    
    # API Configuration
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_debug: bool = True
    
    # Logging
    log_level: str = "INFO"
    log_file: str = "logs/metadata_agent.log"
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()