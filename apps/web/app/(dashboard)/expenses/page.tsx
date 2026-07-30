'use client';

/**
 * The treasury's expense surface. Officers only.
 *
 * The guard is here rather than inside ExpensesView so the rule is visible at
 * the route: this is the officer-only group, and a new surface joining it
 * copies one wrapper.
 *
 * No data provider yet: there is no expense repository, and the port for one
 * should be designed against the real feature rather than guessed at now.
 */

import {CapabilityGuard} from '../../../components/shell/capability-guard';
import {ExpensesView} from '../../../components/treasury/expenses-view';

export default function ExpensesPage() {
  return (
    <CapabilityGuard capability="expense:view">
      <ExpensesView />
    </CapabilityGuard>
  );
}
