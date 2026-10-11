/**
 * Status badge for MCP server connection states.
 * Mirrors ChannelStatusBadge but uses ServerStatus values; reuses the
 * shared `channels.status.*` i18n keys since the label vocabulary is
 * identical (Connected / Connecting / Disconnected / Error).
 */
import { useT } from '../../../lib/i18n/I18nContext';
import Badge, { type BadgeVariant } from '../../ui/Badge';
import type { ServerStatus } from './types';

const STATUS_META: Record<ServerStatus, { i18nKey: string; variant: BadgeVariant }> = {
  connected: { i18nKey: 'channels.status.connected', variant: 'success' },
  connecting: { i18nKey: 'channels.status.connecting', variant: 'warning' },
  disconnected: { i18nKey: 'channels.status.disconnected', variant: 'neutral' },
  unauthorized: { i18nKey: 'mcp.status.unauthorized', variant: 'warning' },
  error: { i18nKey: 'channels.status.error', variant: 'danger' },
  disabled: { i18nKey: 'mcp.status.disabled', variant: 'neutral' },
};

interface McpStatusBadgeProps {
  status: ServerStatus;
  className?: string;
}

const McpStatusBadge = ({ status, className = '' }: McpStatusBadgeProps) => {
  const { t } = useT();
  const meta = STATUS_META[status] ?? STATUS_META.disconnected;
  return (
    <Badge
      variant={meta.variant}
      role="status"
      aria-live="polite"
      className={`shrink-0 ${status === 'disabled' ? 'italic' : ''} ${className}`}>
      {t(meta.i18nKey)}
    </Badge>
  );
};

export default McpStatusBadge;
