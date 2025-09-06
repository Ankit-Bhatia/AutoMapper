#!/usr/bin/env python3
"""
Example workflow demonstrating custom mapping management
for the Metadata Automation Agent
"""

import asyncio
import json
import requests
from typing import Dict, Any


class MetadataAgentClient:
    """Client for interacting with the Metadata Automation Agent API"""
    
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.session = requests.Session()
    
    def test_connection(self, system_type: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Test connection to a system"""
        response = self.session.post(
            f"{self.base_url}/api/v1/metadata/test-connection",
            json={
                "system_type": system_type,
                "config": config
            }
        )
        return response.json()
    
    def extract_metadata(self, system_type: str, config: Dict[str, Any], object_names: list = None) -> Dict[str, Any]:
        """Extract metadata from a system"""
        payload = {
            "system_type": system_type,
            "config": config
        }
        if object_names:
            payload["object_names"] = object_names
        
        response = self.session.post(
            f"{self.base_url}/api/v1/metadata/extract",
            json=payload
        )
        return response.json()
    
    def compare_metadata(self, source_system: str, target_system: str, 
                        source_config: Dict[str, Any], target_config: Dict[str, Any]) -> Dict[str, Any]:
        """Compare metadata between systems"""
        response = self.session.post(
            f"{self.base_url}/api/v1/metadata/compare",
            json={
                "source_system": source_system,
                "target_system": target_system,
                "source_config": source_config,
                "target_config": target_config
            }
        )
        return response.json()
    
    def export_columns_csv(self, system_type: str = None, include_custom_mappings: bool = True) -> str:
        """Export columns to CSV"""
        params = {"include_custom_mappings": include_custom_mappings}
        if system_type:
            params["system_type"] = system_type
        
        response = self.session.get(
            f"{self.base_url}/api/v1/export/columns/csv",
            params=params
        )
        
        # Save the file
        filename = f"columns_export_{system_type or 'all'}.csv"
        with open(filename, 'wb') as f:
            f.write(response.content)
        
        return filename
    
    def export_complete_excel(self, system_type: str = None) -> str:
        """Export complete metadata to Excel"""
        params = {}
        if system_type:
            params["system_type"] = system_type
        
        response = self.session.get(
            f"{self.base_url}/api/v1/export/complete/excel",
            params=params
        )
        
        # Save the file
        filename = f"complete_metadata_{system_type or 'all'}.xlsx"
        with open(filename, 'wb') as f:
            f.write(response.content)
        
        return filename
    
    def get_columns_for_review(self, system_type: str = None, has_custom_mapping: bool = None) -> Dict[str, Any]:
        """Get columns for review"""
        params = {}
        if system_type:
            params["system_type"] = system_type
        if has_custom_mapping is not None:
            params["has_custom_mapping"] = has_custom_mapping
        
        response = self.session.get(
            f"{self.base_url}/api/v1/review/columns",
            params=params
        )
        return response.json()
    
    def update_column_metadata(self, column_id: int, updates: Dict[str, Any], updated_by: str) -> Dict[str, Any]:
        """Update column metadata"""
        response = self.session.put(
            f"{self.base_url}/api/v1/review/columns/{column_id}",
            json=updates,
            params={"updated_by": updated_by}
        )
        return response.json()
    
    def get_mappings_for_review(self, source_system: str = None, target_system: str = None) -> Dict[str, Any]:
        """Get mappings for review"""
        params = {}
        if source_system:
            params["source_system"] = source_system
        if target_system:
            params["target_system"] = target_system
        
        response = self.session.get(
            f"{self.base_url}/api/v1/review/mappings",
            params=params
        )
        return response.json()
    
    def create_mapping(self, mapping_data: Dict[str, Any], created_by: str) -> Dict[str, Any]:
        """Create new mapping"""
        response = self.session.post(
            f"{self.base_url}/api/v1/review/mappings",
            json=mapping_data,
            params={"created_by": created_by}
        )
        return response.json()
    
    def get_review_summary(self) -> Dict[str, Any]:
        """Get review summary"""
        response = self.session.get(f"{self.base_url}/api/v1/review/summary")
        return response.json()


def demonstrate_custom_mapping_workflow():
    """Demonstrate the complete custom mapping workflow"""
    
    print("🚀 Metadata Automation Agent - Custom Mapping Workflow Demo")
    print("=" * 60)
    
    # Initialize client
    client = MetadataAgentClient()
    
    # Example configurations (replace with your actual credentials)
    salesforce_config = {
        "username": "your_salesforce_username",
        "password": "your_salesforce_password",
        "security_token": "your_salesforce_security_token",
        "domain": "login"
    }
    
    sap_config = {
        "ashost": "your_sap_host",
        "sysnr": "00",
        "client": "100",
        "user": "your_sap_user",
        "passwd": "your_sap_password",
        "lang": "EN"
    }
    
    try:
        # Step 1: Test connections
        print("\n1️⃣ Testing system connections...")
        
        sf_connection = client.test_connection("salesforce", salesforce_config)
        print(f"   Salesforce connection: {'✅ Success' if sf_connection.get('connected') else '❌ Failed'}")
        
        sap_connection = client.test_connection("sap", sap_config)
        print(f"   SAP connection: {'✅ Success' if sap_connection.get('connected') else '❌ Failed'}")
        
        if not (sf_connection.get('connected') and sap_connection.get('connected')):
            print("   ⚠️  Please check your credentials and try again")
            return
        
        # Step 2: Extract metadata
        print("\n2️⃣ Extracting metadata from both systems...")
        
        sf_metadata = client.extract_metadata("salesforce", salesforce_config, ["Account", "Contact"])
        print(f"   Salesforce objects extracted: {sf_metadata.get('object_count', 0)}")
        
        sap_metadata = client.extract_metadata("sap", sap_config)
        print(f"   SAP objects extracted: {sap_metadata.get('object_count', 0)}")
        
        # Step 3: Compare metadata
        print("\n3️⃣ Comparing metadata between systems...")
        
        comparison = client.compare_metadata(
            "salesforce", "sap", 
            salesforce_config, sap_config
        )
        
        if comparison.get('status') == 'success':
            summary = comparison.get('summary', {})
            print(f"   Total objects compared: {summary.get('total_objects', 0)}")
            print(f"   Identical: {summary.get('identical', 0)}")
            print(f"   Different: {summary.get('different', 0)}")
            print(f"   Missing in target: {summary.get('missing_in_target', 0)}")
            print(f"   Sync percentage: {summary.get('sync_percentage', 0)}%")
        
        # Step 4: Export metadata for review
        print("\n4️⃣ Exporting metadata for review...")
        
        # Export columns to CSV
        columns_csv = client.export_columns_csv("salesforce")
        print(f"   ✅ Exported Salesforce columns to: {columns_csv}")
        
        # Export complete metadata to Excel
        complete_excel = client.export_complete_excel()
        print(f"   ✅ Exported complete metadata to: {complete_excel}")
        
        # Step 5: Review and update custom mappings
        print("\n5️⃣ Reviewing existing custom mappings...")
        
        review_summary = client.get_review_summary()
        if review_summary.get('status') == 'success':
            summary = review_summary.get('summary', {})
            print(f"   Total objects: {summary.get('objects', {}).get('total', 0)}")
            print(f"   Custom objects: {summary.get('objects', {}).get('custom', 0)}")
            print(f"   Total tables: {summary.get('tables', {}).get('total', 0)}")
            print(f"   Custom tables: {summary.get('tables', {}).get('custom', 0)}")
            print(f"   Total columns: {summary.get('columns', {}).get('total', 0)}")
            print(f"   Custom columns: {summary.get('columns', {}).get('custom', 0)}")
            print(f"   Columns with notes: {summary.get('columns', {}).get('with_notes', 0)}")
            print(f"   Total mappings: {summary.get('mappings', {}).get('total', 0)}")
            print(f"   Pending mappings: {summary.get('mappings', {}).get('pending', 0)}")
            print(f"   Approved mappings: {summary.get('mappings', {}).get('approved', 0)}")
        
        # Step 6: Get columns for review
        print("\n6️⃣ Getting columns for review...")
        
        columns_for_review = client.get_columns_for_review("salesforce", has_custom_mapping=False)
        if columns_for_review.get('status') == 'success':
            columns = columns_for_review.get('columns', [])
            print(f"   Found {len(columns)} Salesforce columns without custom mappings")
            
            # Show first few columns as examples
            for i, col in enumerate(columns[:3]):
                print(f"   - {col.get('name')} ({col.get('data_type')}) in {col.get('table_name')}")
        
        # Step 7: Create example custom mapping
        print("\n7️⃣ Creating example custom mapping...")
        
        # Example: Create a mapping between Salesforce Account and SAP KNA1
        example_mapping = {
            "source_system": "salesforce",
            "target_system": "sap",
            "source_object": "Account",
            "target_object": "KNA1",
            "mapping_type": "object",
            "mapping_notes": "Customer master mapping - Account to KNA1",
            "custom_transformation": {
                "field_mappings": {
                    "Name": "NAME1",
                    "Phone": "TEL_NUMBER",
                    "Email": "SMTP_ADDR"
                },
                "data_type_conversions": {
                    "string": "CHAR",
                    "phone": "CHAR",
                    "email": "CHAR"
                }
            }
        }
        
        mapping_result = client.create_mapping(example_mapping, "demo_user")
        if mapping_result.get('status') == 'success':
            print(f"   ✅ Created mapping: {example_mapping['source_object']} -> {example_mapping['target_object']}")
        else:
            print(f"   ⚠️  Mapping creation result: {mapping_result.get('message', 'Unknown error')}")
        
        # Step 8: Get mappings for review
        print("\n8️⃣ Getting mappings for review...")
        
        mappings = client.get_mappings_for_review("salesforce", "sap")
        if mappings.get('status') == 'success':
            mapping_list = mappings.get('mappings', [])
            print(f"   Found {len(mapping_list)} Salesforce -> SAP mappings")
            
            for mapping in mapping_list[:3]:
                print(f"   - {mapping.get('source_object')} -> {mapping.get('target_object')} "
                      f"({mapping.get('mapping_status')})")
        
        print("\n🎉 Custom mapping workflow demonstration completed!")
        print("\nNext steps:")
        print("1. Review the exported CSV and Excel files")
        print("2. Update custom mappings in the files")
        print("3. Import the updated mappings back to the system")
        print("4. Use the mappings for metadata synchronization")
        
    except Exception as e:
        print(f"\n❌ Error during workflow demonstration: {e}")
        print("Please ensure the Metadata Automation Agent is running on http://localhost:8000")


def create_sample_custom_mapping_file():
    """Create a sample CSV file with custom mappings"""
    
    print("\n📝 Creating sample custom mapping file...")
    
    sample_data = [
        {
            "column_name": "AccountName",
            "table_name": "Account",
            "object_name": "Account",
            "custom_data_type": "string",
            "custom_label": "Account Name",
            "custom_description": "Name of the account - maps to SAP KNA1.NAME1",
            "mapping_notes": "Direct mapping to SAP customer master name field",
            "updated_by": "admin"
        },
        {
            "column_name": "Phone",
            "table_name": "Account",
            "object_name": "Account",
            "custom_data_type": "string",
            "custom_label": "Phone Number",
            "custom_description": "Primary phone number - maps to SAP KNA1.TEL_NUMBER",
            "mapping_notes": "Phone number format may need transformation for SAP",
            "updated_by": "admin"
        },
        {
            "column_name": "Email",
            "table_name": "Account",
            "object_name": "Account",
            "custom_data_type": "email",
            "custom_label": "Email Address",
            "custom_description": "Primary email address - maps to SAP KNVK.SMTP_ADDR",
            "mapping_notes": "Email validation required before SAP import",
            "updated_by": "admin"
        }
    ]
    
    import csv
    
    filename = "sample_custom_mappings.csv"
    with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = sample_data[0].keys()
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        writer.writeheader()
        for row in sample_data:
            writer.writerow(row)
    
    print(f"   ✅ Created sample file: {filename}")
    print("   You can use this file as a template for importing custom mappings")


if __name__ == "__main__":
    print("Metadata Automation Agent - Custom Mapping Demo")
    print("This demo shows how to work with custom mappings for customer-specific systems")
    print()
    
    # Create sample file
    create_sample_custom_mapping_file()
    
    # Run the workflow demonstration
    demonstrate_custom_mapping_workflow()