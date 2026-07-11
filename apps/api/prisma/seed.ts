// Aurial demo seed — deterministic and idempotent (fixed ids + upserts).
// Run: pnpm --filter @aurial/api db:seed
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── deterministic PRNG (mulberry32) so every run produces identical data ──
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260711);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
const between = (min: number, max: number): number => Math.floor(min + rand() * (max - min));

const cover = (seedKey: string, size = 600): string =>
  `https://picsum.photos/seed/aurial-${seedKey}/${size}/${size}`;

const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ─────────────────────────── data banks ───────────────────────────

const GENRES = [
  { name: 'Pop', slug: 'pop', color: '#f472b6' },
  { name: 'Rock', slug: 'rock', color: '#ef4444' },
  { name: 'Electronic', slug: 'electronic', color: '#22d3ee' },
  { name: 'Hip-Hop', slug: 'hip-hop', color: '#f59e0b' },
  { name: 'Jazz', slug: 'jazz', color: '#a78bfa' },
  { name: 'Lo-Fi', slug: 'lo-fi', color: '#34d399' },
  { name: 'Ambient', slug: 'ambient', color: '#60a5fa' },
  { name: 'MPB', slug: 'mpb', color: '#fbbf24' },
  { name: 'Indie', slug: 'indie', color: '#fb7185' },
  { name: 'Classical', slug: 'classical', color: '#94a3b8' },
] as const;

const ARTISTS: Array<{ name: string; genres: string[]; verified?: boolean }> = [
  { name: 'Neon Harbor', genres: ['electronic', 'pop'], verified: true },
  { name: 'Luna Vale', genres: ['pop', 'indie'], verified: true },
  { name: 'Os Ventos do Sul', genres: ['mpb', 'jazz'] },
  { name: 'Static Bloom', genres: ['rock', 'indie'], verified: true },
  { name: 'Kaito Mori', genres: ['lo-fi', 'ambient'] },
  { name: 'Marrow & Pine', genres: ['indie', 'rock'] },
  { name: 'DJ Cascata', genres: ['electronic', 'hip-hop'], verified: true },
  { name: 'The Velvet Meridian', genres: ['jazz', 'classical'] },
  { name: 'Aiyana Reyes', genres: ['pop', 'hip-hop'], verified: true },
  { name: 'Glasshouse Choir', genres: ['ambient', 'classical'] },
  { name: 'Rua Oito', genres: ['mpb', 'indie'] },
  { name: 'Cobalt Fields', genres: ['electronic', 'ambient'] },
];

const ALBUM_WORDS_A = [
  'Midnight',
  'Golden',
  'Electric',
  'Silent',
  'Neon',
  'Paper',
  'Distant',
  'Velvet',
  'Hollow',
  'Amber',
];
const ALBUM_WORDS_B = [
  'Horizons',
  'Gardens',
  'Signals',
  'Rivers',
  'Echoes',
  'Postcards',
  'Tides',
  'Lanterns',
  'Motorways',
  'Constellations',
];
const TRACK_WORDS_A = [
  'Falling',
  'Burning',
  'Waiting',
  'Dancing',
  'Drifting',
  'Running',
  'Dreaming',
  'Fading',
  'Shining',
  'Breathing',
];
const TRACK_WORDS_B = [
  'Slow',
  'Wild',
  'Blue',
  'Quiet',
  'Golden',
  'Broken',
  'Hidden',
  'Endless',
  'Foreign',
  'Familiar',
];
const TRACK_WORDS_C = [
  'Lights',
  'Hearts',
  'Streets',
  'Waves',
  'Rooms',
  'Skies',
  'Wires',
  'Shadows',
  'Mornings',
  'Islands',
];

