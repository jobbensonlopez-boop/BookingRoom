-- Bookings for Kelmer's single meeting room ("Boardroom").
create extension if not exists btree_gist;

create table bookings (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) between 1 and 200),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  attendees      int not null check (attendees between 1 and 8),
  organizer_id   text not null,          -- Entra ID object id (oid) of the signed-in user
  organizer_name text not null,
  created_at     timestamptz not null default now(),
  constraint ends_after_start check (ends_at > starts_at),
  -- Hard overlap guard: two simultaneous requests can never both succeed.
  -- When more rooms are added, include `room_id with =` in this constraint.
  constraint no_overlap exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
);

create index bookings_organizer_idx on bookings (organizer_id, starts_at);
