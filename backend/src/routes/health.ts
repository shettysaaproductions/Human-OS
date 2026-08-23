import { Router, Request, Response } from 'express';
import { getNvidiaRoutingStatus } from '../lib/nvidia';

export const healthRouter = Router();

healthRouter.get('/keys', (_req: Request, res: Response): void => {
  // This intentionally never probes NVIDIA. The endpoint is public for platform
  // health checks, so it only exposes non-secret routing configuration state.
  const routing = getNvidiaRoutingStatus();
  res.status(routing.configured ? 200 : 503).json({
    timestamp: new Date().toISOString(),
    nvidia: routing,
  });
});

// Root health check for Render (healthCheckPath: /health)
healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Also add a simple liveness check
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Readiness check - verifies DB and keys
healthRouter.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { supabaseAdmin } = await import('../lib/supabase');

    // Quick DB ping
    await supabaseAdmin.from('profiles').select('id').limit(1);

    // Configuration-only check; never perform inference from a health route.
    const hasKeys = getNvidiaRoutingStatus().configured;

    if (hasKeys) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: { database: true, nvidiaKeys: true }
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: { database: true, nvidiaKeys: false },
        error: 'No NVIDIA API keys configured'
      });
    }
  } catch (err: any) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      checks: { database: false, nvidiaKeys: false },
      error: err.message
    });
  }
});

// Cognitive Health Endpoint
healthRouter.get('/cognitive', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { cognitiveHealthService } = await import('../services/CognitiveHealthService');
    const metrics = await cognitiveHealthService.getHealthMetrics();
    
    // Schedule maintenance if required and hit from cron/health check
    if (metrics.is_maintenance_required) {
      await cognitiveHealthService.scheduleMaintenanceJobs();
    }
    
    res.status(200).json({
      status: metrics.is_maintenance_required ? 'maintenance_required' : 'healthy',
      timestamp: new Date().toISOString(),
      metrics
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }
});
