import { randomUUID } from 'crypto';
import type { RetrievalTrace, TraceStage, ScoreBreakdown } from './types';

/**
 * Inspector - Observability system for RAG queries
 */
export class Inspector {
  private traces: Map<string, RetrievalTrace> = new Map();

  /**
   * Start a new trace
   */
  startTrace(query: string): RetrievalTrace {
    const trace: RetrievalTrace = {
      id: randomUUID(),
      query,
      timestamp: new Date(),
      duration: 0,
      stages: [],
      chunksRetrieved: 0,
      chunksReturned: 0,
      sources: [],
      scores: [],
    };

    this.traces.set(trace.id, trace);
    return trace;
  }

  /**
   * Record a pipeline stage
   */
  recordStage(traceId: string, stage: TraceStage): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.stages.push(stage);
    }
  }

  /**
   * End a trace
   */
  endTrace(traceId: string): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.duration = Date.now() - trace.timestamp.getTime();
    }
  }

  /**
   * Get a trace by ID
   */
  getTrace(id: string): RetrievalTrace | undefined {
    return this.traces.get(id);
  }

  /**
   * List recent traces
   */
  listTraces(limit = 50): RetrievalTrace[] {
    return Array.from(this.traces.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Explain why a chunk was selected
   */
  explainChunk(traceId: string, chunkId: string): string {
    const trace = this.traces.get(traceId);
    if (!trace) return 'Trace not found';

    const score = trace.scores.find(s => s.chunkId === chunkId);
    if (!score) return 'Chunk not found';

    return score.explanation;
  }
}