const RADIOS: Array<{
  id: string;
  name: string;
  streamUrl: string;
  genre: string;
  country: string;
}> = [
  {
    id: 'seed-radio-01',
    name: 'SomaFM Groove Salad',
    streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3',
    genre: 'Ambient',
    country: 'US',
  },
  {
    id: 'seed-radio-02',
    name: 'SomaFM DEF CON Radio',
    streamUrl: 'https://ice1.somafm.com/defcon-128-mp3',
    genre: 'Electronic',
    country: 'US',
  },
  {
    id: 'seed-radio-03',
    name: 'SomaFM Drone Zone',
    streamUrl: 'https://ice1.somafm.com/dronezone-128-mp3',
    genre: 'Ambient',
    country: 'US',
  },
  {
    id: 'seed-radio-04',
    name: 'Radio Paradise Main Mix',
    streamUrl: 'https://stream.radioparadise.com/mp3-128',
    genre: 'Rock',
    country: 'US',
  },
  {
    id: 'seed-radio-05',
    name: 'Radio Paradise Mellow',
    streamUrl: 'https://stream.radioparadise.com/mellow-128',
    genre: 'Indie',
    country: 'US',
  },
  {
    id: 'seed-radio-06',
    name: 'SomaFM Secret Agent',
    streamUrl: 'https://ice1.somafm.com/secretagent-128-mp3',
    genre: 'Jazz',
    country: 'US',
  },
];

const BADGES = [
  { id: 'seed-badge-early', name: 'Early Bird', description: 'Joined during the beta', icon: '🐦' },
  {
    id: 'seed-badge-audiophile',
    name: 'Audiophile',
    description: 'Streamed 100 hours of lossless audio',
    icon: '🎧',
  },
  {
    id: 'seed-badge-curator',
    name: 'Curator',
    description: 'Created 10 public playlists',
    icon: '🗂️',
  },
  {
    id: 'seed-badge-explorer',
    name: 'Explorer',
    description: 'Listened to 20 different genres',
    icon: '🧭',
  },
  {
    id: 'seed-badge-night-owl',
    name: 'Night Owl',
    description: 'Most plays after midnight',
    icon: '🦉',
  },
  {
    id: 'seed-badge-uploader',
    name: 'Tape Trader',
    description: 'Uploaded your first track',
    icon: '📼',
  },
];

// ─────────────────────────── seeding ───────────────────────────

async function seedGenres(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const g of GENRES) {
    const row = await prisma.genre.upsert({
      where: { slug: g.slug },
      update: { name: g.name, color: g.color },
      create: { name: g.name, slug: g.slug, color: g.color },
    });
    map.set(g.slug, row.id);
  }
  return map;
}

async function seedArtists(genreIds: Map<string, string>): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < ARTISTS.length; i += 1) {
    const a = ARTISTS[i];
    if (!a) continue;
    const id = `seed-artist-${String(i + 1).padStart(2, '0')}`;
    const slug = slugify(a.name);
    await prisma.artist.upsert({
      where: { slug },
      update: { imageUrl: cover(slug, 500), verified: a.verified ?? false },
      create: {
        id,
        name: a.name,
        slug,
        imageUrl: cover(slug, 500),
        bannerUrl: cover(`${slug}-banner`, 1200),
        bio: `${a.name} — one of Aurial's demo catalog artists.`,
        verified: a.verified ?? false,
        monthlyListeners: between(2_000, 900_000),
      },
    });
    for (const gslug of a.genres) {
      const genreId = genreIds.get(gslug);
      if (!genreId) continue;
      await prisma.artistGenre.upsert({
        where: { artistId_genreId: { artistId: id, genreId } },
        update: {},
        create: { artistId: id, genreId },
      });
    }
    ids.push(id);
  }
  return ids;
}

interface SeededAlbum {
  id: string;
  artistId: string;
  artistIndex: number;
  genreSlugs: string[];
}

async function seedAlbums(
  artistIds: string[],
  genreIds: Map<string, string>,
): Promise<SeededAlbum[]> {
  const albums: SeededAlbum[] = [];
  for (let i = 0; i < 20; i += 1) {
    const artistIndex = i % artistIds.length;
    const artistId = artistIds[artistIndex];
    const artistDef = ARTISTS[artistIndex];
    if (!artistId || !artistDef) continue;
    const id = `seed-album-${String(i + 1).padStart(2, '0')}`;
    const title = `${ALBUM_WORDS_A[i % ALBUM_WORDS_A.length]} ${ALBUM_WORDS_B[(i * 3 + 1) % ALBUM_WORDS_B.length]}`;
    const slug = slugify(`${artistDef.name} ${title}`);
    const releaseDate = new Date(Date.UTC(2020 + (i % 6), i % 12, ((i * 7) % 27) + 1));
    await prisma.album.upsert({
      where: { slug },
      update: { coverUrl: cover(slug) },
      create: {
        id,
        title,
        slug,
        type: i % 7 === 0 ? 'EP' : i % 11 === 0 ? 'SINGLE' : 'ALBUM',
        coverUrl: cover(slug),
        dominantColor: pick(['#1e293b', '#7c2d12', '#14532d', '#312e81', '#831843', '#334155']),
        releaseDate,
      },
    });
    await prisma.albumArtist.upsert({
      where: { albumId_artistId: { albumId: id, artistId } },
      update: {},
      create: { albumId: id, artistId },
    });
    for (const gslug of artistDef.genres) {
      const genreId = genreIds.get(gslug);
      if (!genreId) continue;
      await prisma.albumGenre.upsert({
        where: { albumId_genreId: { albumId: id, genreId } },
        update: {},
        create: { albumId: id, genreId },
      });
    }
    albums.push({ id, artistId, artistIndex, genreSlugs: artistDef.genres });
  }
  return albums;
}

