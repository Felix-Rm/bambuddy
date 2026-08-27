import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils';
import {
  CameraSourceSwitcher,
  printerHasExternalCamera,
  openPrinterCameraWindow,
} from '../../components/CameraSourceSwitcher';

describe('printerHasExternalCamera', () => {
  it('is true only when the external camera is enabled and has a URL', () => {
    expect(printerHasExternalCamera(undefined)).toBe(false);
    expect(printerHasExternalCamera({ external_camera_enabled: false, external_camera_url: 'http://cam' })).toBe(false);
    expect(printerHasExternalCamera({ external_camera_enabled: true, external_camera_url: null })).toBe(false);
    expect(printerHasExternalCamera({ external_camera_enabled: true, external_camera_url: 'http://cam' })).toBe(true);
  });
});

describe('CameraSourceSwitcher', () => {
  it('highlights the selected camera badge', () => {
    render(<CameraSourceSwitcher selected="external" onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'External' })).toHaveClass('bg-bambu-green');
    expect(screen.getByRole('button', { name: 'Built-in' })).not.toHaveClass('bg-bambu-green');
    expect(screen.getByRole('button', { name: 'Built-in' })).toHaveClass('px-3', 'py-1', 'text-xs');
    expect(screen.getByRole('button', { name: 'External' })).toHaveClass('px-3', 'py-1', 'text-xs');
  });

  it('uses compact padding on cam-wall tiles', () => {
    render(<CameraSourceSwitcher selected="external" onSelect={vi.fn()} size="compact" />);

    expect(screen.getByRole('button', { name: 'Built-in' })).toHaveClass('px-1.5', 'py-0.5', 'text-[10px]');
  });

  it('calls onSelect with the clicked camera', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CameraSourceSwitcher selected="external" onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'Built-in' }));
    expect(onSelect).toHaveBeenCalledWith('builtin');
  });
});

describe('openPrinterCameraWindow', () => {
  it('opens a named window and focuses it without a second navigation', () => {
    const win = { location: { href: '' }, focus: vi.fn() };
    const open = vi.fn(() => win);
    vi.stubGlobal('open', open);

    openPrinterCameraWindow(3, 'width=640,height=400');

    expect(open).toHaveBeenCalledWith('/camera/3', 'camera-3', 'width=640,height=400');
    expect(win.location.href).toBe('');
    expect(win.focus).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
