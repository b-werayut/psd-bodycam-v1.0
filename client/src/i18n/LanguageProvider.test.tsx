import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LanguageProvider } from './LanguageProvider';
import { useLanguage } from './useLanguage';

function Probe() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div>
      <output aria-label="language">{language}</output>
      <output aria-label="text">{t('common.loading')}</output>
      <button type="button" onClick={() => setLanguage('en')}>
        English
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <LanguageProvider>
      <Probe />
    </LanguageProvider>,
  );
}

describe('LanguageProvider', () => {
  it('defaults to Thai and sets html lang', () => {
    renderProbe();
    expect(screen.getByLabelText('language').textContent).toBe('th');
    expect(document.documentElement.lang).toBe('th');
  });

  it('setLanguage persists and updates html lang', () => {
    renderProbe();
    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(window.localStorage.getItem('bodycam.language')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByLabelText('language').textContent).toBe('en');
  });

  it('switches back via a storage event', () => {
    renderProbe();
    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'bodycam.language', newValue: 'th' }),
      );
    });

    expect(screen.getByLabelText('language').textContent).toBe('th');
    expect(document.documentElement.lang).toBe('th');
  });

  it('reads the stored language', () => {
    window.localStorage.setItem('bodycam.language', 'en');
    renderProbe();
    expect(screen.getByLabelText('language').textContent).toBe('en');
  });
});
