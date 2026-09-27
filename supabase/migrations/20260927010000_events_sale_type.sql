-- 販売方法（sale_type）を events に追加
--   event    : イベント出店
--   delivery : 直売所へ納品
--   order    : 受注販売
--   other    : その他
-- 既存の行はすべて event（default で埋まる）。テーブル名 events はそのまま使う。
alter table public.events
  add column if not exists sale_type text not null default 'event';

alter table public.events
  drop constraint if exists events_sale_type_check;

alter table public.events
  add constraint events_sale_type_check
  check (sale_type in ('event', 'delivery', 'order', 'other'));
