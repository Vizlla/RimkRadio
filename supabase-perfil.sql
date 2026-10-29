-- Perfil do RimkRadio (nome de exibição, bio e likes recebidos).
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar de novo sem medo.
--
-- O que isto cria:
--   profiles.display_name / profiles.bio   -> nome de exibição e bio (o login/@usuario NÃO muda)
--   profile_likes                          -> 1 linha por (quem curtiu, sala, música); o dono é quem pediu a música
--   set_my_profile(text, text)             -> a pessoa logada salva o PRÓPRIO nome e bio
--   credit_profile_like(text,text,text,boolean) -> chamada logo depois do like/deslike na música
--   profile_card(text)                     -> devolve nome, bio e total de likes de alguém (pelo @usuario)
--
-- A tabela fica trancada (RLS ligado, sem policies): só as funções abaixo mexem nela.

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists bio text;

create table if not exists public.profile_likes (
  voter_id   uuid        not null,
  room_id    text        not null,
  song_key   text        not null,
  owner_id   uuid        not null,
  created_at timestamptz not null default now(),
  primary key (voter_id, room_id, song_key)
);
create index if not exists profile_likes_owner_idx on public.profile_likes (owner_id);
alter table public.profile_likes enable row level security;

-- Nome e bio do próprio perfil ------------------------------------------------
create or replace function public.set_my_profile(p_display_name text, p_bio text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', ' ', 'g')), '');
  v_bio  text := nullif(trim(regexp_replace(
                   regexp_replace(coalesce(p_bio, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g'),
                   E'\n{3,}', E'\n\n', 'g')), '');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_name is not null then v_name := regexp_replace(v_name, '\s+', ' ', 'g'); end if;
  if v_name is not null and char_length(v_name) > 24 then raise exception 'invalid name'; end if;
  if v_bio  is not null and char_length(v_bio)  > 160 then raise exception 'invalid bio'; end if;
  update public.profiles set display_name = v_name, bio = v_bio where id = auth.uid();
end;
$$;

-- Likes recebidos --------------------------------------------------------------
-- p_on = true  -> a pessoa está curtindo a música (credita 1 like ao dono)
-- p_on = false -> tirou o like ou trocou por deslike (remove o crédito)
-- Idempotente: repetir a mesma chamada não soma duas vezes.
create or replace function public.credit_profile_like(p_room text, p_song text, p_owner text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_owner uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_room is null or p_song is null
     or char_length(p_room) > 100 or char_length(p_song) > 100 then
    raise exception 'invalid';
  end if;

  select id into v_owner from public.profiles
   where lower(username) = lower(trim(coalesce(p_owner, ''))) limit 1;

  -- dono sem conta (convidado) ou a própria música: nunca conta
  if v_owner is null or v_owner = v_me or not coalesce(p_on, false) then
    delete from public.profile_likes
     where voter_id = v_me and room_id = p_room and song_key = p_song;
    return;
  end if;

  -- freio simples contra script: no máximo 200 likes novos por hora por pessoa
  if (select count(*) from public.profile_likes
       where voter_id = v_me and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited';
  end if;

  insert into public.profile_likes (voter_id, room_id, song_key, owner_id)
  values (v_me, p_room, p_song, v_owner)
  on conflict (voter_id, room_id, song_key) do update set owner_id = excluded.owner_id;
end;
$$;

-- Card do perfil ------------------------------------------------------------------
create or replace function public.profile_card(p_name text)
returns table (username text, display_name text, bio text, likes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.username::text, p.display_name, p.bio,
         (select count(*) from public.profile_likes l where l.owner_id = p.id) as likes
  from public.profiles p
  where lower(p.username) = lower(trim(coalesce(p_name, '')))
  limit 1
$$;

revoke all on function public.set_my_profile(text, text) from public, anon;
revoke all on function public.credit_profile_like(text, text, text, boolean) from public, anon;
revoke all on function public.profile_card(text) from public, anon;
grant execute on function public.set_my_profile(text, text) to authenticated;
grant execute on function public.credit_profile_like(text, text, text, boolean) to authenticated;
grant execute on function public.profile_card(text) to authenticated;

notify pgrst, 'reload schema';
