/**
 * Names the route, and mounts the treasury store for everything under it.
 * See the calendar's layout for why the title lives in a layout, and
 * `TreasuryProvider` for why the store is hoisted to this level.
 */

import type {Metadata} from 'next';

import {TreasuryProvider} from '../../../components/treasury/treasury-provider';

export const metadata: Metadata = {
  title: 'Expenses',
};

export default function ExpensesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TreasuryProvider>{children}</TreasuryProvider>;
}
