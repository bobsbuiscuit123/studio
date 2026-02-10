import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ClubHub AI',
    short_name: 'ClubHub',
    description: 'Club management with AI assistance.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4F0F8',
    theme_color: '#B19CD9',
    icons: [
      {
        src: '/icon.svg',
        sizes: '96x96',
        type: 'image/svg+xml',
      },
    ],
  };
}

