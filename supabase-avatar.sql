-- Avatares do RimkRadio. Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run.
-- Guarda a "receita" do avatar na conta (profiles.avatar) e libera só duas funções:
--   set_my_avatar(jsonb)   -> a pessoa logada salva o PRÓPRIO avatar
--   avatars_for(text[])    -> lê os avatares por nome de usuário (ranking e lista da sala)

alter table public.profiles add column if not exists avatar jsonb;

create or replace function public.set_my_avatar(p_avatar jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_avatar is not null and (jsonb_typeof(p_avatar) <> 'object' or length(p_avatar::text) > 1500) then
    raise exception 'invalid avatar';
  end if;
  update public.profiles set avatar = p_avatar where id = auth.uid();
end;
$$;

create or replace function public.avatars_for(p_names text[])
returns table (username text, avatar jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select p.username, p.avatar
  from public.profiles p
  where p.avatar is not null
    and lower(p.username) in (select lower(n) from unnest(p_names[1:50]) as n)
$$;

revoke all on function public.set_my_avatar(jsonb) from public, anon;
revoke all on function public.avatars_for(text[]) from public, anon;
grant execute on function public.set_my_avatar(jsonb) to authenticated;
grant execute on function public.avatars_for(text[]) to authenticated;
