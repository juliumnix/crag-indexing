import * as fs from 'fs';
import * as path from 'path';

/**
 * Feedback entry
 */
interface FeedbackEntry {
  sourceId: string;
  positive: boolean;
  timestamp: Date;
}

/**
 * Feedback Store
 * Manages user feedback for sources to improve credibility scores
 */
export class FeedbackStore {
  private feedback: Map<string, FeedbackEntry[]> = new Map();
  private storagePath?: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath;
    if (storagePath) {
      this.load();
    }
  }

  /**
   * Record feedback for a source
   */
  record(sourceId: string, positive: boolean): void {
    const entry: FeedbackEntry = {
      sourceId,
      positive,
      timestamp: new Date(),
    };

    if (!this.feedback.has(sourceId)) {
      this.feedback.set(sourceId, []);
    }

    this.feedback.get(sourceId)!.push(entry);

    if (this.storagePath) {
      this.save();
    }
  }

  /**
   * Get feedback score for a source (0-1)
   * Positive feedback increases score, negative decreases
   */
  getScore(sourceId: string): number {
    const entries = this.feedback.get(sourceId) || [];

    if (entries.length === 0) {
      return 1.0; // Neutral if no feedback
    }

    const positiveCount = entries.filter(e => e.positive).length;
    const negativeCount = entries.filter(e => !e.positive).length;

    // Calculate score: positive feedback adds 5%, negative subtracts 10%
    const baseScore = 1.0;
    const positiveBoost = positiveCount * 0.05;
    const negativePenalty = negativeCount * 0.10;

    const score = baseScore + positiveBoost - negativePenalty;

    // Clamp between 0 and 1
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get all feedback for a source
   */
  getFeedback(sourceId: string): FeedbackEntry[] {
    return this.feedback.get(sourceId) || [];
  }

  /**
   * Load feedback from disk
   */
  private load(): void {
    if (!this.storagePath) return;

    // storagePath is a directory, not a file path
    const filePath = path.join(this.storagePath, 'feedback.json');
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      for (const [sourceId, entries] of Object.entries(data)) {
        this.feedback.set(
          sourceId,
          (entries as any[]).map((e: any) => ({
            ...e,
            timestamp: new Date(e.timestamp),
          }))
        );
      }
    } catch (error) {
      // Ignore errors, start with empty feedback
    }
  }

  /**
   * Save feedback to disk
   */
  private save(): void {
    if (!this.storagePath) return;

    // storagePath is a directory, not a file path
    // Create directory if it doesn't exist
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    const filePath = path.join(this.storagePath, 'feedback.json');
    const data: Record<string, FeedbackEntry[]> = {};

    for (const [sourceId, entries] of this.feedback.entries()) {
      data[sourceId] = entries;
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

