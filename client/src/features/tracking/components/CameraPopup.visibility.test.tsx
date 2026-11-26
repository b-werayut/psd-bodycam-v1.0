import { act, render } from '@testing-library/react';
import L from 'leaflet';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { LiveDevice } from '../liveMerge';
import { CameraPopup } from './CameraPopup';

const liveMap = vi.hoisted(() => {
  const element = { current: null as HTMLDivElement | null };
  return ({
  element,
  anchor: { x: 300, y: 300 },
  listeners: new Map<string, () => void>(),
  popup: {
    options: {}, isOpen: () => true, getElement: () => element.current,
    getLatLng: () => ({ lat: 13.84, lng: 99.92 }), setLatLng: vi.fn(), update: vi.fn(),
  },
});
});

vi.mock('react-leaflet', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react');
  const map = { getSize: () => ({ x: 728, y: 664 }), latLngToContainerPoint: () => liveMap.anchor };
  return {
    useMap: () => map,
    useMapEvent: (name: string, callback: () => void) => {
      useEffect(() => {
        liveMap.listeners.set(name, callback);
        return () => { liveMap.listeners.delete(name); };
      }, [name, callback]);
      return map;
    },
    Popup: forwardRef(({ children }: { children: ReactNode }, ref) => {
      useImperativeHandle(ref, () => liveMap.popup);
      return <div ref={(element) => { liveMap.element.current = element; }}>{children}</div>;
    }),
  };
});

const device: LiveDevice = {
  id: '1', deviceCode: '1000027', name: 'Bodytest', lat: 13.84, lng: 99.92,
  lastFixAt: null, speedKph: null, platformState: 'online', platformStatusFetchedAt: null, live: false,
};

function showPopup() {
  const onClose = vi.fn();
  render(<LanguageProvider><MemoryRouter>
    <CameraPopup device={device} now={Date.now()} fixActiveSeconds={150} onClose={onClose} />
  </MemoryRouter></LanguageProvider>);
  return onClose;
}

describe('camera popup visibility while moving the map', () => {
  beforeEach(() => {
    liveMap.anchor = { x: 300, y: 300 };
    liveMap.listeners.clear();
  });

  it('hides the card without closing its selection when the pin leaves the viewport', () => {
    const onClose = showPopup();
    liveMap.anchor = L.point(-30, 300);
    act(() => liveMap.listeners.get('move')?.());
    expect(liveMap.element.current).toHaveAttribute('aria-hidden', 'true');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the card open while part of the selected pin remains visible', () => {
    const onClose = showPopup();
    liveMap.anchor = L.point(-10, 300);
    act(() => liveMap.listeners.get('moveend')?.());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('restores the same card when its pin returns without requesting a new selection', () => {
    const onClose = showPopup();
    liveMap.anchor = L.point(300, 720);
    act(() => liveMap.listeners.get('moveend')?.());
    expect(liveMap.element.current).toHaveAttribute('aria-hidden', 'true');
    liveMap.anchor = L.point(300, 300);
    act(() => liveMap.listeners.get('move')?.());
    act(() => liveMap.listeners.get('moveend')?.());
    expect(liveMap.element.current).toHaveAttribute('aria-hidden', 'false');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the selected card on a blank-map click', () => {
    const onClose = showPopup();
    act(() => liveMap.listeners.get('click')?.());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
