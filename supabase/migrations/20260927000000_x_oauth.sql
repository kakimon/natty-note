-- X OAuth 1.0a 認可フロー（natty の X アカウントを認可して Access Token を取得する）
--
-- 1. x_oauth_requests      … request token の一時保存（10分・1回だけ有効）。Edge Function（service_role）だけが読み書き
-- 2. x_account_connection  … 認可済みアカウントの「秘密でない」情報（@username など）。画面表示用に読み取りのみ許可
-- 3. store_x_access_token  … 取得した Access Token / Secret を Supabase Vault に暗号化保存。service_role だけが実行可能
-- 4. get_x_access_credentials … post-to-x が Vault から Access Token / Secret を取り出す。service_role だけが実行可能
--
-- Access Token / Secret は一般テーブルにも Supabase Secrets にも保存しない（Vault のみ）。

-- ---------- 1. request token の一時保存 ----------
create table if not exists public.x_oauth_requests (
  oauth_token text primary key,
  oauth_token_secret text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

alter table public.x_oauth_requests enable row level security;
-- ポリシーは作らない（anon / authenticated からは一切読めない・書けない）
revoke all on table public.x_oauth_requests from anon, authenticated;
grant select, insert, update, delete on table public.x_oauth_requests to service_role;

-- ---------- 2. 認可済みアカウント（秘密ではない情報だけ）----------
create table if not exists public.x_account_connection (
  id smallint primary key default 1 check (id = 1),
  x_user_id text not null,
  username text not null,
  display_name text,
  connected_at timestamptz not null default now(),
  connected_by uuid references auth.users(id) on delete set null
);

alter table public.x_account_connection enable row level security;
revoke all on table public.x_account_connection from anon, authenticated;
grant select on table public.x_account_connection to authenticated;
grant select, insert, update, delete on table public.x_account_connection to service_role;

drop policy if exists "x_account_connection_select" on public.x_account_connection;
create policy "x_account_connection_select"
  on public.x_account_connection for select
  to authenticated
  using (true);

-- ---------- 3. Access Token / Secret を Vault に保存 ----------
-- Vault の名前: x_access_token / x_access_token_secret（既にあれば上書き）
create or replace function public.store_x_access_token(
  p_access_token text,
  p_access_token_secret text,
  p_x_user_id text,
  p_username text,
  p_display_name text,
  p_connected_by uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'x_access_token';
  if v_id is null then
    perform vault.create_secret(p_access_token, 'x_access_token', 'natty の X Access Token（OAuth 1.0a）');
  else
    perform vault.update_secret(v_id, p_access_token);
  end if;

  select id into v_id from vault.secrets where name = 'x_access_token_secret';
  if v_id is null then
    perform vault.create_secret(p_access_token_secret, 'x_access_token_secret', 'natty の X Access Token Secret（OAuth 1.0a）');
  else
    perform vault.update_secret(v_id, p_access_token_secret);
  end if;

  insert into public.x_account_connection (id, x_user_id, username, display_name, connected_at, connected_by)
  values (1, p_x_user_id, p_username, p_display_name, now(), p_connected_by)
  on conflict (id) do update
    set x_user_id = excluded.x_user_id,
        username = excluded.username,
        display_name = excluded.display_name,
        connected_at = excluded.connected_at,
        connected_by = excluded.connected_by;
end;
$$;

revoke all on function public.store_x_access_token(text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.store_x_access_token(text, text, text, text, text, uuid) to service_role;

-- ---------- 4. Vault から Access Token / Secret を取得（post-to-x 用）----------
-- 呼び出しのたびに Vault を読むので、再認可で値が更新されれば次の投稿から新しい値が使われる。
-- 未連携なら 0 行を返す。
create or replace function public.get_x_access_credentials()
returns table (access_token text, access_token_secret text)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  return query
  select
    (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'x_access_token' limit 1),
    (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'x_access_token_secret' limit 1)
  where exists (select 1 from vault.decrypted_secrets ds where ds.name = 'x_access_token')
    and exists (select 1 from vault.decrypted_secrets ds where ds.name = 'x_access_token_secret');
end;
$$;

revoke all on function public.get_x_access_credentials() from public, anon, authenticated;
grant execute on function public.get_x_access_credentials() to service_role;
