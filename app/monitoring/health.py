from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum
from app.monitoring.metrics import get_metrics_collector


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class HealthCheck:
    """Individual health check result"""
    name: str
    status: HealthStatus
    message: str
    details: Optional[Dict[str, Any]] = None
    timestamp: datetime = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()


@dataclass
class SystemHealth:
    """Overall system health status"""
    status: HealthStatus
    checks: List[HealthCheck]
    timestamp: datetime
    uptime: Optional[float] = None
    version: str = "1.0.0"


class HealthChecker:
    """Health checking service for the metadata agent"""
    
    def __init__(self):
        self.start_time = datetime.utcnow()
        self.metrics_collector = get_metrics_collector()
        self.custom_checks = {}
    
    def register_check(self, name: str, check_func):
        """Register a custom health check function"""
        self.custom_checks[name] = check_func
    
    async def check_system_health(self) -> SystemHealth:
        """Perform all health checks and return overall status"""
        checks = []
        
        # Basic system checks
        checks.append(self._check_uptime())
        checks.append(self._check_memory_usage())
        checks.append(self._check_metrics_collection())
        
        # Custom checks
        for name, check_func in self.custom_checks.items():
            try:
                check_result = await check_func() if callable(check_func) else check_func
                if isinstance(check_result, HealthCheck):
                    checks.append(check_result)
                else:
                    checks.append(HealthCheck(
                        name=name,
                        status=HealthStatus.HEALTHY if check_result else HealthStatus.UNHEALTHY,
                        message="Custom check completed"
                    ))
            except Exception as e:
                checks.append(HealthCheck(
                    name=name,
                    status=HealthStatus.UNHEALTHY,
                    message=f"Custom check failed: {str(e)}"
                ))
        
        # Determine overall status
        overall_status = self._determine_overall_status(checks)
        
        # Calculate uptime
        uptime = (datetime.utcnow() - self.start_time).total_seconds()
        
        return SystemHealth(
            status=overall_status,
            checks=checks,
            timestamp=datetime.utcnow(),
            uptime=uptime
        )
    
    def _check_uptime(self) -> HealthCheck:
        """Check system uptime"""
        uptime = (datetime.utcnow() - self.start_time).total_seconds()
        
        if uptime < 60:  # Less than 1 minute
            status = HealthStatus.DEGRADED
            message = "System recently started"
        elif uptime < 300:  # Less than 5 minutes
            status = HealthStatus.HEALTHY
            message = "System running normally"
        else:
            status = HealthStatus.HEALTHY
            message = "System running stably"
        
        return HealthCheck(
            name="uptime",
            status=status,
            message=message,
            details={"uptime_seconds": uptime}
        )
    
    def _check_memory_usage(self) -> HealthCheck:
        """Check memory usage"""
        try:
            import psutil
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            
            if memory_percent < 70:
                status = HealthStatus.HEALTHY
                message = "Memory usage normal"
            elif memory_percent < 90:
                status = HealthStatus.DEGRADED
                message = "Memory usage high"
            else:
                status = HealthStatus.UNHEALTHY
                message = "Memory usage critical"
            
            return HealthCheck(
                name="memory",
                status=status,
                message=message,
                details={
                    "memory_percent": memory_percent,
                    "available_mb": memory.available // (1024 * 1024),
                    "total_mb": memory.total // (1024 * 1024)
                }
            )
        except ImportError:
            return HealthCheck(
                name="memory",
                status=HealthStatus.UNKNOWN,
                message="Memory check not available (psutil not installed)"
            )
        except Exception as e:
            return HealthCheck(
                name="memory",
                status=HealthStatus.UNHEALTHY,
                message=f"Memory check failed: {str(e)}"
            )
    
    def _check_metrics_collection(self) -> HealthCheck:
        """Check metrics collection system"""
        try:
            system_metrics = self.metrics_collector.get_system_metrics()
            total_metrics = system_metrics.get("total_metrics", 0)
            
            if total_metrics > 0:
                status = HealthStatus.HEALTHY
                message = "Metrics collection working"
            else:
                status = HealthStatus.DEGRADED
                message = "No metrics collected yet"
            
            return HealthCheck(
                name="metrics",
                status=status,
                message=message,
                details=system_metrics
            )
        except Exception as e:
            return HealthCheck(
                name="metrics",
                status=HealthStatus.UNHEALTHY,
                message=f"Metrics check failed: {str(e)}"
            )
    
    def _determine_overall_status(self, checks: List[HealthCheck]) -> HealthStatus:
        """Determine overall system status based on individual checks"""
        if not checks:
            return HealthStatus.UNKNOWN
        
        statuses = [check.status for check in checks]
        
        if HealthStatus.UNHEALTHY in statuses:
            return HealthStatus.UNHEALTHY
        elif HealthStatus.DEGRADED in statuses:
            return HealthStatus.DEGRADED
        elif all(status == HealthStatus.HEALTHY for status in statuses):
            return HealthStatus.HEALTHY
        else:
            return HealthStatus.UNKNOWN
    
    def get_health_summary(self) -> Dict[str, Any]:
        """Get a summary of system health"""
        return {
            "start_time": self.start_time.isoformat(),
            "uptime_seconds": (datetime.utcnow() - self.start_time).total_seconds(),
            "registered_checks": list(self.custom_checks.keys()),
            "metrics_summary": self.metrics_collector.get_system_metrics()
        }


# Global health checker instance
health_checker = HealthChecker()


def get_health_checker() -> HealthChecker:
    """Get the global health checker instance"""
    return health_checker