import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export interface ChatVariables {
    [key: string]: string;
}

export class VariablesService {
    // Point to the server root .env
    private static filePath = path.join(__dirname, '../../.env');
    private static cache: ChatVariables | null = null;
    private static lastLoad = 0;
    private static RELOAD_INTERVAL = 30000; // Reload every 30s to be responsive

    static getVariables(): ChatVariables {
        // Cache simple
        if (this.cache && Date.now() - this.lastLoad < this.RELOAD_INTERVAL) {
            return this.cache;
        }

        try {
            if (fs.existsSync(this.filePath)) {
                // Read .env file directly
                const envConfig = dotenv.parse(fs.readFileSync(this.filePath));

                // Filter only keys starting with VAR_
                const variables: ChatVariables = {};
                for (const k in envConfig) {
                    if (k.startsWith('VAR_')) {
                        // Remove prefix for cleaner context usage
                        const cleanKey = k.replace(/^VAR_/, '');
                        variables[cleanKey] = envConfig[k];
                    }
                }

                this.cache = variables;
                this.lastLoad = Date.now();
                return this.cache;
            }
        } catch (error) {
            console.error('Failed to load .env variables:', error);
        }

        return {};
    }

    /**
     * Format variables as a string for the system prompt
     */
    static getFormattedContext(): string {
        const vars = this.getVariables();
        let context = "📌 INFO AGENT (Mises à jour dynamiques via .env) :\n";

        // If empty, return default message
        if (Object.keys(vars).length === 0) {
            return context + "- (Aucune variable définie)\n";
        }

        for (const [key, value] of Object.entries(vars)) {
            context += `- ${key}: ${value}\n`;
        }

        return context;
    }
}
