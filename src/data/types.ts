import type { Card as FSRSCard, Rating } from 'ts-fsrs';

export interface FSRSParameters {
    request_retention: number;
    maximum_interval: number;
    w: readonly number[];
}

export interface FSRSSettings {
    deckTag: string;
    newCardsPerDay: number;
    reviewsPerDay: number;
    fontSize: number;
    fsrsParams: FSRSParameters;
    syncEnabled: boolean;
    syncUrl: string;
    syncDbName: string;
    syncUsername: string;
    syncPassword: string;
    usePouchDB: boolean;
}

export type CardType = 'basic' | 'cloze';

export interface CardData {
    id: string;
    deckId: string;
    filePath: string;
    type: CardType;
    originalText: string;
    front: string;
    back: string;
}

export type FSRSData = FSRSCard;

export interface Card extends CardData {
    fsrsData?: FSRSData;
}

export interface Deck {
    id: string;
    title: string;
    filePath: string;
    cardIds: Set<string>;
    stats: { new: number; due: number; learning: number };
}

export interface ReviewLog {
    cardId: string;
    timestamp: number;
    rating: Rating;
}

export interface PluginData {
    settings: FSRSSettings;
    cardData: Record<string, FSRSData>;
    reviewHistory: ReviewLog[];
}
