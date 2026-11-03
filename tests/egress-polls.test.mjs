import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/store.js';
import { Repo } from '../js/repository.js';
import { Bus } from '../js/actions/bus.js';
import { Actions } from '../js/actions/index.js';

const sug = (id, roundId, status = 'pending') => ({ id, roundId, status, itemKey: 'k' + id });

test('Bus.emit forwards an optional meta argument to listeners', () => {
  let seen;
  Bus.on('t:meta', (payload, meta) => { seen = [payload, meta]; });
  Bus.emit('t:meta', 1, { progressOnly: true });
  assert.deepEqual(seen, [1, { progressOnly: true }]);
  Bus.emit('t:meta', 2); // old call style still works
  assert.deepEqual(seen, [2, undefined]);
});

test('loadSuggestionsForRound({onlyIfChanged}) does not emit when nothing changed', async () => {
  const orig = Repo.fetchSuggestionsByRound;
  const fetched = [sug('1', 'r1'), sug('2', 'r1')];
  Repo.fetchSuggestionsByRound = async () => fetched.map(s => ({ ...s }));
  // Store holds the ENGAGEMENT-wide superset (what refreshRoundList writes)
  const store = [sug('1', 'r1'), sug('2', 'r1'), sug('3', 'r2')];
  Store.setState({ sbClient: {}, suggestions: store });
  let emits = 0;
  Bus.on('suggestions:changed', () => { emits += 1; });
  try {
    await Actions.loadSuggestionsForRound('r1', { onlyIfChanged: true });
    assert.equal(emits, 0, 'unchanged poll must not emit');
    assert.equal(Store.getState().suggestions.length, 3, 'superset left intact');

    // a status change on the server -> emits and updates Store
    Repo.fetchSuggestionsByRound = async () => [sug('1', 'r1', 'approved'), sug('2', 'r1')];
    await Actions.loadSuggestionsForRound('r1', { onlyIfChanged: true });
    assert.equal(emits, 1);
    assert.equal(Store.getState().suggestions[0].status, 'approved');

    // default (no opts) keeps the old always-emit behavior
    await Actions.loadSuggestionsForRound('r1');
    assert.equal(emits, 2);
  } finally { Repo.fetchSuggestionsByRound = orig; }
});

test('refreshAssignmentProgressForRound emits assignments:changed flagged progressOnly', async () => {
  const orig = Repo.fetchAssignmentProgressByRound;
  Repo.fetchAssignmentProgressByRound = async () => [{ id: 'a1', status: 'counting', progress_count: 3, live_snapshot: { counts: {} } }];
  Store.setState({ sbClient: {}, assignments: [{ id: 'a1', roundId: 'r1', status: 'locked', progressCount: 0, liveSnapshot: {}, items: [1, 2] }] });
  let meta;
  Bus.on('assignments:changed', (_p, m) => { meta = m; });
  try {
    await Actions.refreshAssignmentProgressForRound('r1');
    assert.deepEqual(meta, { progressOnly: true });
    const a = Store.getState().assignments[0];
    assert.equal(a.status, 'counting');
    assert.equal(a.progressCount, 3);
    assert.deepEqual(a.items, [1, 2], 'static items payload preserved');
  } finally { Repo.fetchAssignmentProgressByRound = orig; }
});
