import { describe, expect, it } from 'vitest';

import { EXECUTION_BUDGETS, getExecutionBudgetProfile } from '../../src/execution/budgets.js';

describe('execution budgets', () => {
  it('uses the large-repo profile once the repo file threshold is crossed', () => {
    expect(getExecutionBudgetProfile(6000)).toEqual(EXECUTION_BUDGETS.large);
    expect(EXECUTION_BUDGETS.large.planning.enabled).toBe(false);
  });

  it('keeps the standard profile for smaller repos', () => {
    expect(getExecutionBudgetProfile(400)).toEqual(EXECUTION_BUDGETS.standard);
    expect(EXECUTION_BUDGETS.standard.planning.enabled).toBe(true);
  });
});
