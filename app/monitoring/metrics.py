import time
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from collections import defaultdict, deque
from dataclasses import dataclass, field
from loguru import logger


@dataclass
class MetricPoint:
    """A single metric data point"""
    timestamp: datetime
    value: float
    labels: Dict[str, str] = field(default_factory=dict)


@dataclass
class Metric:
    """A metric with multiple data points"""
    name: str
    description: str
    data_points: deque = field(default_factory=lambda: deque(maxlen=1000))
    labels: Dict[str, str] = field(default_factory=dict)


class MetricsCollector:
    """Collects and stores metrics for the metadata agent"""
    
    def __init__(self):
        self.metrics: Dict[str, Metric] = {}
        self.counters: Dict[str, int] = defaultdict(int)
        self.timers: Dict[str, float] = {}
        self.gauges: Dict[str, float] = {}
    
    def increment_counter(self, name: str, value: int = 1, labels: Optional[Dict[str, str]] = None):
        """Increment a counter metric"""
        self.counters[name] += value
        self._add_metric_point(name, self.counters[name], labels, "counter")
    
    def set_gauge(self, name: str, value: float, labels: Optional[Dict[str, str]] = None):
        """Set a gauge metric"""
        self.gauges[name] = value
        self._add_metric_point(name, value, labels, "gauge")
    
    def start_timer(self, name: str) -> str:
        """Start a timer and return timer ID"""
        timer_id = f"{name}_{int(time.time() * 1000)}"
        self.timers[timer_id] = time.time()
        return timer_id
    
    def end_timer(self, timer_id: str, labels: Optional[Dict[str, str]] = None):
        """End a timer and record the duration"""
        if timer_id in self.timers:
            duration = time.time() - self.timers[timer_id]
            del self.timers[timer_id]
            
            # Extract metric name from timer ID
            metric_name = timer_id.rsplit('_', 1)[0]
            self._add_metric_point(metric_name, duration, labels, "histogram")
    
    def _add_metric_point(self, name: str, value: float, labels: Optional[Dict[str, str]], metric_type: str):
        """Add a data point to a metric"""
        if name not in self.metrics:
            self.metrics[name] = Metric(
                name=name,
                description=f"{metric_type} metric for {name}",
                labels=labels or {}
            )
        
        metric = self.metrics[name]
        metric.data_points.append(MetricPoint(
            timestamp=datetime.utcnow(),
            value=value,
            labels=labels or {}
        ))
    
    def get_metric(self, name: str) -> Optional[Metric]:
        """Get a specific metric"""
        return self.metrics.get(name)
    
    def get_all_metrics(self) -> Dict[str, Metric]:
        """Get all metrics"""
        return self.metrics.copy()
    
    def get_metric_summary(self, name: str, time_window: Optional[timedelta] = None) -> Optional[Dict[str, Any]]:
        """Get summary statistics for a metric"""
        metric = self.get_metric(name)
        if not metric or not metric.data_points:
            return None
        
        # Filter by time window if specified
        data_points = metric.data_points
        if time_window:
            cutoff_time = datetime.utcnow() - time_window
            data_points = [dp for dp in data_points if dp.timestamp >= cutoff_time]
        
        if not data_points:
            return None
        
        values = [dp.value for dp in data_points]
        
        return {
            "name": name,
            "count": len(values),
            "min": min(values),
            "max": max(values),
            "avg": sum(values) / len(values),
            "latest": values[-1] if values else None,
            "time_window": str(time_window) if time_window else "all"
        }
    
    def get_system_metrics(self) -> Dict[str, Any]:
        """Get system-wide metrics summary"""
        return {
            "total_metrics": len(self.metrics),
            "active_timers": len(self.timers),
            "counters": dict(self.counters),
            "gauges": dict(self.gauges),
            "timestamp": datetime.utcnow().isoformat()
        }


# Global metrics collector instance
metrics_collector = MetricsCollector()


def get_metrics_collector() -> MetricsCollector:
    """Get the global metrics collector instance"""
    return metrics_collector


# Decorator for timing functions
def time_function(metric_name: str, labels: Optional[Dict[str, str]] = None):
    """Decorator to time function execution"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            timer_id = metrics_collector.start_timer(metric_name)
            try:
                result = func(*args, **kwargs)
                return result
            finally:
                metrics_collector.end_timer(timer_id, labels)
        return wrapper
    return decorator


# Context manager for timing code blocks
class Timer:
    """Context manager for timing code blocks"""
    
    def __init__(self, metric_name: str, labels: Optional[Dict[str, str]] = None):
        self.metric_name = metric_name
        self.labels = labels
        self.timer_id = None
    
    def __enter__(self):
        self.timer_id = metrics_collector.start_timer(self.metric_name)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.timer_id:
            metrics_collector.end_timer(self.timer_id, self.labels)