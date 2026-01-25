import { PropertyScraperService } from '../services/property-scraper.service';
import dotenv from 'dotenv';
import path from 'path';

// Force load env
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function checkScraping() {
    console.log('🔍 STARTING SCRAPER HEALTH CHECK...');

    try {
        const properties = await PropertyScraperService.scrapeAllProperties();

        console.log('\n📊 SCRAPING REPORT:');
        console.log(`----------------------------------------`);
        console.log(`Total Properties Found: ${properties.length}`);

        if (properties.length === 0) {
            console.error('❌ FAILURE: No properties found. Selectors might be broken or site is blocking.');
        } else {
            console.log('✅ SUCCESS: Scraper is working!');
            console.log('\nSample Property:');
            console.log(JSON.stringify(properties[0], null, 2));
        }

    } catch (error) {
        console.error('❌ CRITICAL ERROR:', error);
    } finally {
        await PropertyScraperService.closeBrowser();
        process.exit();
    }
}

checkScraping();
