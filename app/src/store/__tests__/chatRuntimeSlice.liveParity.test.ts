/**
 * Reducer-level guards for the live half of live/history parity: the rows and
 * transcript pointers the socket stream builds must have the shape — and keep
 * the slots — that a reopened thread shows, and settling a turn must be one
 * transition. The end-to-end version is `providers/__tests__/liveHistoryParity`.
 */
import type { UnknownAction } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import reducer, {
  beginInferenceTurn,
  liveTurnStarted,
  markInferenceTurnStreaming,
  recordSubagentTranscriptTool,
  registerParallelRequest,
  resolveSubagentTranscriptTool,
  setInferenceStatusForThread,
  setToolTimelineForThread,
  streamDeltaReceived,
  subagentIterationStarted,
  subagentSpawned,
  toolArgsDeltaReceived,
  toolCallReceived,
  toolResultReceived,
  turnSettled,
} from '../chatRuntimeSlice';

type ChatRuntimeState = ReturnType<typeof reducer>;

const T = 'thread-1';

function run(actions: UnknownAction[], from?: ChatRuntimeState): ChatRuntimeState {
  return actions.reduce<ChatRuntimeState>(
    (state, action) => reducer(state, action),
    from ?? reducer(undefined, { type: '@@init' })
  );
}

function pointers(state: ChatRuntimeState): string[] {
  return (state.processingByThread[T] ?? []).flatMap(item =>
    item.kind === 'toolCall' ? [item.callId] : []
  );
}

describe('toolCallReceived adopts the row a tool_args_delta minted', () => {
  it('takes over the args-delta row under the real id instead of pushing a duplicate', () => {
    const state = run([
      toolArgsDeltaReceived({ threadId: T, round: 1, delta: '{"q":1}', toolName: 'search' }),
      toolCallReceived({ threadId: T, round: 1, toolName: 'search', toolCallId: 'call-1' }),
    ]);
    const rows = state.toolTimelineByThread[T] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'call-1', argsBuffer: '{"q":1}', seq: 0 });
    expect(pointers(state)).toEqual(['call-1']);
  });

  it('adopts it for an id-less call too', () => {
    const state = run([
      toolArgsDeltaReceived({ threadId: T, round: 1, delta: '{}', toolName: 'search' }),
      toolCallReceived({ threadId: T, round: 1, toolName: 'search' }),
    ]);
    expect(state.toolTimelineByThread[T]).toHaveLength(1);
    expect(pointers(state)).toHaveLength(1);
  });

  it('does not adopt a row an earlier call already owns', () => {
    const state = run([
      toolCallReceived({ threadId: T, round: 1, toolName: 'search', toolCallId: 'call-1' }),
      toolCallReceived({ threadId: T, round: 1, toolName: 'search', toolCallId: 'call-2' }),
    ]);
    expect((state.toolTimelineByThread[T] ?? []).map(row => row.id)).toEqual(['call-1', 'call-2']);
  });

  it('keeps the args the tool_call event carries, as a reload shows them', () => {
    const state = run([
      toolCallReceived({
        threadId: T,
        round: 1,
        toolName: 'search',
        toolCallId: 'call-1',
        args: { q: 'agenda' },
      }),
    ]);
    expect(state.toolTimelineByThread[T]?.[0]?.argsBuffer).toBe('{"q":"agenda"}');
  });

  it('never overwrites args that streamed', () => {
    const state = run([
      toolArgsDeltaReceived({
        threadId: T,
        round: 1,
        delta: '{"q":"streamed"}',
        toolName: 'search',
        toolCallId: 'call-1',
      }),
      toolCallReceived({
        threadId: T,
        round: 1,
        toolName: 'search',
        toolCallId: 'call-1',
        args: { q: 'event' },
      }),
    ]);
    expect(state.toolTimelineByThread[T]?.[0]?.argsBuffer).toBe('{"q":"streamed"}');
  });
});

