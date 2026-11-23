import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { DeviceStateBadge } from './DeviceStateBadge';
import { deviceStateTone } from './deviceStateTone';

describe('deviceStateTone', () => {
  it('online success · offline neutral · unknown warning', () => {
    expect(deviceStateTone('online')).toBe('success');
    expect(deviceStateTone('offline')).toBe('neutral');
    expect(deviceStateTone('unknown')).toBe('warning');
  });
});

describe('DeviceStateBadge', () => {
  it('shows the Thai label with the matching tone', () => {
    render(
      <LanguageProvider>
        <DeviceStateBadge state="unknown" />
      </LanguageProvider>,
    );
    const badge = screen.getByText('ไม่ทราบสถานะ');
    expect(badge.closest('[data-tone]')).toHaveAttribute('data-tone', 'warning');
  });
});
