import type { Rating } from 'ts-fsrs';

// State constants (mirrors ts-fsrs State enum)
const STATE_LEARNING = 1;
const STATE_REVIEW = 2;
const STATE_RELEARNING = 3;

export interface ReviewEvent {
    cardId: string;
    timestamp: number;
    rating: Rating;
}

export interface OptimizerResult {
    weights: number[];
    loss: number;
    epoch: number;
}

interface CardSequence {
    cardId: string;
    deltas: number[];
    ratings: number[];
}

interface FsrsState {
    stability: number;
    difficulty: number;
    state: number;
}

const DECAY = -0.5;
const FACTOR = 0.9 ** (1 / DECAY) - 1;

function forgettingCurve(elapsed: number, stability: number): number {
    return (1 + FACTOR * elapsed / Math.max(stability, 0.01)) ** DECAY;
}

function initStability(g: number, w: number[]): number {
    return Math.max(w[g], 0.01);
}

function initDifficulty(g: number, w: number[]): number {
    const d = w[4] - Math.exp(w[5] * (g - 1)) + 1;
    return Math.min(Math.max(d, 1), 10);
}

function nextDifficulty(d: number, g: number, w: number[]): number {
    const deltaD = -w[6] * (g - 3);
    const linearDamping = deltaD * (10 - d) / 9;
    const newD = d + linearDamping;
    const initD4 = initDifficulty(4, w);
    const meanReversion = w[7] * initD4 + (1 - w[7]) * newD;
    return Math.min(Math.max(meanReversion, 1), 10);
}

function nextRecallStability(d: number, s: number, r: number, g: number, w: number[]): number {
    const hardPenalty = g === 2 ? w[15] : 1;
    const easyBonus = g === 4 ? w[16] : 1;
    return s * (
        1 +
        Math.exp(w[8]) *
        (11 - d) *
        s ** -w[9] *
        (Math.exp((1 - r) * w[10]) - 1) *
        hardPenalty *
        easyBonus
    );
}

function nextForgetStability(d: number, s: number, r: number, w: number[]): number {
    return Math.max(w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp((1 - r) * w[14]), 0.01);
}

function nextShortTermStability(s: number, g: number, w: number[]): number {
    // g is rating index: 0=Again, 1=Hard, 2=Good, 3=Easy
    const sinc = Math.exp(w[17] * (g - 3 + w[18]));
    const clampedSinc = g >= 3 ? Math.max(sinc, 1) : sinc;
    return s * clampedSinc;
}

function nextState(state: FsrsState | null, g: number, deltaDays: number, w: number[]): FsrsState {
    if (!state) {
        return {
            stability: initStability(g, w),
            difficulty: initDifficulty(g, w),
            state: STATE_LEARNING,
        };
    }

    const r = forgettingCurve(deltaDays, state.stability);

    if (g === 0) { // Again
        return {
            stability: nextForgetStability(state.difficulty, state.stability, r, w),
            difficulty: nextDifficulty(state.difficulty, g, w),
            state: STATE_RELEARNING,
        };
    }

    if (deltaDays < 1 && state.state !== 0) { // 0 = New
        const shortS = nextShortTermStability(state.stability, g, w);
        return { stability: shortS, difficulty: state.difficulty, state: state.state };
    }

    return {
        stability: nextRecallStability(state.difficulty, state.stability, r, g, w),
        difficulty: nextDifficulty(state.difficulty, g, w),
        state: STATE_REVIEW,
    };
}

function ratingToRecall(rating: number): number {
    return rating === 0 || rating === 1 ? 0 : 1; // 0=Again, 1=Hard → forget; 2=Good, 3=Easy → recall
}

