import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { DeviceStateBadge } from './DeviceStateBadge';
import { deviceStateTone } from './deviceStateTone';

describe('deviceStateTone', () => {
  it('matches reference connectivity tones: online success, offline destructive, unknown neutral', () => {
    expect(deviceStateTone('online')).toBe('success');
    expect(deviceStateTone('offline')).toBe('destructive');
    expect(deviceStateTone('unknown')).toBe('neutral');
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
    expect(badge.closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
  });
});
