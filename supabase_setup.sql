-- Ejecuta este script en el "SQL Editor" de tu proyecto gratuito de Supabase
-- Run this script in the "SQL Editor" of your free Supabase project

-- 1. Tabla para guardar tus canciones y audios
create table if not exists public.tracks (
  id text primary key,
  title text not null,
  artist text not null,
  album text default '',
  category text default 'Música',
  genre text default 'Rock',
  audio_url text not null,
  cover_url text default '',
  duration integer default 210,
  liked boolean default false,
  created_at timestamptz default now()
);

-- 2. Habilitar acceso público (o puedes restringirlo luego con autenticación)
alter table public.tracks enable row level security;

create policy "Permitir lectura publica de tracks"
  on public.tracks for select
  using (true);

create policy "Permitir insercion y actualizacion de tracks"
  on public.tracks for insert
  with check (true);

create policy "Permitir update de tracks"
  on public.tracks for update
  using (true);

create policy "Permitir borrado de tracks"
  on public.tracks for delete
  using (true);

-- 3. Crear el bucket público "audios" en Supabase Storage
insert into storage.buckets (id, name, public)
values ('audios', 'audios', true)
on conflict (id) do nothing;

create policy "Acceso publico a archivos de audio"
  on storage.objects for select
  using ( bucket_id = 'audios' );

create policy "Subida de archivos de audio"
  on storage.objects for insert
  with check ( bucket_id = 'audios' );
