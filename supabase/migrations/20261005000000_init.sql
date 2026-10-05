-- 마마파파 초기 스키마: 가족 클라우드 + TV 박스 + 미디어
-- 규칙: 표준 SQL/Postgres 기능만 사용한다. 인증 연동은 profiles.id (= auth.users.id) 한 곳에만 둔다.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table family_members (
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- 대상자(어르신). 앱에 로그인하지 않는다.
create table seniors (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

-- 어르신 댁 TV 박스. 사용자 로그인이 아니라 기기 토큰(해시)으로 서버와 통신한다.
create table devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  senior_id uuid not null references seniors(id) on delete cascade,
  token_hash text not null unique,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table invites (
  code text primary key,
  family_id uuid not null references families(id) on delete cascade,
  created_by uuid not null references profiles(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table media (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  uploader_id uuid not null references profiles(id),
  kind text not null check (kind in ('photo', 'video')),
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'failed')),
  original_key text,      -- 임시 원본 (변환 후 삭제)
  object_key text,        -- 압축본
  thumb_key text,
  duration_sec numeric,
  size_bytes bigint,      -- 압축본 크기: 가족 클라우드 사용량 계산용
  error text,
  created_at timestamptz not null default now()
);
create index media_family_created on media (family_id, created_at desc);
create index media_pending on media (created_at) where status = 'processing';

-- TV 재생 기록 (전달됨 / 재생됨 / 다시보기)
create table deliveries (
  media_id uuid not null references media(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  delivered_at timestamptz,
  played_at timestamptz,
  replayed_at timestamptz,
  primary key (media_id, device_id)
);

-- 접근 규칙: 같은 가족 구성원만 읽고 쓴다.
create function is_family_member(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;

alter table profiles enable row level security;
alter table families enable row level security;
alter table family_members enable row level security;
alter table seniors enable row level security;
alter table devices enable row level security;
alter table invites enable row level security;
alter table media enable row level security;
alter table deliveries enable row level security;

create policy profile_self on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create policy family_read on families for select using (is_family_member(id));
create policy members_read on family_members for select using (is_family_member(family_id));
create policy seniors_rw on seniors for all
  using (is_family_member(family_id)) with check (is_family_member(family_id));
create policy devices_read on devices for select using (is_family_member(family_id));
create policy invites_read on invites for select using (is_family_member(family_id));

-- 업로더 본인만 자기 이름으로 올린다. 상태 변경(처리 완료 등)은 서버(워커)만 한다.
create policy media_read on media for select using (is_family_member(family_id));
create policy media_insert on media for insert
  with check (is_family_member(family_id) and uploader_id = auth.uid() and status = 'uploading');

create policy deliveries_read on deliveries for select
  using (exists (select 1 from media m where m.id = media_id and is_family_member(m.family_id)));
-- 가족 생성, 초대 수락, 기기 등록, 미디어 상태 변경은 서버 API(service role)로만 수행한다.
