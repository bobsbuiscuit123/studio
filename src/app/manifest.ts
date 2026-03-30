import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CASPO',
    short_name: 'CASPO',
    description: 'Group management with AI assistance.',
    start_url: '/',
    display: 'standalone',
    background_color: '#CFEFD9',
    theme_color: '#63C285',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}