async function seedTracks(albums: SeededAlbum[], genreIds: Map<string, string>): Promise<string[]> {
  const trackIds: string[] = [];
  let n = 0;
  for (const album of albums) {
    for (let t = 0; t < 6; t += 1) {
      n += 1;
      const id = `seed-track-${String(n).padStart(3, '0')}`;
      const title = `${TRACK_WORDS_A[(n * 7) % TRACK_WORDS_A.length]} ${TRACK_WORDS_B[(n * 3) % TRACK_WORDS_B.length]} ${TRACK_WORDS_C[(n * 5) % TRACK_WORDS_C.length]}`;
      await prisma.track.upsert({
        where: { id },
        update: { playsCount: between(50, 250_000) },
        create: {
          id,
          title,
          durationMs: between(150_000, 360_000),
          trackNumber: t + 1,
          discNumber: 1,
          explicit: rand() < 0.12,
          playsCount: between(50, 250_000),
          coverUrl: cover(`track-${id}`),
          dominantColor: pick(['#0f172a', '#450a0a', '#052e16', '#1e1b4b', '#500724']),
          loudnessLufs: -(8 + rand() * 10),
          truePeakDb: -(0.2 + rand() * 2),
          // No real audio in the seed → hlsKey stays null (streamUrl null).
          isPublic: true,
          albumId: album.id,
        },
      });
      await prisma.trackArtist.upsert({
        where: { trackId_artistId: { trackId: id, artistId: album.artistId } },
        update: {},
        create: { trackId: id, artistId: album.artistId },
      });
      const gslug = album.genreSlugs[t % album.genreSlugs.length];
      const genreId = gslug ? genreIds.get(gslug) : undefined;
      if (genreId) {
        await prisma.trackGenre.upsert({
          where: { trackId_genreId: { trackId: id, genreId } },
          update: {},
          create: { trackId: id, genreId },
        });
      }
      trackIds.push(id);
    }
  }
  return trackIds;
}

async function seedUsers(): Promise<string[]> {
  const users = [
    {
      id: 'seed-user-a',
      firebaseUid: 'seed-user-1',
      handle: 'vinicius',
      displayName: 'Vinícius',
      role: 'ADMIN' as const,
    },
    {
      id: 'seed-user-b',
      firebaseUid: 'seed-user-2',
      handle: 'maya_beats',
      displayName: 'Maya Beats',
      role: 'USER' as const,
    },
    {
      id: 'seed-user-c',
      firebaseUid: 'seed-user-3',
      handle: 'joao.lofi',
      displayName: 'João Lo-Fi',
      role: 'USER' as const,
    },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { firebaseUid: u.firebaseUid },
      update: { role: u.role },
      create: {
        id: u.id,
        firebaseUid: u.firebaseUid,
        email: `${u.handle.replace(/[^a-z0-9]/g, '')}@demo.aurial.app`,
        handle: u.handle,
        displayName: u.displayName,
        avatarUrl: cover(`avatar-${u.handle}`, 300),
        role: u.role,
        isPremium: u.role === 'ADMIN',
        settings: { theme: 'dark', audioQuality: 'high', normalizeVolume: true },
      },
    });
  }
  // social graph
  await prisma.userFollow.upsert({
    where: { followerId_followeeId: { followerId: 'seed-user-b', followeeId: 'seed-user-a' } },
    update: {},
    create: { followerId: 'seed-user-b', followeeId: 'seed-user-a' },
  });
  await prisma.userFollow.upsert({
    where: { followerId_followeeId: { followerId: 'seed-user-a', followeeId: 'seed-user-c' } },
    update: {},
    create: { followerId: 'seed-user-a', followeeId: 'seed-user-c' },
  });
  return users.map((u) => u.id);
}

