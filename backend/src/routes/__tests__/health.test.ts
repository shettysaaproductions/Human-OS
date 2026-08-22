jest.mock('../../lib/nvidia', () => ({
  getNvidiaRoutingStatus: jest.fn(() => ({
    configured: true,
    regions: { frontal: 1, hippocampus: 1, cerebellum: 1, deepCortex: 1, reserve: 1 },
  })),
}));

import { healthRouter } from '../health';
import { getNvidiaRoutingStatus } from '../../lib/nvidia';

describe('public NVIDIA health', () => {
  it('reports configuration only and does not invoke a completion route', () => {
    const layer = (healthRouter as any).stack.find((entry: any) => entry.route?.path === '/keys');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;

    layer.route.stack[0].handle({} as any, res);

    expect(getNvidiaRoutingStatus).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ nvidia: expect.objectContaining({ configured: true }) }));
  });
});
