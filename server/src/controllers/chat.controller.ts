import { Request, Response } from 'express';
import { ChatService } from '../services/chat.service';

export class ChatController {
    static async sendMessage(req: Request, res: Response) {
        try {
            const { session_id, message } = req.body;

            if (!session_id || !message) {
                return res.status(400).json({ error: 'Missing session_id or message' });
            }

            const result = await ChatService.processMessage(session_id, message);
            return res.json(result);
        } catch (error) {
            console.error('Error in sendMessage:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }
}
