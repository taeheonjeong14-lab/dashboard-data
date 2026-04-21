-- Add per-hospital SmartPlace statistics URL so collectors can read from DB.

alter table if exists core.hospitals
  add column if not exists smartplace_stat_url text;