describe('subagentSpawned promotes the spawn row in place', () => {
  const spawned = () =>
    run([
      toolCallReceived({ threadId: T, round: 1, toolName: 'shell', toolCallId: 'call-a' }),
      toolCallReceived({
        threadId: T,
        round: 1,
        toolName: 'spawn_subagent',
        toolCallId: 'call-spawn',
      }),
      toolCallReceived({ threadId: T, round: 1, toolName: 'shell', toolCallId: 'call-b' }),
      subagentSpawned({
        threadId: T,
        round: 1,
        rowId: `${T}:subagent:sub-1:researcher`,
        taskId: 'sub-1',
        agentId: 'researcher',
      }),
    ]);

  it('takes the spawn row’s slot and seq rather than moving to the end', () => {
    const rows = spawned().toolTimelineByThread[T] ?? [];
    expect(rows.map(row => row.id)).toEqual(['call-a', `${T}:subagent:sub-1:researcher`, 'call-b']);
    expect(rows.map(row => row.seq)).toEqual([0, 1, 2]);
  });

  it('re-points the transcript at the delegation row, so it is not dangling', () => {
    expect(pointers(spawned())).toEqual(['call-a', `${T}:subagent:sub-1:researcher`, 'call-b']);
  });
});

describe('turnSettled', () => {
  const live = () =>
    run([
      beginInferenceTurn({ threadId: T }),
      markInferenceTurnStreaming({ threadId: T }),
      liveTurnStarted({ threadId: T, requestId: 'req-1' }),
      setInferenceStatusForThread({
        threadId: T,
        status: { phase: 'tool_use', iteration: 1, maxIterations: 5 },
      }),
      toolCallReceived({ threadId: T, round: 1, toolName: 'shell', toolCallId: 'call-a' }),
      streamDeltaReceived({
        threadId: T,
        requestId: 'req-1',
        round: 2,
        delta: 'Done.',
        channel: 'content',
      }),
    ]);

  it('freezes the live trail under the request id, without inventing an outcome', () => {
    const settled = reducer(live(), turnSettled({ threadId: T, requestId: 'req-1' }));
    const frozen = settled.settledTurnsByThread[T]?.['req-1'];
    // A row with no result at `chat_done` stays running; the core projection's
    // terminal status is overlaid at render (`buildRuntimeMessages`).
    expect(frozen?.timeline.map(row => [row.id, row.status])).toEqual([['call-a', 'running']]);
    expect(frozen?.transcript.map(item => item.kind)).toEqual(['toolCall', 'narration']);
  });

  it('ends the tail and everything it drew in the same transition', () => {
    const settled = reducer(live(), turnSettled({ threadId: T, requestId: 'req-1' }));
    expect(settled.inferenceTurnLifecycleByThread[T]).toBeUndefined();
    expect(settled.streamingAssistantByThread[T]).toBeUndefined();
    expect(settled.inferenceStatusByThread[T]).toBeUndefined();
    expect(settled.liveRequestIdByThread[T]).toBeUndefined();
  });

  it('falls back to the live-turn id when the event carries none', () => {
    const settled = reducer(live(), turnSettled({ threadId: T }));
    expect(settled.settledTurnsByThread[T]?.['req-1']).toBeDefined();
  });

  it('keeps a bounded number of frozen turns per thread', () => {
    let state = live();
    for (let n = 0; n < 30; n += 1) {
      state = run(
        [
          toolCallReceived({ threadId: T, round: 1, toolName: 'shell', toolCallId: `c-${n}` }),
          turnSettled({ threadId: T, requestId: `req-${n}` }),
        ],
        state
      );
    }
    const kept = Object.keys(state.settledTurnsByThread[T] ?? {});
    expect(kept).toHaveLength(20);
    expect(kept.at(-1)).toBe('req-29');
  });

  it("does not freeze another turn's rows as the trail of a reply with no inference_start", () => {
    // A background delivery settles with a bare `chat_done`: the live rows are
    // still the turn before it, which settled already.
    const settled = run(
      [
        turnSettled({ threadId: T, requestId: 'req-1' }),
        turnSettled({ threadId: T, requestId: 'bgdeliver-1' }),
      ],
      live()
    );
    expect(settled.settledTurnsByThread[T]?.['bgdeliver-1']).toBeUndefined();
    expect(settled.settledTurnsByThread[T]?.['req-1']?.timeline.map(row => row.id)).toEqual([
      'call-a',
    ]);
    // The rows stay where they are (the background-process panel reads them).
    expect(settled.toolTimelineByThread[T]?.map(row => row.id)).toEqual(['call-a']);
    expect(settled.toolTimelineRequestByThread[T]).toBe('req-1');
  });

  it('a turn whose inference_start was missed still freezes its own rows', () => {
    // req-1 settled and left its claim; req-2's `inference_start` never
    // arrived (a reconnect mid-turn), but its own rows did. The rows it
    // mints drop the stale claim, so req-2 freezes as it always did.
    const settled = run(
      [
        turnSettled({ threadId: T, requestId: 'req-1' }),
        toolCallReceived({ threadId: T, round: 1, toolName: 'shell', toolCallId: 'call-b' }),
        turnSettled({ threadId: T, requestId: 'req-2' }),
      ],
      live()
    );
    expect(settled.settledTurnsByThread[T]?.['req-2']?.timeline.map(row => row.id)).toEqual([
      'call-a',
      'call-b',
    ]);
  });

  it("a late row of the settled turn keeps that turn's claim", () => {
    // A bridge that had not drained when `chat_done` was delivered, or a
    // detached child spawning a nested one, reports on the settled turn's
    // request after it settled. That row names req-1, so the claim stands and
    // the bare delivery that follows still does not adopt req-1's rows.
    const late = [
      toolCallReceived({
        threadId: T,
        requestId: 'req-1',
        round: 2,
        toolName: 'shell',
        toolCallId: 'call-late',
      }),
      subagentSpawned({
        threadId: T,
        requestId: 'req-1',
        round: 2,
        rowId: `${T}:subagent:sub-9:researcher`,
        taskId: 'sub-9',
        agentId: 'researcher',
      }),
    ];
    for (const action of late) {
      const settled = run(
        [
          turnSettled({ threadId: T, requestId: 'req-1' }),
          action,
          turnSettled({ threadId: T, requestId: 'bgdeliver-1' }),
        ],
        live()
      );
      expect(settled.toolTimelineRequestByThread[T]).toBe('req-1');
      expect(settled.settledTurnsByThread[T]?.['bgdeliver-1']).toBeUndefined();
      // The live timeline is still req-1's own rows, so its late row joins
      // them: the background-process panel reads the live timeline.
      expect(settled.toolTimelineByThread[T]).toHaveLength(2);
    }
  });

  it('a late row of a settled turn stays out of the live turn, and joins its own trail', () => {
    // req-2 is live when req-1's detached child spawns again (and a late tool
    // call of req-1 lands). Neither may join req-2's timeline: claiming would
    // make req-2's own rows look foreign, joining would hand req-1's row to
    // req-2's trail. They go to req-1's frozen trail, results included.
    const late = (requestId: string) => [
      toolCallReceived({
        threadId: T,
        requestId,
        round: 2,
        toolName: 'shell',
        toolCallId: 'call-late',
      }),
      subagentSpawned({
        threadId: T,
        requestId,
        round: 2,
        rowId: `${T}:subagent:sub-9:researcher`,
        taskId: 'sub-9',
        agentId: 'researcher',
      }),
      toolResultReceived({
        threadId: T,
        requestId,
        round: 2,
        toolName: 'shell',
        toolCallId: 'call-late',
        success: true,
      }),
    ];
    const settled = run(
      [
        turnSettled({ threadId: T, requestId: 'req-1' }),
        setToolTimelineForThread({ threadId: T, entries: [] }),
        liveTurnStarted({ threadId: T, requestId: 'req-2' }),
        toolCallReceived({
          threadId: T,
          requestId: 'req-2',
          round: 1,
          toolName: 'shell',
          toolCallId: 'call-b',
        }),
        ...late('req-1'),
        turnSettled({ threadId: T, requestId: 'req-2' }),
      ],
      live()
    );
    expect(settled.settledTurnsByThread[T]?.['req-2']?.timeline.map(row => row.id)).toEqual([
      'call-b',
    ]);
    expect(
      settled.settledTurnsByThread[T]?.['req-1']?.timeline.map(row => [row.id, row.status])
    ).toEqual([
      ['call-a', 'running'],
      ['call-late', 'success'],
      [`${T}:subagent:sub-9:researcher`, 'running'],
    ]);
  });

  it("with no turn live, a late row of an earlier turn joins its own trail, not the last turn's rows", () => {
    // req-1 and req-2 both settled; the live timeline still holds req-2's
    // rows. A late req-1 row appended there (and claiming) would hand req-2's
    // whole timeline to req-1.
    const settled = run(
      [
        turnSettled({ threadId: T, requestId: 'req-1' }),
        setToolTimelineForThread({ threadId: T, entries: [] }),
        liveTurnStarted({ threadId: T, requestId: 'req-2' }),
        toolCallReceived({
          threadId: T,
          requestId: 'req-2',
          round: 1,
          toolName: 'shell',
          toolCallId: 'call-b',
        }),
        turnSettled({ threadId: T, requestId: 'req-2' }),
        toolCallReceived({
          threadId: T,
          requestId: 'req-1',
          round: 2,
          toolName: 'shell',
          toolCallId: 'call-late',
        }),
      ],
      live()
    );
    expect(settled.toolTimelineByThread[T]?.map(row => row.id)).toEqual(['call-b']);
    expect(settled.toolTimelineRequestByThread[T]).toBe('req-2');
    expect(settled.settledTurnsByThread[T]?.['req-1']?.timeline.map(row => row.id)).toEqual([
      'call-a',
      'call-late',
    ]);
  });

  it("a detached child's progress reaches its card in a frozen trail", () => {
    const rowId = `${T}:subagent:sub-9:researcher`;
    const settled = run(
      [
        turnSettled({ threadId: T, requestId: 'req-1' }),
        setToolTimelineForThread({ threadId: T, entries: [] }),
        liveTurnStarted({ threadId: T, requestId: 'req-2' }),
        subagentSpawned({
          threadId: T,
          requestId: 'req-1',
          round: 2,
          rowId,
          taskId: 'sub-9',
          agentId: 'researcher',
        }),
        subagentIterationStarted({ threadId: T, rowId, childIteration: 3, childMaxIterations: 9 }),
        recordSubagentTranscriptTool({
          threadId: T,
          rowId,
          callId: 'child-1',
          toolName: 'web_search',
        }),
        resolveSubagentTranscriptTool({ threadId: T, rowId, callId: 'child-1', success: true }),
      ],
      live()
    );
    const card = settled.settledTurnsByThread[T]?.['req-1']?.timeline.find(row => row.id === rowId);
    expect([card?.subagent?.childIteration, card?.subagent?.childMaxIterations]).toEqual([3, 9]);
    expect(
      card?.subagent?.transcript?.map(item => (item.kind === 'tool' ? item.status : item.kind))
    ).toEqual(['success']);
  });

  it('a late row of a turn this session never froze is left to the core projection', () => {
    const settled = run(
      [
        turnSettled({ threadId: T, requestId: 'req-1' }),
        setToolTimelineForThread({ threadId: T, entries: [] }),
        liveTurnStarted({ threadId: T, requestId: 'req-2' }),
        toolCallReceived({
          threadId: T,
          requestId: 'req-0',
          round: 1,
          toolName: 'shell',
          toolCallId: 'call-old',
        }),
      ],
      live()
    );
    expect(settled.toolTimelineByThread[T]).toEqual([]);
    expect(settled.toolTimelineRequestByThread[T]).toBe('req-2');
  });

  it("a missed turn's row names its own request, which then freezes", () => {
    const settled = run(
      [
        turnSettled({ threadId: T, requestId: 'req-1' }),
        toolCallReceived({
          threadId: T,
          requestId: 'req-2',
          round: 1,
          toolName: 'shell',
          toolCallId: 'call-b',
        }),
        turnSettled({ threadId: T, requestId: 'req-2' }),
      ],
      live()
    );
    expect(settled.settledTurnsByThread[T]?.['req-2']?.timeline.map(row => row.id)).toEqual([
      'call-a',
      'call-b',
    ]);
  });

  it('a parallel request never claims the primary timeline', () => {
    const settled = run(
      [
        // No primary turn is live (req-1 settled): only the parallel guard
        // keeps the fork's row from claiming the timeline.
        turnSettled({ threadId: T, requestId: 'req-1' }),
        registerParallelRequest({ threadId: T, requestId: 'fork-1' }),
        toolCallReceived({
          threadId: T,
          requestId: 'fork-1',
          round: 1,
          toolName: 'shell',
          toolCallId: 'call-fork',
        }),
      ],
      live()
    );
    expect(settled.toolTimelineRequestByThread[T]).toBe('req-1');
  });

  it('still freezes rows whose owner is unknown, as before', () => {
    // No `inference_start` was seen (e.g. a reconnect mid-turn): no claim
    // either way, so the reply keeps the rows it is settling with.
    const settled = run([
      toolCallReceived({ threadId: T, round: 1, toolName: 'shell', toolCallId: 'call-a' }),
      turnSettled({ threadId: T, requestId: 'req-9' }),
    ]);
    expect(settled.toolTimelineRequestByThread[T]).toBeUndefined();
    expect(settled.settledTurnsByThread[T]?.['req-9']?.timeline.map(row => row.id)).toEqual([
      'call-a',
    ]);
  });
});