async function seedPlaylists(userIds: string[], trackIds: string[]): Promise<void> {
  const defs = [
    {
      id: 'seed-playlist-01',
      owner: 0,
      title: 'Focus Deep Work',
      description: 'Instrumental focus fuel',
      from: 0,
      count: 15,
    },
    {
      id: 'seed-playlist-02',
      owner: 0,
      title: 'Friday Night Drive',
      description: 'Synths and neon',
      from: 20,
      count: 12,
    },
    {
      id: 'seed-playlist-03',
      owner: 1,
      title: 'Café da Manhã',
      description: 'MPB para começar o dia',
      from: 40,
      count: 10,
    },
    {
      id: 'seed-playlist-04',
      owner: 1,
      title: 'Gym Rotation',
      description: null,
      from: 60,
      count: 14,
    },
    {
      id: 'seed-playlist-05',
      owner: 2,
      title: 'Lo-Fi Study Beats',
      description: 'Tape hiss included',
      from: 80,
      count: 12,
    },
  ];
  for (const p of defs) {
    const ownerId = userIds[p.owner];
    if (!ownerId) continue;
    await prisma.playlist.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        title: p.title,
        description: p.description,
        coverUrl: cover(p.id),
        isPublic: true,
        isCollaborative: p.id === 'seed-playlist-02',
        ownerId,
      },
    });
    for (let i = 0; i < p.count; i += 1) {
      const trackId = trackIds[(p.from + i) % trackIds.length];
      if (!trackId) continue;
      await prisma.playlistTrack.upsert({
        where: { id: `${p.id}-entry-${String(i).padStart(2, '0')}` },
        update: {},
        create: {
          id: `${p.id}-entry-${String(i).padStart(2, '0')}`,
          playlistId: p.id,
          trackId,
          position: i,
          addedById: ownerId,
        },
      });
    }
  }
  await prisma.playlistFollow.upsert({
    where: { playlistId_userId: { playlistId: 'seed-playlist-01', userId: 'seed-user-b' } },
    update: {},
    create: { playlistId: 'seed-playlist-01', userId: 'seed-user-b' },
  });
}

async function seedEngagement(
  userIds: string[],
  trackIds: string[],
  artistIds: string[],
): Promise<void> {
  // likes
  for (const [ui, userId] of userIds.entries()) {
    for (let i = 0; i < 25; i += 1) {
      const trackId = trackIds[(ui * 37 + i * 3) % trackIds.length];
      if (!trackId) continue;
      await prisma.likedTrack.upsert({
        where: { userId_trackId: { userId, trackId } },
        update: {},
        create: { userId, trackId },
      });
    }
    const artistId = artistIds[(ui * 5 + 1) % artistIds.length];
    if (artistId) {
      await prisma.artistFollow.upsert({
        where: { userId_artistId: { userId, artistId } },
        update: {},
        create: { userId, artistId },
      });
    }
    const albumId = `seed-album-${String(((ui * 4 + 2) % 20) + 1).padStart(2, '0')}`;
    await prisma.likedAlbum.upsert({
      where: { userId_albumId: { userId, albumId } },
      update: {},
      create: { userId, albumId },
    });
  }

  // play history: ~60 plays over the last 30 days for the primary user + some for others
  const sources = ['album', 'playlist', 'home', 'search', 'library'] as const;
  for (const [ui, userId] of userIds.entries()) {
    const plays = ui === 0 ? 60 : 25;
    for (let i = 0; i < plays; i += 1) {
      const id = `seed-history-${userId}-${String(i).padStart(3, '0')}`;
      const trackId = trackIds[(ui * 11 + i * 7) % trackIds.length];
      if (!trackId) continue;
      const completed = rand() < 0.7;
      const playedAt = new Date(Date.now() - between(0, 30 * 24 * 3600) * 1000);
      await prisma.playHistory.upsert({
        where: { id },
        update: {},
        create: {
          id,
          userId,
          trackId,
          playedMs: between(30_000, 300_000),
          positionMs: completed ? null : between(30_000, 200_000),
          completed,
          source: pick(sources),
          sourceId: null,
          playedAt,
        },
      });
    }
  }

  // comments
  const comments = [
    {
      id: 'seed-comment-01',
      user: 'seed-user-b',
      track: trackIds[0],
      body: 'This one lives in my head rent-free 🔥',
    },
    {
      id: 'seed-comment-02',
      user: 'seed-user-c',
      track: trackIds[0],
      body: 'The bridge at 2:10 is unreal.',
    },
    {
      id: 'seed-comment-03',
      user: 'seed-user-a',
      track: trackIds[7],
      body: 'Perfect for late night coding sessions.',
    },
  ];
  for (const c of comments) {
    if (!c.track) continue;
    await prisma.comment.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, trackId: c.track, userId: c.user, body: c.body },
    });
  }
}

