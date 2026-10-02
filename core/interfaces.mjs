import {validatePuzzle} from './validator.mjs';

/**
 * Extension contracts, intentionally no network, language-model or PDF implementation.
 *
 * NewsCollector.collect({from,to}) -> Promise<Event[]>
 * Event: {event_id, event_date, title, summary, categories: string[],
 *         sources: {source_id,publisher,kind,url,published_at,excerpt}[],
 *         fact_status, event_score, anchor_event, updated_at?, keywords?}
 *
 * CandidateGenerator.generate(events) -> Promise<CandidateAnswer[]>
 * CandidateAnswer: {id, word, event_id, event_revision?, clue, answer_score, difficulty,
 *                   source_support, event?, ...extraMetadata}
 * Solver preserves all candidate fields in expected[] and unselected[].
 *
 * ClueGenerator.generate(puzzle, events) -> Promise<Map<candidate_id,string>>
 *
 * PuzzleRenderer.render(puzzle, validation) -> Promise<artifact>
 * Rendering must not change cells or placements. A4/PDF is a future adapter.
 * Grid VALID is not a claim that news facts, freshness or clue uniqueness passed.
 */
export async function renderValidated(puzzle, renderer) {
  // Snapshot prevents callers changing the puzzle between validation and render.
  const snapshot=structuredClone(puzzle);
  const report=validatePuzzle(snapshot);
  if(!report.valid) throw new Error('INVALID puzzle: rendering blocked');
  return renderer.render(snapshot,report);
}