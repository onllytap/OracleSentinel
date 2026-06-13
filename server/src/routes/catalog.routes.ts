import { Router } from 'express';
import express from 'express';
import { requireAdminApiKey } from '../middleware/admin-api-key';
import { CatalogImportService } from '../services/catalog-import.service';

const router = Router();

router.post(
  '/import/dry-run',
  requireAdminApiKey(),
  express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '20mb' }),
  async (req, res) => {
    try {
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
      if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id requis' });
      }

      const xmlText = typeof req.body === 'string' ? req.body : '';
      if (!xmlText || xmlText.length < 10) {
        return res.status(400).json({ error: 'XML requis' });
      }

      const result = await CatalogImportService.runImport({ tenantId, xmlText, mode: 'dry_run' });
      return res.json({ success: true, ...result });
    } catch (error) {
      console.error('Catalog dry-run failed:', error);
      return res.status(500).json({ success: false, error: 'Import dry-run failed' });
    }
  }
);

router.post(
  '/import/commit',
  requireAdminApiKey(),
  express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '20mb' }),
  async (req, res) => {
    try {
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
      if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id requis' });
      }

      const xmlText = typeof req.body === 'string' ? req.body : '';
      if (!xmlText || xmlText.length < 10) {
        return res.status(400).json({ error: 'XML requis' });
      }

      const result = await CatalogImportService.runImport({ tenantId, xmlText, mode: 'commit' });
      return res.json({ success: true, ...result });
    } catch (error) {
      console.error('Catalog commit failed:', error);
      return res.status(500).json({ success: false, error: 'Import commit failed' });
    }
  }
);

export default router;