export function buildSequences(events: ReviewEvent[]): CardSequence[] {
    const byCard = new Map<string, { timestamp: number; rating: Rating }[]>();

    for (const ev of events) {
        if (!byCard.has(ev.cardId)) {
            byCard.set(ev.cardId, []);
        }
        byCard.get(ev.cardId)!.push({ timestamp: ev.timestamp, rating: ev.rating });
    }

    const sequences: CardSequence[] = [];

    for (const [cardId, reviews] of byCard) {
        reviews.sort((a, b) => a.timestamp - b.timestamp);
        if (reviews.length < 2) continue;

        const deltas: number[] = [];
        const ratings: number[] = [];

        for (let i = 0; i < reviews.length; i++) {
            if (i === 0) {
                deltas.push(0);
            } else {
                const dt = (reviews[i].timestamp - reviews[i - 1].timestamp) / (1000 * 60 * 60 * 24);
                deltas.push(Math.max(dt, 0));
            }
            ratings.push(reviews[i].rating);
        }

        sequences.push({ cardId, deltas, ratings });
    }

    return sequences;
}

export function computeLossForWeights(
    w: number[],
    sequences: CardSequence[],
    _requestRetention: number,
    _maxInterval: number,
    gamma: number,
): number {
    let totalLoss = 0;
    let count = 0;

    for (const seq of sequences) {
        let state: FsrsState | null = null;

        for (let i = 0; i < seq.ratings.length; i++) {
            const rating = seq.ratings[i];
            const deltaDays = seq.deltas[i];

            if (state) {
                const r = forgettingCurve(deltaDays, state.stability);
                const actualR = ratingToRecall(rating);
                const epsilon = 1e-8;
                const loss = -(actualR * Math.log(Math.max(r, epsilon))
                    + (1 - actualR) * Math.log(Math.max(1 - r, epsilon)));
                totalLoss += loss;
                count++;
            }

            const ratingIndex = rating === 0 ? 0 : rating === 1 ? 1 : rating === 2 ? 2 : 3;
            state = nextState(state, ratingIndex, deltaDays, w);
        }
    }

    if (count === 0) return Infinity;

    const defaults = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
        1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];

    const penalty = gamma * w.reduce((sum, wi, i) => {
        const stddev = defaults[i] * 0.5 || 1;
        return sum + ((wi - defaults[i]) ** 2) / (stddev ** 2);
    }, 0);

    return totalLoss / count + penalty / count;
}

function mutateWeights(w: number[], rate: number): number[] {
    return w.map(wi => {
        const noise = (Math.random() - 0.5) * 2 * rate * Math.abs(wi || 1);
        return Math.max(Math.min(wi + noise, 100), 0.01);
    });
}

export function optimize(
    sequences: CardSequence[],
    initialWeights: readonly number[],
    _requestRetention: number,
    _maxInterval: number,
    options: {
        populationSize?: number;
        generations?: number;
        mutationRate?: number;
        gamma?: number;
        onProgress?: (result: OptimizerResult) => void;
    } = {},
): OptimizerResult {
    const popSize = options.populationSize || 30;
    const generations = options.generations || 50;
    const baseMutationRate = options.mutationRate || 1.0;
    const gamma = options.gamma || 0.01;
    const onProgress = options.onProgress;

    const w = [...initialWeights];
    let bestWeights = [...w];
    let bestLoss = computeLossForWeights(w, sequences, _requestRetention, _maxInterval, gamma);

    for (let g = 0; g < generations; g++) {
        const mutationRate = baseMutationRate * (1 - g / generations);
        let genBestLoss = bestLoss;
        let genBestWeights = [...bestWeights];

        for (let i = 1; i < popSize; i++) {
            const candidate = mutateWeights(bestWeights, mutationRate);
            const loss = computeLossForWeights(candidate, sequences, _requestRetention, _maxInterval, gamma);
            if (loss < genBestLoss) {
                genBestLoss = loss;
                genBestWeights = [...candidate];
            }
        }

        if (genBestLoss < bestLoss) {
            bestLoss = genBestLoss;
            bestWeights = [...genBestWeights];
        }

        if (onProgress) {
            onProgress({ weights: bestWeights, loss: bestLoss, epoch: g + 1 });
        }
    }

    return { weights: bestWeights, loss: bestLoss, epoch: generations };
}
