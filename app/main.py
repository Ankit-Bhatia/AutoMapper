from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
import sys
import os

# Add the app directory to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.api.metadata import router as metadata_router
from app.api.export import router as export_router
from app.api.review import router as review_router
from app.api.import import router as import_router
from app.core.config import settings

# Configure logging
logger.remove()  # Remove default handler
logger.add(
    sys.stdout,
    level=settings.log_level,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
)
logger.add(
    settings.log_file,
    level=settings.log_level,
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    rotation="10 MB",
    retention="7 days"
)

# Create FastAPI app
app = FastAPI(
    title="Metadata Automation Agent",
    description="An agent for automating metadata management across Salesforce and SAP systems",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(metadata_router)
app.include_router(export_router)
app.include_router(review_router)
app.include_router(import_router)

# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global exception handler caught: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "message": "Internal server error",
            "detail": str(exc) if settings.api_debug else "An error occurred"
        }
    )

# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info("Metadata Automation Agent starting up...")
    logger.info(f"API running on {settings.api_host}:{settings.api_port}")
    logger.info(f"Debug mode: {settings.api_debug}")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Metadata Automation Agent shutting down...")

# Root endpoint
@app.get("/")
async def root():
    return {
        "message": "Metadata Automation Agent",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/v1/metadata/health"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_debug,
        log_level=settings.log_level.lower()
    )