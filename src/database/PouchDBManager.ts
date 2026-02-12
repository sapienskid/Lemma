import PouchDB from 'pouchdb-browser';
import { Card as FSRSCard, Rating } from 'ts-fsrs';

// --- Database Document Interfaces ---

export interface CardStateDoc {
    _id: string;  // cardId
    _rev?: string;  // PouchDB revision
    type: 'card_state';
    cardId: string;
    deckId: string;
    filePath: string;
    
    // FSRS Data
    due: string;  // ISO date string
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    reps: number;
    lapses: number;
    state: number;  // State enum value
    last_review?: string;  // ISO date string
    
    // Timestamps
    created_at: string;
    updated_at: string;
}

export interface ReviewLogDoc {
    _id: string;  // timestamp-cardId
    _rev?: string;
    type: 'review_log';
    cardId: string;
    timestamp: number;
    rating: Rating;
    created_at: string;
}

export interface SettingsDoc {
    _id: 'settings';
    _rev?: string;
    type: 'settings';
    deckTag: string;
    newCardsPerDay: number;
    reviewsPerDay: number;
    fontSize: number;
    fsrsParams: {
        request_retention: number;
        maximum_interval: number;
        w: number[];
    };
    updated_at: string;
}

export interface SyncMetaDoc {
    _id: 'sync_meta';
    _rev?: string;
    type: 'sync_meta';
    lastSyncTime: string;
    remoteUrl?: string;
    syncEnabled: boolean;
}

type DatabaseDoc = CardStateDoc | ReviewLogDoc | SettingsDoc | SyncMetaDoc;

// --- PouchDB Manager Class ---

export class PouchDBManager {
    private db: PouchDB.Database;
    private syncHandler: PouchDB.Replication.Sync<{}> | null = null;
    private remoteUrl: string | null = null;
    private syncing: boolean = false;
    private retryCount: number = 0;
    private maxRetries: number = 5;
    private syncEventHandlers: {
        onChange?: (info: any) => void;
        onPaused?: (err: any) => void;
        onActive?: () => void;
        onError?: (err: any) => void;
        onComplete?: (info: any) => void;
    } = {};

    constructor(dbName: string = 'lemma_local') {
        this.db = new PouchDB(dbName);
        console.log('PouchDB initialized:', dbName);
    }
    
    isSyncing(): boolean {
        return this.syncing;
    }
    
    onSyncChange(handler: (info: any) => void) {
        this.syncEventHandlers.onChange = handler;
    }
    
    onSyncError(handler: (err: any) => void) {
        this.syncEventHandlers.onError = handler;
    }
    
    onSyncActive(handler: () => void) {
        this.syncEventHandlers.onActive = handler;
    }
    
    onSyncPaused(handler: (err: any) => void) {
        this.syncEventHandlers.onPaused = handler;
    }
    
    onSyncComplete(handler: (info: any) => void) {
        this.syncEventHandlers.onComplete = handler;
    }

    // --- Card State Operations ---