async function seedPodcasts(): Promise<void> {
  const podcasts = [
    {
      id: 'seed-podcast-01',
      title: 'Waveform Stories',
      publisher: 'Aurial Originals',
      description: 'Conversations about the songs that changed lives.',
      feedUrl: 'https://feeds.aurial.app/waveform-stories.xml',
    },
    {
      id: 'seed-podcast-02',
      title: 'Backstage Brasil',
      publisher: 'Estúdio Oito',
      description: 'Bastidores da música brasileira independente.',
      feedUrl: 'https://feeds.aurial.app/backstage-brasil.xml',
    },
  ];
  for (const [pi, p] of podcasts.entries()) {
    await prisma.podcast.upsert({
      where: { feedUrl: p.feedUrl },
      update: {},
      create: { ...p, coverUrl: cover(p.id) },
    });
    for (let e = 0; e < 8; e += 1) {
      const id = `${p.id}-ep-${String(e + 1).padStart(2, '0')}`;
      await prisma.episode.upsert({
        where: { id },
        update: {},
        create: {
          id,
          podcastId: p.id,
          title: `Episode ${e + 1}: ${pick(ALBUM_WORDS_A)} ${pick(ALBUM_WORDS_B)}`,
          description: 'Demo episode seeded for development.',
          durationMs: between(20 * 60_000, 75 * 60_000),
          audioUrl: `https://cdn.aurial.app/podcasts/${p.id}/ep-${e + 1}.mp3`,
          coverUrl: cover(`${p.id}-ep-${e + 1}`, 400),
          publishedAt: new Date(Date.UTC(2025, pi * 3 + (e % 12), ((e * 9) % 27) + 1)),
        },
      });
    }
  }
}

async function seedRadiosAndBadges(): Promise<void> {
  for (const r of RADIOS) {
    await prisma.radioStation.upsert({
      where: { id: r.id },
      update: { streamUrl: r.streamUrl },
      create: { ...r, imageUrl: cover(r.id, 400), isLive: true },
    });
  }
  for (const b of BADGES) {
    await prisma.badge.upsert({ where: { name: b.name }, update: {}, create: b });
  }
  const awards: Array<[string, string]> = [
    ['seed-user-a', 'seed-badge-early'],
    ['seed-user-a', 'seed-badge-curator'],
    ['seed-user-b', 'seed-badge-early'],
    ['seed-user-b', 'seed-badge-night-owl'],
    ['seed-user-c', 'seed-badge-explorer'],
  ];
  for (const [userId, badgeId] of awards) {
    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId, badgeId } },
      update: {},
      create: { userId, badgeId },
    });
  }
}

async function main(): Promise<void> {
  console.log('🌱 Seeding Aurial demo data (idempotent)...');
  const genreIds = await seedGenres();
  const artistIds = await seedArtists(genreIds);
  const albums = await seedAlbums(artistIds, genreIds);
  const trackIds = await seedTracks(albums, genreIds);
  const userIds = await seedUsers();
  await seedPlaylists(userIds, trackIds);
  await seedEngagement(userIds, trackIds, artistIds);
  await seedPodcasts();
  await seedRadiosAndBadges();
  console.log(
    `✅ Seeded: ${GENRES.length} genres, ${artistIds.length} artists, ${albums.length} albums, ${trackIds.length} tracks, ${userIds.length} users, 5 playlists, ${RADIOS.length} radios, 2 podcasts, ${BADGES.length} badges.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
