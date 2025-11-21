#!/usr/bin/env node

import { Command } from 'commander';
import { Inspector } from '../observability/Inspector';

const program = new Command();

program
  .name('crag inspect')
  .description('Inspect RAG query traces and debugging information');

// List traces
program
  .command('list')
  .description('List recent queries')
  .option('-n, --limit <number>', 'Number of traces', '50')
  .action(async (options) => {
    const inspector = new Inspector();
    const traces = inspector.listTraces(parseInt(options.limit));

    console.log('\nID\t\tQuery\t\t\tChunks\tDuration\tTimestamp');
    traces.forEach(t => {
      console.log(
        `${t.id.substr(0, 8)}\t${t.query.substr(0, 20)}\t${t.chunksReturned}\t${t.duration}ms\t${t.timestamp.toISOString()}`
      );
    });
  });

// Show trace
program
  .command('show <id>')
  .description('Show trace details')
  .action(async (id) => {
    const inspector = new Inspector();
    const trace = inspector.getTrace(id);

    if (!trace) {
      console.error('Trace not found');
      return;
    }

    console.log(`\nQuery: "${trace.query}"`);
    console.log(`Duration: ${trace.duration}ms`);
    console.log(`Chunks: ${trace.chunksReturned}`);
    console.log(`\nPipeline:`);

    trace.stages.forEach((stage, i) => {
      console.log(`  ${i + 1}. ${stage.name} (${stage.duration}ms)`);
      console.log(`     Input: ${JSON.stringify(stage.input)}`);
      console.log(`     Output: ${JSON.stringify(stage.output)}`);
    });

    console.log(`\nTop Sources:`);
    trace.sources.forEach((source, i) => {
      console.log(`  ${i + 1}. ${source}`);
    });
  });

// Explain chunk
program
  .command('explain <traceId> <chunkId>')
  .description('Explain why chunk was selected')
  .action(async (traceId, chunkId) => {
    const inspector = new Inspector();
    const explanation = inspector.explainChunk(traceId, chunkId);
    console.log(explanation);
  });

// Stats
program
  .command('stats')
  .description('Show statistics')
  .option('--last <duration>', 'Time range (e.g., "24h", "7d")', '24h')
  .action(async (options) => {
    const inspector = new Inspector();
    const traces = inspector.listTraces(100);

    const totalQueries = traces.length;
    const avgDuration =
      traces.reduce((sum, t) => sum + t.duration, 0) / totalQueries || 0;
    const avgChunks =
      traces.reduce((sum, t) => sum + t.chunksReturned, 0) / totalQueries || 0;

    console.log(`\nStatistics (last ${options.last}):`);
    console.log(`  Queries: ${totalQueries}`);
    console.log(`  Avg Duration: ${avgDuration.toFixed(2)}ms`);
    console.log(`  Avg Chunks: ${avgChunks.toFixed(2)}`);
  });

program.parse();

