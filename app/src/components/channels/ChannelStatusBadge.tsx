import { useT } from '../../lib/i18n/I18nContext';
import type { ChannelConnectionStatus } from '../../types/channels';
import Badge, { type BadgeVariant } from '../ui/Badge';

interface ChannelStatusBadgeProps {
  status: ChannelConnectionStatus;
  className?: string;
}

/** Channel connection status as the shared outline status chip. */
const STATUS_VARIANT: Record<ChannelConnectionStatus, BadgeVariant> = {
  connected: 'success',
  connecting: 'warning',
  error: 'danger',
  disconnected: 'neutral',
};

const ChannelStatusBadge = ({ status, className = '' }: ChannelStatusBadgeProps) => {
  const { t } = useT();
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'neutral'} className={`shrink-0 ${className}`}>
      {t(`channels.status.${status}`)}
    </Badge>
  );
};

export default ChannelStatusBadge;