    async saveCardState(cardId: string, deckId: string, filePath: string, fsrsData: FSRSCard): Promise<void> {
        try {
            let doc: CardStateDoc;
            
            try {
                const existing = await this.db.get<CardStateDoc>(cardId);
                doc = {
                    ...existing,
                    deckId,
                    filePath,
                    due: fsrsData.due.toISOString(),
                    stability: fsrsData.stability,
                    difficulty: fsrsData.difficulty,
                    elapsed_days: fsrsData.elapsed_days,
                    scheduled_days: fsrsData.scheduled_days,
                    reps: fsrsData.reps,
                    lapses: fsrsData.lapses,
                    state: fsrsData.state,
                    last_review: fsrsData.last_review?.toISOString(),
                    updated_at: new Date().toISOString()
                };
            } catch (err: any) {
                if (err.status === 404) {
                    // Create new document
                    doc = {
                        _id: cardId,
                        type: 'card_state',
                        cardId,
                        deckId,
                        filePath,
                        due: fsrsData.due.toISOString(),
                        stability: fsrsData.stability,
                        difficulty: fsrsData.difficulty,
                        elapsed_days: fsrsData.elapsed_days,
                        scheduled_days: fsrsData.scheduled_days,
                        reps: fsrsData.reps,
                        lapses: fsrsData.lapses,
                        state: fsrsData.state,
                        last_review: fsrsData.last_review?.toISOString(),
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                } else {
                    throw err;
                }
            }

            await this.db.put(doc);
        } catch (error) {
            console.error('Error saving card state:', error);
            throw error;
        }
    }

    async getCardState(cardId: string): Promise<FSRSCard | null> {
        try {
            const doc = await this.db.get<CardStateDoc>(cardId);
            
            if (doc.type !== 'card_state') return null;

            return {
                due: new Date(doc.due),
                stability: doc.stability,
                difficulty: doc.difficulty,
                elapsed_days: doc.elapsed_days,
                scheduled_days: doc.scheduled_days,
                reps: doc.reps,
                lapses: doc.lapses,
                state: doc.state,
                last_review: doc.last_review ? new Date(doc.last_review) : undefined
            };
        } catch (err: any) {
            if (err.status === 404) {
                return null;
            }
            throw err;
        }
    }

    async getAllCardStates(): Promise<Record<string, FSRSCard>> {
        try {
            const result = await this.db.allDocs<CardStateDoc>({
                include_docs: true,
                startkey: 'fsrs-',
                endkey: 'fsrs-\ufff0'
            });

            const cardStates: Record<string, FSRSCard> = {};

            for (const row of result.rows as Array<PouchDB.Core.AllDocsResponse<CardStateDoc>['rows'][0]>) {
                if (row.doc && row.doc.type === 'card_state') {
                    cardStates[row.doc.cardId] = {
                        due: new Date(row.doc.due),
                        stability: row.doc.stability,
                        difficulty: row.doc.difficulty,
                        elapsed_days: row.doc.elapsed_days,
                        scheduled_days: row.doc.scheduled_days,
                        reps: row.doc.reps,
                        lapses: row.doc.lapses,
                        state: row.doc.state,
                        last_review: row.doc.last_review ? new Date(row.doc.last_review) : undefined
                    };
                }
            }

            return cardStates;
        } catch (error) {
            console.error('Error getting all card states:', error);
            return {};
        }
    }

    async deleteCardState(cardId: string): Promise<void> {
        try {
            const doc = await this.db.get(cardId);
            await this.db.remove(doc);
        } catch (err: any) {
            if (err.status !== 404) {
                throw err;
            }
        }
    }

    // --- Review Log Operations ---

    async addReviewLog(cardId: string, timestamp: number, rating: Rating): Promise<void> {
        try {
            const doc: ReviewLogDoc = {
                _id: `review_${timestamp}_${cardId}`,
                type: 'review_log',
                cardId,
                timestamp,
                rating,
                created_at: new Date().toISOString()
            };

            await this.db.put(doc);
        } catch (error) {
            console.error('Error adding review log:', error);
            throw error;
        }
    }

    async getReviewHistory(limit?: number): Promise<Array<{ cardId: string; timestamp: number; rating: Rating }>> {
        try {
            const result = await this.db.allDocs<ReviewLogDoc>({
                include_docs: true,
                startkey: 'review_',
                endkey: 'review_\ufff0',
                limit,
                descending: true
            });

            return result.rows
                .filter((row: any) => row.doc && row.doc.type === 'review_log')
                .map((row: any) => ({
                    cardId: row.doc!.cardId,
                    timestamp: row.doc!.timestamp,
                    rating: row.doc!.rating
                }));
        } catch (error) {
            console.error('Error getting review history:', error);
            return [];
        }
    }

    async getReviewHistoryForCard(cardId: string): Promise<Array<{ timestamp: number; rating: Rating }>> {
        try {
            const result = await this.db.allDocs<ReviewLogDoc>({
                include_docs: true,
                startkey: 'review_',
                endkey: 'review_\ufff0'
            });

            return result.rows
                .filter((row: any) => row.doc && row.doc.type === 'review_log' && row.doc.cardId === cardId)
                .map((row: any) => ({
                    timestamp: row.doc!.timestamp,
                    rating: row.doc!.rating
                }))
                .sort((a: any, b: any) => b.timestamp - a.timestamp);
        } catch (error) {
            console.error('Error getting review history for card:', error);
            return [];
        }
    }

    // --- Settings Operations ---

    async saveSettings(settings: Omit<SettingsDoc, '_id' | '_rev' | 'type' | 'updated_at'>): Promise<void> {
        try {
            let doc: SettingsDoc;
            
            try {
                const existing = await this.db.get<SettingsDoc>('settings');
                doc = {
                    ...existing,
                    ...settings,
                    updated_at: new Date().toISOString()
                };
            } catch (err: any) {
                if (err.status === 404) {
                    doc = {
                        _id: 'settings',
                        type: 'settings',
                        ...settings,
                        updated_at: new Date().toISOString()
                    };
                } else {
                    throw err;
                }
            }

            await this.db.put(doc);
        } catch (error) {
            console.error('Error saving settings:', error);
            throw error;
        }
    }

    async getSettings(): Promise<Omit<SettingsDoc, '_id' | '_rev' | 'type' | 'updated_at'> | null> {
        try {
            const doc = await this.db.get<SettingsDoc>('settings');
            
            if (doc.type !== 'settings') return null;

            return {
                deckTag: doc.deckTag,
                newCardsPerDay: doc.newCardsPerDay,
                reviewsPerDay: doc.reviewsPerDay,
                fontSize: doc.fontSize,
                fsrsParams: doc.fsrsParams
            };
        } catch (err: any) {
            if (err.status === 404) {
                return null;
            }
            throw err;
        }
    }

    // --- Sync Operations ---

    async setupSync(remoteUrl: string): Promise<void> {
        try {
            this.remoteUrl = remoteUrl;
            
            // Save sync configuration
            let syncMeta: SyncMetaDoc;
            
            try {
                const existing = await this.db.get<SyncMetaDoc>('sync_meta');
                syncMeta = {
                    ...existing,
                    remoteUrl,
                    syncEnabled: true,
                    lastSyncTime: new Date().toISOString()
                };
            } catch (err: any) {
                if (err.status === 404) {
                    syncMeta = {
                        _id: 'sync_meta',
                        type: 'sync_meta',
                        remoteUrl,
                        syncEnabled: true,
                        lastSyncTime: new Date().toISOString()
                    };
                } else {
                    throw err;
                }
            }

            await this.db.put(syncMeta);

            // Start continuous sync
            if (this.syncHandler) {
                this.syncHandler.cancel();
            }

            const remoteDb = new PouchDB(remoteUrl);
            this.syncHandler = this.db.sync(remoteDb, {
                live: true,
                retry: true
            })
            .on('change', (info: any) => {
                console.log('Sync change:', info);
                this.retryCount = 0; // Reset retry count on successful change
                if (this.syncEventHandlers.onChange) {
                    this.syncEventHandlers.onChange(info);
                }
            })
            .on('paused', (err: any) => {
                console.log('Sync paused:', err);
                
                // Check for fatal errors (404 Not Found, 401 Unauthorized, 403 Forbidden)
                if (err && (err.status === 404 || err.status === 401 || err.status === 403)) {
                    console.error('Sync fatal error, stopping:', err);
                    this.syncHandler?.cancel();
                    this.syncHandler = null;
                    // Notify error handler
                    if (this.syncEventHandlers.onError) {
                        this.syncEventHandlers.onError(err);
                    }
                    return;
                }

                // Handle retry limit
                // If err is present, it means we are pausing due to an error (and likely retrying)
                // Even if err is undefined, if we are in a retry loop, we might want to count it, 
                // but usually undefined means "idle". However, in your case, it seems to be part of the loop.
                // We will count it if we see rapid pauses without active state in between, but simpler is to just count non-idle pauses.
                // Since the logs show "Sync paused: undefined" during the loop, we should be careful.
                // But let's assume any pause that isn't "idle" is a retry wait.
                // PouchDB emits paused with err when it's an error.
                
                // If we are seeing 404s in console but err is undefined here, it's tricky.
                // Let's increment retry count.
                this.retryCount++;
                if (this.retryCount > this.maxRetries) {
                     console.error(`Max retries (${this.maxRetries}) reached. Stopping sync.`);
                     this.syncHandler?.cancel();
                     this.syncHandler = null;
                     if (this.syncEventHandlers.onError) {
                         this.syncEventHandlers.onError(new Error(`Max retries (${this.maxRetries}) reached. Check your connection and URL.`));
                     }
                     return;
                }

                if (this.syncEventHandlers.onPaused) {
                    this.syncEventHandlers.onPaused(err);
                }
            })
            .on('active', () => {
                console.log('Sync resumed');
                // We don't reset retryCount here immediately because 'active' happens during retry attempts too.
                // Only reset on 'change' (successful data transfer) or maybe after a long period of being active?
                // Actually, if it becomes active, it means it connected.
                // But in the loop it goes active -> paused -> active -> paused.
                // So we should NOT reset retryCount on active if we want to catch the loop.
                
                if (this.syncEventHandlers.onActive) {
                    this.syncEventHandlers.onActive();
                }
            })
            .on('error', (err: any) => {
                console.error('Sync error:', err);
                if (this.syncEventHandlers.onError) {
                    this.syncEventHandlers.onError(err);
                }
            })
            .on('complete', (info: any) => {
                console.log('Sync complete:', info);
                if (this.syncEventHandlers.onComplete) {
                    this.syncEventHandlers.onComplete(info);
                }
            });

        } catch (error) {
            console.error('Error setting up sync:', error);
            throw error;
        }
    }
    
    async manualSync(): Promise<void> {
        if (!this.remoteUrl) {
            throw new Error('No remote URL configured');
        }
        
        if (this.syncing) {
            throw new Error('Sync already in progress');
        }
        
        try {
            this.syncing = true;
            const remoteDb = new PouchDB(this.remoteUrl);
            
            return new Promise((resolve, reject) => {
                this.db.sync(remoteDb)
                    .on('change', (info: any) => {
                        console.log('Manual sync change:', info);
                        if (this.syncEventHandlers.onChange) {
                            this.syncEventHandlers.onChange(info);
                        }
                    })
                    .on('complete', async (info: any) => {
                        console.log('Manual sync complete:', info);
                        this.syncing = false;
                        
                        // Update last sync time
                        try {
                            const syncMeta = await this.db.get<SyncMetaDoc>('sync_meta');
                            syncMeta.lastSyncTime = new Date().toISOString();
                            await this.db.put(syncMeta);
                        } catch (err: any) {
                            console.error('Failed to update sync time:', err);
                        }
                        
                        if (this.syncEventHandlers.onComplete) {
                            this.syncEventHandlers.onComplete(info);
                        }
                        resolve();
                    })
                    .on('error', (err: any) => {
                        console.error('Manual sync error:', err);
                        this.syncing = false;
                        if (this.syncEventHandlers.onError) {
                            this.syncEventHandlers.onError(err);
                        }
                        reject(err);
                    });
            });
        } catch (error) {
            this.syncing = false;
            throw error;
        }
    }

    async stopSync(): Promise<void> {
        if (this.syncHandler) {
            this.syncHandler.cancel();
            this.syncHandler = null;
        }

        try {
            const syncMeta = await this.db.get<SyncMetaDoc>('sync_meta');
            syncMeta.syncEnabled = false;
            await this.db.put(syncMeta);
        } catch (err: any) {
            if (err.status !== 404) {
                throw err;
            }
        }
    }

    async getSyncStatus(): Promise<{ enabled: boolean; remoteUrl?: string; lastSyncTime?: string }> {
        try {
            const syncMeta = await this.db.get<SyncMetaDoc>('sync_meta');
            return {
                enabled: syncMeta.syncEnabled,
                remoteUrl: syncMeta.remoteUrl,
                lastSyncTime: syncMeta.lastSyncTime
            };
        } catch (err: any) {
            if (err.status === 404) {
                return { enabled: false };
            }
            throw err;
        }
    }

    // --- Utility Operations ---

    async compact(): Promise<void> {
        await this.db.compact();
    }

    async destroy(): Promise<void> {
        if (this.syncHandler) {
            this.syncHandler.cancel();
        }
        await this.db.destroy();
    }

    async getDatabaseInfo(): Promise<any> {
        return await this.db.info();
    }
}
