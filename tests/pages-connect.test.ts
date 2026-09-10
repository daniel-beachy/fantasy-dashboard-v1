import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ConnectDialog } from '../src/components/ConnectDialog';

vi.mock('../src/lib/api', () => ({ api: { isLocal: false } }));

it('links the static demo to the hosted application while retaining local setup', () => {
  const html = renderToStaticMarkup(createElement(ConnectDialog, {
    onClose: () => {}, onConnected: async () => {}, onDisconnect: async () => {},
    initialSession: null, companionError: '',
  }));
  expect(html).toContain('href="https://fantasy-dashboard-v1.daniel-beachy.workers.dev/"');
  expect(html).toContain('Open connected web app');
  expect(html).toContain('#connect-your-espn-account-locally');
  expect(html).toContain('npm run dev');
  expect(html).not.toContain('Your session stays on your machine.');
});
