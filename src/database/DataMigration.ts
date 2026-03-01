import { PouchDBManager } from './PouchDBManager';
import { Card as FSRSCard, Rating } from 'ts-fsrs';

export interface LegacyPluginData {
    settings: {
        deckTag: string;
        newCardsPerDay: number;
        reviewsPerDay: number;
        fontSize: number;
        fsrsParams: {
            request_retention: number;
            maximum_interval: number;
            w: number[];
        };
    };
    cardData: Record<string, FSRSCard>;
    reviewHistory: Array<{
        cardId: string;
        timestamp: number;
        rating: Rating;
    }>;
}

export class DataMigration {
    private pouchDB: PouchDBManager;

    constructor(pouchDB: PouchDBManager) {
        this.pouchDB = pouchDB;
    }

    /**
     * Migrate from legacy data.json format to PouchDB
     */
    async migrateFromLegacy(legacyData: LegacyPluginData, deckMapping: Record<string, { deckId: string; filePath: string }>): Promise<void> {
        console.debug('Starting migration from legacy data.json to PouchDB...');
        
        try {
            // 1. Migrate Settings
            console.debug('Migrating settings...');
            await this.pouchDB.saveSettings(legacyData.settings);

            // 2. Migrate Card States
            console.debug(`Migrating ${Object.keys(legacyData.cardData).length} card states...`);
            let migratedCards = 0;
            let skippedCards = 0;

            for (const [cardId, fsrsData] of Object.entries(legacyData.cardData)) {
                const mapping = deckMapping[cardId];
                
                if (!mapping) {
                    // Debug log instead of warning for orphaned cards
                    console.debug(`No deck mapping found for card: ${cardId} (orphaned)`);
                    skippedCards++;
                    continue;
                }

                try {
                    await this.pouchDB.saveCardState(
                        cardId,
                        mapping.deckId,
                        mapping.filePath,
                        fsrsData
                    );
                    migratedCards++;
                } catch (error) {
                    console.error(`Failed to migrate card ${cardId}:`, error);
                    skippedCards++;
                }
            }

            console.debug(`Card states migrated: ${migratedCards}, skipped: ${skippedCards}`);

            // 3. Migrate Review History
            console.debug(`Migrating ${legacyData.reviewHistory.length} review logs...`);
            let migratedLogs = 0;

            for (const log of legacyData.reviewHistory) {
                try {
                    await this.pouchDB.addReviewLog(log.cardId, log.timestamp, log.rating);
                    migratedLogs++;
                } catch (error) {
                    console.error(`Failed to migrate review log:`, error);
                }
            }

            console.debug(`Review logs migrated: ${migratedLogs}`);
            console.debug('Migration completed successfully!');

        } catch (error) {
            console.error('Migration failed:', error);
            throw error;
        }
    }

    /**
     * Export current PouchDB data to legacy format (for backup)
     */
    async exportToLegacyFormat(): Promise<LegacyPluginData> {
        console.debug('Exporting PouchDB data to legacy format...');

        const settings = await this.pouchDB.getSettings();
        const cardStates = await this.pouchDB.getAllCardStates();
        const reviewHistory = await this.pouchDB.getReviewHistory();

        if (!settings) {
            throw new Error('Settings not found in database');
        }

        return {
            settings,
            cardData: cardStates,
            reviewHistory
        };
    }

    /**
     * Verify migration integrity
     */
    async verifyMigration(legacyData: LegacyPluginData): Promise<{
        success: boolean;
        errors: string[];
        stats: {
            totalCards: number;
            migratedCards: number;
            totalLogs: number;
            migratedLogs: number;
        };
    }> {
        console.debug('Verifying migration...');
        const errors: string[] = [];

        // Check settings
        const settings = await this.pouchDB.getSettings();
        if (!settings) {
            errors.push('Settings not migrated');
        }

        // Check card states
        const cardStates = await this.pouchDB.getAllCardStates();
        const totalCards = Object.keys(legacyData.cardData).length;
        const migratedCards = Object.keys(cardStates).length;

        if (migratedCards < totalCards) {
            errors.push(`Only ${migratedCards}/${totalCards} cards migrated`);
        }

        // Check review logs
        const reviewHistory = await this.pouchDB.getReviewHistory();
        const totalLogs = legacyData.reviewHistory.length;
        const migratedLogs = reviewHistory.length;

        if (migratedLogs < totalLogs) {
            errors.push(`Only ${migratedLogs}/${totalLogs} review logs migrated`);
        }

        return {
            success: errors.length === 0,
            errors,
            stats: {
                totalCards,
                migratedCards,
                totalLogs,
                migratedLogs
            }
        };
    }
}
