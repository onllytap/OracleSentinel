import { Router } from 'express';
import { KnowledgeService } from '../services/knowledge.service';

const router = Router();

/**
 * POST /api/knowledge/refresh
 * Force refresh the knowledge cache (admin endpoint)
 */
router.post('/refresh', async (req, res) => {
    try {
        console.log('🔄 Knowledge cache refresh requested');
        KnowledgeService.clearCache();
        const chunks = await KnowledgeService.fetchAllKnowledge();

        res.json({
            success: true,
            message: 'Knowledge cache refreshed',
            pagesLoaded: chunks.length,
            pages: chunks.map(c => ({ title: c.title, url: c.url }))
        });
    } catch (error) {
        console.error('❌ Knowledge refresh failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to refresh knowledge cache'
        });
    }
});

/**
 * GET /api/knowledge/status
 * Get cache status
 */
router.get('/status', (req, res) => {
    const stats = KnowledgeService.getCacheStats();
    res.json({
        cacheSize: stats.size,
        cachedUrls: stats.urls
    });
});

export default router;
