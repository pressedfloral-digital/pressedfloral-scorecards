-- Fix actuals: the unique constraint on (period, goal_tier, location, department,
-- goal_name) is meant to make upserts update in place, but every __meta__ row
-- (target/min overrides, monthly-inactive flags, deactivation flags) is saved with
-- location/department hardcoded to NULL — and standard SQL never treats NULL as
-- equal to NULL, so ON CONFLICT never matched those rows. Every save (including the
-- monthly KPI sync cron) silently inserted a new duplicate row instead of updating,
-- and reads (no ORDER BY) picked an arbitrary duplicate each time — so saved values
-- appeared to randomly revert. Confirmed empirically: 500 duplicate rows across 234
-- goal/period keys, concentrated entirely on rows with null location+department.

-- 1. Dedupe: for each logical key (treating NULL location/department as equal), keep
-- only the most recently updated row and delete the rest.
delete from public.actuals
where id not in (
  select distinct on (period, goal_tier, coalesce(location, ''), coalesce(department, ''), goal_name) id
  from public.actuals
  order by period, goal_tier, coalesce(location, ''), coalesce(department, ''), goal_name,
    updated_at desc nulls last, id desc
);

-- 2. Drop whatever the existing unique constraint on these columns is named, then
-- recreate it with NULLS NOT DISTINCT so ON CONFLICT actually matches __meta__ rows.
do $$
declare
  old_constraint text;
begin
  select con.conname into old_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'actuals'
    and con.contype = 'u'
    and (
      select array_agg(attname order by attnum)
      from pg_attribute
      where attrelid = con.conrelid and attnum = any(con.conkey)
    ) = array['period', 'goal_tier', 'location', 'department', 'goal_name']::name[];

  if old_constraint is not null then
    execute format('alter table public.actuals drop constraint %I', old_constraint);
  end if;
end $$;

alter table public.actuals
  add constraint actuals_period_goal_tier_location_department_goal_name_key
  unique nulls not distinct (period, goal_tier, location, department, goal_name);
