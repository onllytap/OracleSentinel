import { NextFunction, Request, Response, Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { requireWidgetAuth } from '../middleware/widget-auth';

const router = Router();

function requireExplicitWidgetHistoryRead(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (process.env.WIDGET_HISTORY_READ_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

router.post('/chat', requireWidgetAuth(['chat:write']), ChatController.sendMessage);

router.get(
  '/conversations',
  requireExplicitWidgetHistoryRead,
  requireWidgetAuth(['chat:read']),
  ChatController.listConversations,
);
router.get(
  '/conversations/:sessionId/messages',
  requireExplicitWidgetHistoryRead,
  requireWidgetAuth(['chat:read']),
  ChatController.getConversationMessages,
);

router.post('/leads', requireWidgetAuth(['chat:write']), ChatController.submitLeadForm);

export default router;
