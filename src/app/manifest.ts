import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CASPO',
    short_name: 'CASPO',
    description: 'Group management with AI assistance.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4F0F8',
    theme_color: '#B19CD9',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}


