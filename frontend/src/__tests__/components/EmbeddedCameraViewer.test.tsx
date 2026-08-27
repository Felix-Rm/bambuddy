import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../utils';
import { server } from '../mocks/server';
import { EmbeddedCameraViewer } from '../../components/EmbeddedCameraViewer';

const builtinPrinter = {
  id: 1,
  name: 'X1 Carbon',
  model: 'X1C',
  camera_rotation: 0,
  external_camera_enabled: false,
  external_camera_url: null,
};

const printerWithExternal = {
  ...builtinPrinter,
  external_camera_enabled: true,
  external_camera_url: 'http://192.168.1.50/mjpeg',
  external_camera_type: 'mjpeg',
};

describe('EmbeddedCameraViewer camera source switcher', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/v1/printers/:id/camera/stop', () => HttpResponse.json({ success: true })),
      http.get('/api/v1/printers/:id/camera/status', () =>
        HttpResponse.json({ active: true, stalled: false })
      )
    );
  });

  it('hides camera badges when no external camera is configured', async () => {
    server.use(http.get('/api/v1/printers/:id', () => HttpResponse.json(builtinPrinter)));

    render(
      <EmbeddedCameraViewer printerId={1} printerName="X1 Carbon" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('X1 Carbon')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Built-in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'External' })).not.toBeInTheDocument();
  });

  it('shows badges and switches the stream to the built-in camera', async () => {
    server.use(http.get('/api/v1/printers/:id', () => HttpResponse.json(printerWithExternal)));

    render(
      <EmbeddedCameraViewer printerId={1} printerName="X1 Carbon" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'External' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Built-in' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Built-in' }));

    await waitFor(() => {
      const src = (document.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') || '';
      expect(src).toContain('source=builtin');
    });
  });

  it('round-trips back to the external camera without overlapping stream URLs', async () => {
    server.use(http.get('/api/v1/printers/:id', () => HttpResponse.json(printerWithExternal)));

    render(
      <EmbeddedCameraViewer printerId={1} printerName="X1 Carbon" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'External' })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Built-in' }));
    await waitFor(() => {
      const src = (document.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') || '';
      expect(src).toContain('source=builtin');
    });

    await user.click(screen.getByRole('button', { name: 'External' }));
    await waitFor(() => {
      const src = (document.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') || '';
      expect(src).toContain('source=external');
    });
  });
});
