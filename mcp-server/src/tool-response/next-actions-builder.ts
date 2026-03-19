import type { NormalizedMode, NormalizedNextAction } from './normalized-types.js';
import { getNormalizedModeShape, shapeCollectionForMode } from './mode-shaping.js';

export interface BuildNormalizedNextActionsOptions {
  mode: NormalizedMode;
  maxItems?: number;
}

function buildNextActionKey(action: NormalizedNextAction): string {
  return `${action.tool}::${action.reason}::${JSON.stringify(action.query ?? {})}`;
}

export function buildNormalizedNextAction(input: NormalizedNextAction): NormalizedNextAction {
  return {
    tool: input.tool,
    reason: input.reason,
    ...(input.query ? { query: input.query } : {}),
  };
}

export function buildNormalizedNextActions(
  actions: NormalizedNextAction[] = [],
  options: BuildNormalizedNextActionsOptions,
): NormalizedNextAction[] {
  const deduped = Array.from(
    new Map(actions.map((action) => [buildNextActionKey(action), buildNormalizedNextAction(action)])).values(),
  );
  const limit = options.maxItems ?? getNormalizedModeShape(options.mode).defaultNextActionCount;
  return shapeCollectionForMode(deduped, { limit });
}
