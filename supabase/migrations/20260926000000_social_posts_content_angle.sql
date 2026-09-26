-- 投稿の切り口（content_angle）を記録する
-- 「何を投稿したか（topic_key）」に加えて「どう伝えたか」を残し、
-- AIおまかせ投稿で直近と同じ切り口を避けるために使う。
alter table public.social_posts
  add column if not exists content_angle text;

alter table public.social_posts
  drop constraint if exists social_posts_content_angle_check;

alter table public.social_posts
  add constraint social_posts_content_angle_check
  check (
    content_angle is null
    or content_angle in (
      'product_feature',
      'rice_flour_story',
      'ingredient_story',
      'popular_item',
      'seasonal',
      'customer_scene',
      'behind_the_scenes',
      'brand_story',
      'event_notice',
      'event_thanks'
    )
  );

create index if not exists social_posts_history_idx
  on public.social_posts (status, post_type, updated_at desc);