describe('turn boundaries', () => {
  it('a newer live turn is not torn down by the previous turn settling late', () => {
    const state = run([
      beginInferenceTurn({ threadId: T }),
      markInferenceTurnStreaming({ threadId: T }),
      liveTurnStarted({ threadId: T, requestId: 'req-2' }),
      toolCallReceived({ threadId: T, round: 1, toolName: 'shell', toolCallId: 'call-2' }),
      turnSettled({ threadId: T, requestId: 'req-1' }),
    ]);
    expect(state.inferenceTurnLifecycleByThread[T]).toBe('streaming');
    expect(state.liveRequestIdByThread[T]).toBe('req-2');
    expect(state.toolTimelineByThread[T]?.[0]?.status).toBe('running');
    expect(state.settledTurnsByThread[T]?.['req-1']).toBeUndefined();
  });

  it('a new send starts from an empty transcript, not the last turn’s', () => {
    const state = run([
      streamDeltaReceived({
        threadId: T,
        requestId: 'req-1',
        round: 1,
        delta: 'Last turn said this.',
        channel: 'content',
      }),
      turnSettled({ threadId: T, requestId: 'req-1' }),
      beginInferenceTurn({ threadId: T }),
    ]);
    expect(state.processingByThread[T]).toBeUndefined();
    // …while the settled turn keeps the trail it rendered with.
    expect(state.settledTurnsByThread[T]?.['req-1']?.transcript).toHaveLength(1);
  });
});

describe('liveTurnStarted', () => {
  it('ignores a parallel (forked) request, which never owns the tail', () => {
    const state = run([
      registerParallelRequest({ threadId: T, requestId: 'fork' }),
      liveTurnStarted({ threadId: T, requestId: 'fork' }),
    ]);
    expect(state.liveRequestIdByThread[T]).toBeUndefined();
  });
});
