/*
 * One titled group of workload rows (chat, or background) rendered as a Card
 * holding a real table: the task on the left, the route it resolves to on the
 * right. `Table` wraps itself in `overflow-x-auto`, so a narrow settings pane
 * scrolls the matrix rather than the whole page.
 */
import { type ReactNode } from 'react';

import { useT } from '../../../../lib/i18n/I18nContext';
import Card from '../../../ui/Card';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../../ui/Table';

export const WorkloadTable = ({
  title,
  description,
  children,
  'data-testid': testId,
}: {
  title: string;
  description: string;
  children: ReactNode;
  'data-testid'?: string;
}) => {
  const { t } = useT();
  return (
    <Card title={title} description={description} className="w-full" data-testid={testId}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">{t('settings.ai.routing.columnTask')}</TableHead>
            <TableHead className="w-px whitespace-nowrap pr-4">
              {t('settings.ai.routing.columnRoute')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </Card>
  );
};

export default WorkloadTable;
