import { Router } from 'express';

export function createAgentAssetRouter(agentAssetService) {
  const router = Router();
  router.get('/', async (_req, res) => res.json(await agentAssetService.list()));
  return router;
}