-- Add per-hospital Chrome debug port for local collector runtime.

alter table if exists core.hospitals
  add column if not exists debug_port integer;
