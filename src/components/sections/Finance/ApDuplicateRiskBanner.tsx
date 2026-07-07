/**
 * src/components/sections/Finance/ApDuplicateRiskBanner.tsx
 *
 * Inline banner displayed in PayablesOverview when there are pending
 * duplicate-risk reviews. Opens the ApDuplicateReviewDrawer on click.
 */

import { type VNode } from 'preact';
import { InsightBanner } from '@ui';
import { useApDuplicateRisks } from '@api/finance/accountsPayable';

interface Props {
  onReview: () => void;
}

export function ApDuplicateRiskBanner({ onReview }: Props): VNode | null {
  const risks = useApDuplicateRisks();
  const count = (risks.data ?? []).length;

  if (risks.isLoading || count === 0) return null;

  return (
    <InsightBanner
      title={`${count} duplicate risk${count === 1 ? '' : 's'} need review`}
      sub={`${count} bill${count === 1 ? '' : 's'} may be a duplicate of an existing bill. Review and resolve to keep your payables accurate.`}
      actions={[{ label: 'Review now', onClick: onReview, primary: true }]}
    />
  );
}
